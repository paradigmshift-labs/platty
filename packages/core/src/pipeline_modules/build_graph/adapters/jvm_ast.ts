/**
 * JvmAstParserAdapter — tree-sitter (WASM) 기반 Java/Kotlin 어댑터 (P5).
 *
 * 기존 jvm.ts(regex, 엔진 0% 사용)를 대체하는 AST 어댑터. 공유 엔진(common_engine)을 소비한다:
 * 선언은 declaration_walker.processClassBody + DeclarationHooks, 노드/엣지는 leaf(emitMemberNodeAndContains
 * / addNode / buildContainsEdge), id 는 node_ops. 룰북은 jvm_hooks/jvm_language_spec.
 *
 * 빌드 진행(P5): [DONE] create() + 선언(package/import/class/method/field/constructor + contains).
 *   [NEXT] heritage(extends/implements) · annotations(decorates) · calls(normalizeCallee) · enum · Kotlin · 재기준선.
 * 완성 + 재기준선(P0 __jvm_before__ 대비 superset) 후 index.ts 가 regex jvm.ts 대신 이걸 쓰고 jvm.ts 삭제.
 */
import { Parser, Language } from 'web-tree-sitter'
import type { Node as SNode } from 'web-tree-sitter'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { ParserAdapter, CodeNodeRaw, CodeEdgeRaw, ConstructorParam } from '../types.js'
import { nodeId as engineNodeId, fileNodeId as engineFileNodeId } from './common_engine/node_ops.js'
import { addNode as engineAddNode } from './common_engine/node_factory_ops.js'
import { processClassBody as engineProcessClassBody, emitMemberNodeAndContains, emitMemberDecorators } from './common_engine/declaration_walker.js'
import type { DeclarationHooks, MemberKind, DecoratorDescriptor } from './common_engine/declaration_walker.js'
import { makeEdge as engineMakeEdge, buildTypeRefEdge as engineBuildTypeRefEdge, buildGenericArgEdge as engineBuildGenericArgEdge } from './common_engine/edge_ops.js'
import { emitNormalizedCallEdge } from './common_engine/call_edge_ops.js'
import { makeCallExtractor } from './common_engine/call_extractor.js'
import { firstChildOfType as findChild } from './common_engine/shared_utils.js'
import type { NormalizedCallee } from './common_engine/normalized.js'
import { JAVA_LANGUAGE_SPEC, KOTLIN_LANGUAGE_SPEC } from './jvm_hooks/jvm_language_spec.js'
import { parseDecoratorArgs } from './jvm_hooks/annotation_args.js'
import type { LanguageSpec } from './common_engine/types.js'

// ── WASM 경로 해석 (resolveDartWasmPath 패턴) ──
function resolveWasmPath(name: 'tree-sitter-java' | 'tree-sitter-kotlin'): string {
  try {
    const thisFile = fileURLToPath(import.meta.url)
    const candidate = path.resolve(path.dirname(thisFile), 'wasm', `${name}.wasm`)
    if (fs.existsSync(candidate)) return candidate
  } catch {
    /* CJS fallback */
  }
  return path.resolve(process.cwd(), `src/pipeline_modules/build_graph/adapters/wasm/${name}.wasm`)
}

// ── 내부 ctx (WalkEngineCtx 충족 + 어댑터 상태) ──
interface JvmParseCtx {
  repoId: string
  filePath: string
  isTest: boolean
  test_type: 'unit' | 'integration' | 'e2e' | null
  sourceLines: string[]
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  constructorParams: { className: string; params: ConstructorParam[] }[]
  importSymbolMap: Map<string, string>
  visitedNestedExecutableRanges: Set<string>
  currentClassKey: string | null
}


function isJvmTest(filePath: string): boolean {
  return /\/(test|tests)\//.test(filePath) || /(Test|Tests|Spec)\.(java|kt)$/.test(filePath)
}

// NOTE: 어댑터는 file 노드를 내지 않는다 — TS 어댑터와 동일(검증: TS 는 file 노드 0개).
// file 노드는 F2(buildFileNode)가 소유한다. imports 등 file-source edge 는 engineFileNodeId 로 참조만 한다.

function makeNode(ctx: JvmParseCtx, name: string, type: CodeNodeRaw['type'], node: SNode, exported: boolean, signature: string | null): CodeNodeRaw {
  return {
    id: engineNodeId(ctx.repoId, ctx.filePath, name), repo_id: ctx.repoId, type, file_path: ctx.filePath, name,
    line_start: node.startPosition.row + 1, line_end: node.endPosition.row + 1, signature,
    exported, parse_status: 'ok', is_test: ctx.isTest, test_type: ctx.test_type as CodeNodeRaw['test_type'], is_async: false, jsdoc: null,
  }
}

// Java field 이름: field_declaration > variable_declarator > identifier
function javaFieldName(fieldNode: SNode): string | null {
  const declarator = findChild(fieldNode, 'variable_declarator')
  return findChild(declarator ?? fieldNode, 'identifier')?.text ?? null
}

// 타입 노드 → 기준 타입 이름. type_identifier/scoped_type_identifier/generic_type 만 대상
// (Java primitive 은 integral_type/boolean_type/void_type 등 별도 노드타입 → 자연 제외 = TS 의 primitive skip 과 동치).
function jvmTypeName(typeNode: SNode | null | undefined): string | null {
  if (!typeNode) return null
  if (typeNode.type === 'type_identifier') return typeNode.text
  if (typeNode.type === 'scoped_type_identifier') return typeNode.text.split('.').pop() ?? typeNode.text
  if (typeNode.type === 'generic_type') {
    const base = typeNode.children.find((c) => c !== null && (c.type === 'type_identifier' || c.type === 'scoped_type_identifier'))
    return base ? (base.text.split('.').pop() ?? base.text) : null
  }
  return null
}

// type_ref(field/param/return) 용 타입 이름 = regex cleanTypeName 의미:
//   generic 이면 첫 타입인자(컬렉션 element: Set<String>→String, List<OrderLine>→OrderLine),
//   array 면 element(String[]→String), nullable 면 inner, 아니면 base.
// build_models(JpaGraphAdapter)/build_route 가 컬렉션 element 타입을 type_ref 로 기대 → 계약 유지.
// (heritage 는 base 가 필요하므로 jvmTypeName 을 별도 유지: extends JpaRepository<...> 의 base.)
function jvmRefTypeName(typeNode: SNode | null | undefined): string | null {
  if (!typeNode) return null
  if (typeNode.type === 'array_type') {
    const el = typeNode.childForFieldName('element') ?? typeNode.children.find((c) => c !== null && c.type !== 'dimensions')
    return jvmRefTypeName(el)
  }
  if (typeNode.type === 'nullable_type') {
    return jvmRefTypeName(typeNode.children.find((c) => c !== null && (c.type === 'user_type' || c.type === 'nullable_type' || c.type === 'generic_type')))
  }
  if (typeNode.type === 'generic_type') {
    const ta = typeNode.children.find((c) => c !== null && c.type === 'type_arguments')
    if (ta) {
      for (const a of ta.children) {
        if (a === null) continue
        const n = jvmRefTypeName(a) // 첫 타입인자(컬렉션 element) — cleanTypeName 의미
        if (n) return n
      }
    }
    const base = typeNode.children.find((c) => c !== null && (c.type === 'type_identifier' || c.type === 'scoped_type_identifier'))
    return base ? (base.text.split('.').pop() ?? base.text) : null
  }
  if (typeNode.type === 'type_identifier') return typeNode.text
  if (typeNode.type === 'scoped_type_identifier') return typeNode.text.split('.').pop() ?? typeNode.text
  return null
}

// type_ref edge (TS 계약 동일: field=subtype null, return=return_type, param=method_param).
// 발화는 공유 leaf buildTypeRefEdge (GAP-3) — Dart emitTypeRefEdges 와 동일 edge 규약.
function emitJvmTypeRef(ctx: JvmParseCtx, sourceId: string, typeName: string, subtype: CodeEdgeRaw['type_ref_subtype']): void {
  ctx.edges.push(engineBuildTypeRefEdge(ctx.repoId, ctx.importSymbolMap, sourceId, typeName, subtype))
}

// ── Java DeclarationHooks (engine processClassBody 구동) ──
function javaDeclarationHooks(ctx: JvmParseCtx): DeclarationHooks<SNode> {
  return {
    resolveClassBody: (n) => n.childForFieldName('body') ?? findChild(n, 'class_body'),
    classifyMember: (member): MemberKind => {
      if (member.type === 'method_declaration' || member.type === 'annotation_type_element_declaration') return 'method'
      if (member.type === 'field_declaration') return 'field'
      if (member.type === 'constructor_declaration') return 'constructor'
      return 'skip'
    },
    collectConstructorParams: (member) => collectJavaConstructorParams(member),
    processMethod: (member, _members, _i, className, classExported, classNodeId) => {
      const methodName = member.childForFieldName('name')?.text ?? findChild(member, 'identifier')?.text
      if (!methodName) return
      const fullName = `${className}.${methodName}`
      const sig = findChild(member, 'formal_parameters')?.text ?? null
      const node = makeNode(ctx, fullName, 'method', member, classExported, sig)
      const methodNodeId = engineNodeId(ctx.repoId, ctx.filePath, fullName)
      emitMemberNodeAndContains(node, member.startPosition.row + 1, classNodeId, fullName, methodName, ctx)
      emitMemberDecorators(javaAnnotationDescriptors(member), methodNodeId, ctx, JAVA_LANGUAGE_SPEC)
      // 시그니처 타입 → type_ref (return=return_type, param=method_param) — TS emitMethodSignatureTypeRefs 계약 동일
      const rt = jvmRefTypeName(member.childForFieldName('type'))
      if (rt) emitJvmTypeRef(ctx, methodNodeId, rt, 'return_type')
      const formals = findChild(member, 'formal_parameters')
      if (formals) {
        for (const p of formals.children) {
          if (p === null || p.type !== 'formal_parameter') continue
          const pt = jvmRefTypeName(p.childForFieldName('type') ?? p.children.find((c) => c !== null && (c.type === 'type_identifier' || c.type === 'scoped_type_identifier' || c.type === 'generic_type' || c.type === 'array_type')))
          if (pt) emitJvmTypeRef(ctx, methodNodeId, pt, 'method_param')
        }
      }
      // method body 의 호출 → calls edge (source = method 노드), 공유 emitNormalizedCallEdge 경유
      const body = member.childForFieldName('body')
      if (body) scanJavaCalls(body, ctx, methodNodeId)
    },
    processField: (member, className, classExported) => {
      const propName = javaFieldName(member)
      if (!propName) return
      const fullName = `${className}.${propName}`
      const memberNodeId = engineNodeId(ctx.repoId, ctx.filePath, fullName)
      const typeNode = member.childForFieldName('type') ?? member.children.find((c) => c !== null && (c.type === 'type_identifier' || c.type === 'scoped_type_identifier' || c.type === 'generic_type'))
      const node = makeNode(ctx, fullName, 'property', member, classExported, typeNode?.text ?? null)
      emitMemberNodeAndContains(node, member.startPosition.row + 1, engineNodeId(ctx.repoId, ctx.filePath, className), fullName, propName, ctx)
      emitMemberDecorators(javaAnnotationDescriptors(member), memberNodeId, ctx, JAVA_LANGUAGE_SPEC)
      // field type → type_ref (subtype null) — TS field type_ref 계약 동일
      const ft = jvmRefTypeName(typeNode)
      if (ft) emitJvmTypeRef(ctx, memberNodeId, ft, null)
    },
  }
}

function collectJavaConstructorParams(ctorNode: SNode): ConstructorParam[] {
  const params: ConstructorParam[] = []
  const formals = findChild(ctorNode, 'formal_parameters')
  if (!formals) return params
  for (const p of formals.children) {
    if (p === null || p.type !== 'formal_parameter') continue
    const typeName = p.children.find((c) => c !== null && (c.type === 'type_identifier' || c.type === 'generic_type'))?.text
    const fieldName = findChild(p, 'identifier')?.text
    if (typeName && fieldName) params.push({ fieldName, typeName })
  }
  return params
}

// ── annotations (decorates) ──
// 어노테이션 인자 노드(괄호 포함 텍스트) → { firstArg, literalArgs }. 공유 parseDecoratorArgs(텍스트 기반)로
// regex jvm.ts 와 동일 계약 생성 (build_models/build_route 가 firstArg+literalArgs.named 를 파싱해 씀).
function parseJvmAnnotationArgs(argListNode: SNode | null): { firstArg: string | null; literalArgs: string | null } {
  if (!argListNode) return { firstArg: null, literalArgs: null }
  const raw = argListNode.text.replace(/^\(/, '').replace(/\)$/, '').trim()
  return parseDecoratorArgs(raw)
}
// modifiers 안의 @Annotation / @Marker → DecoratorDescriptor[] (decorates only; Java 어노테이션은 calls/deps 아님)
function javaAnnotationDescriptors(node: SNode): DecoratorDescriptor<SNode>[] {
  const modifiers = findChild(node, 'modifiers')
  if (!modifiers) return []
  const out: DecoratorDescriptor<SNode>[] = []
  for (const m of modifiers.children) {
    if (m === null || (m.type !== 'annotation' && m.type !== 'marker_annotation')) continue
    const name = findChild(m, 'identifier')?.text ?? null
    if (!name) continue
    const { firstArg, literalArgs } = parseJvmAnnotationArgs(findChild(m, 'annotation_argument_list'))
    out.push({ node: m, info: { name, firstArg, literalArgs }, emitCalls: false, emitDepsAndTypeFn: false })
  }
  return out
}

// ── heritage (extends / implements) ──
// Java 의 heritage 는 TS 의 class_heritage 래퍼가 없고 flat: class=superclass/super_interfaces,
// interface=extends_interfaces 가 선언의 직속 자식. 그래서 공유 buildClassHeritageEdges(단일 래퍼 가정)
// 대신 JVM 전용 walk 를 쓰되, 출력 계약은 TS heritage_ops 동일(extends/implements + generic args → uses_type('generic_arg')).

// type_arguments 의 인자 타입 이름 수집 (generic_arg uses_type 용).
function collectGenericArgNames(genericNode: SNode): string[] {
  const out: string[] = []
  const args = genericNode.children.find((c) => c !== null && c.type === 'type_arguments')
  if (!args) return out
  for (const a of args.children) {
    if (a === null) continue
    if (a.type === 'type_identifier') out.push(a.text)
    else if (a.type === 'scoped_type_identifier') out.push(a.text.split('.').pop() ?? a.text)
    else if (a.type === 'generic_type') { const n = jvmTypeName(a); if (n) out.push(n) }
  }
  return out
}

// heritage container(superclass/super_interfaces/extends_interfaces) → 각 타입 ref 를 relation edge 로,
// generic 이면 base=relation + 인자=uses_type('generic_arg'). list 노드(interface_type_list/type_list)는 재귀.
function emitHeritageContainer(container: SNode, relation: 'extends' | 'implements', ctx: JvmParseCtx, classNodeId: string): void {
  for (const c of container.children) {
    if (c === null) continue
    if (c.type === 'type_identifier' || c.type === 'scoped_type_identifier') {
      const name = c.type === 'scoped_type_identifier' ? (c.text.split('.').pop() ?? c.text) : c.text
      ctx.edges.push(engineMakeEdge(ctx.repoId, { source_id: classNodeId, target_id: null, relation, target_specifier: ctx.importSymbolMap.get(name) ?? null, target_symbol: name, resolve_status: 'pending', first_arg: null, literal_args: null }))
    } else if (c.type === 'generic_type') {
      const base = jvmTypeName(c)
      if (base) {
        ctx.edges.push(engineMakeEdge(ctx.repoId, { source_id: classNodeId, target_id: null, relation, target_specifier: ctx.importSymbolMap.get(base) ?? null, target_symbol: base, resolve_status: 'pending', first_arg: null, literal_args: null }))
        for (const g of collectGenericArgNames(c)) ctx.edges.push(engineBuildGenericArgEdge(ctx.repoId, ctx.importSymbolMap, classNodeId, g))
      }
    } else if (c.type === 'interface_type_list' || c.type === 'type_list') {
      emitHeritageContainer(c, relation, ctx, classNodeId)
    }
  }
}

function emitJvmHeritage(node: SNode, className: string, ctx: JvmParseCtx): void {
  const classNodeId = engineNodeId(ctx.repoId, ctx.filePath, className)
  const superclass = node.childForFieldName('superclass') // class: 'extends X'
  if (superclass) emitHeritageContainer(superclass, 'extends', ctx, classNodeId)
  const interfaces = node.childForFieldName('interfaces') // class: 'implements A, B' (super_interfaces)
  if (interfaces) emitHeritageContainer(interfaces, 'implements', ctx, classNodeId)
  const extendsInterfaces = findChild(node, 'extends_interfaces') // interface: 'extends A, B'
  if (extendsInterfaces) emitHeritageContainer(extendsInterfaces, 'extends', ctx, classNodeId)
}

// ── calls (method_invocation/object_creation → normalizeCallee → emitNormalizedCallEdge) ──
// JVM 이 normalizeCallee 의 첫 실구현체 → 죽어있던 emitNormalizedCallEdge 경로가 살아남.
const javaCallExtractor = makeCallExtractor(JAVA_LANGUAGE_SPEC)

// method_invocation 의 object(receiver) chain root identifier 추출
function rootIdentifierOf(node: SNode | null): string | null {
  let cur: SNode | null = node
  while (cur) {
    if (cur.type === 'identifier') return cur.text
    if (cur.type === 'field_access') { cur = cur.childForFieldName('object'); continue }
    if (cur.type === 'method_invocation') { cur = cur.childForFieldName('object'); continue }
    break
  }
  return null
}

// receiver(object) 의 segment 체인을 좌→우로 추출 (this.rt → ['this','rt'], a.b → ['a','b']).
// this-rooted member 호출의 chain_path 보존용 (build_relations 의 수신자-타입 앵커가 의존).
function receiverChain(node: SNode | null): string[] {
  if (!node) return []
  if (node.type === 'this') return ['this']
  if (node.type === 'identifier') return [node.text]
  if (node.type === 'field_access') {
    const obj = node.childForFieldName('object')
    const field = node.childForFieldName('field') ?? findChild(node, 'identifier')
    return [...receiverChain(obj), ...(field ? [field.text] : [])]
  }
  if (node.type === 'method_invocation') {
    const obj = node.childForFieldName('object')
    const name = node.childForFieldName('name')
    return [...receiverChain(obj), ...(name ? [name.text] : [])]
  }
  return []
}

function normalizeJavaCallee(node: SNode): NormalizedCallee | null {
  if (node.type === 'object_creation_expression') {
    const t = node.children.find((c) => c !== null && (c.type === 'type_identifier' || c.type === 'scoped_type_identifier' || c.type === 'generic_type'))
    if (!t) return null
    const sym = t.text.split('.').pop() ?? t.text
    return { shape: 'new', symbol: sym, rootIdentifier: null, memberChain: [sym], calleeText: t.text }
  }
  // method_invocation: object? + name + arguments
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return null
  const symbol = nameNode.text
  const object = node.childForFieldName('object')
  if (!object) {
    return { shape: 'identifier', symbol, rootIdentifier: null, memberChain: [symbol], calleeText: symbol }
  }
  // this-rooted member chain (this.field[.field].method) → this_member with the FULL receiver chain,
  // so chain_path = 'this.field' (matches TS this_member; build_relations anchors on it). Without this
  // the receiver was dropped (chain_path null) because rootIdentifierOf hits `this` and returns null.
  if (object.type !== 'this') {
    const segs = receiverChain(object)
    if (segs[0] === 'this' && segs.length > 1) {
      return { shape: 'this_member', symbol, rootIdentifier: null, memberChain: [...segs, symbol], calleeText: `${object.text}.${symbol}` }
    }
  }
  const root = rootIdentifierOf(object)
  return {
    shape: object.type === 'this' ? 'this_member' : 'member',
    symbol,
    rootIdentifier: object.type === 'this' ? null : root,
    memberChain: root ? [root, symbol] : [symbol],
    calleeText: `${object.text}.${symbol}`,
  }
}

// 메서드/생성자 body 재귀 — method_invocation/object_creation 마다 calls edge 발화.
function scanJavaCalls(node: SNode, ctx: JvmParseCtx, sourceId: string): void {
  for (const child of node.children) {
    if (child === null) continue
    if (child.type === 'method_invocation' || child.type === 'object_creation_expression') {
      const callee = normalizeJavaCallee(child)
      if (callee) emitNormalizedCallEdge(callee, child.childForFieldName('arguments'), ctx, sourceId, JAVA_LANGUAGE_SPEC, javaCallExtractor)
    }
    scanJavaCalls(child, ctx, sourceId)
  }
}

// ══════════════════ Kotlin ══════════════════
// Kotlin 은 Java 와 구조가 상당히 다름: 이름=자식 identifier, 어노테이션 이름=user_type 안,
// 반환타입=':' 뒤 user_type 직속자식, 프로퍼티=primary_constructor 의 val/var class_parameter,
// 호출=call_expression>navigation_expression. → Kotlin 전용 훅이 같은 공유 엔진을 구동(uniform consumer).

function kotlinName(node: SNode): string | null {
  return findChild(node, 'identifier')?.text ?? findChild(node, 'type_identifier')?.text ?? null
}

// user_type | nullable_type(>user_type) → 기준 타입 이름
function kotlinTypeName(typeNode: SNode | null | undefined): string | null {
  if (!typeNode) return null
  if (typeNode.type === 'nullable_type') return kotlinTypeName(typeNode.children.find((c) => c !== null && (c.type === 'user_type' || c.type === 'nullable_type')))
  if (typeNode.type === 'user_type') return (findChild(typeNode, 'type_identifier') ?? findChild(typeNode, 'identifier'))?.text ?? null
  return null
}

// function_declaration 의 반환타입 = 직속 user_type/nullable_type (param 타입은 function_value_parameters 내부라 제외됨)
function kotlinReturnTypeNode(fnNode: SNode): SNode | null {
  return fnNode.children.find((c) => c !== null && (c.type === 'user_type' || c.type === 'nullable_type')) ?? null
}

function kotlinAnnotationDescriptors(node: SNode): DecoratorDescriptor<SNode>[] {
  // 어노테이션 노드 수집: node 자신의 modifiers + (top-level 래핑 케이스) 부모 annotated_expression 의 annotation.
  const annNodes: SNode[] = []
  const modifiers = findChild(node, 'modifiers')
  if (modifiers) for (const m of modifiers.children) if (m !== null && m.type === 'annotation') annNodes.push(m)
  const parent = node.parent
  if (parent && parent.type === 'annotated_expression') {
    for (const m of parent.children) if (m !== null && m.type === 'annotation') annNodes.push(m)
  }
  const out: DecoratorDescriptor<SNode>[] = []
  for (const m of annNodes) {
    const ci = findChild(m, 'constructor_invocation')
    const ut = ci ? findChild(ci, 'user_type') : findChild(m, 'user_type')
    const name = ut ? ((findChild(ut, 'type_identifier') ?? findChild(ut, 'identifier'))?.text ?? null) : null
    if (!name) continue
    const { firstArg, literalArgs } = parseJvmAnnotationArgs(ci ? findChild(ci, 'value_arguments') : null)
    out.push({ node: m, info: { name, firstArg, literalArgs }, emitCalls: false, emitDepsAndTypeFn: false })
  }
  return out
}

// Kotlin call: call_expression > (navigation_expression | identifier) + value_arguments
function normalizeKotlinCallee(node: SNode): NormalizedCallee | null {
  const first = node.children.find((c) => c !== null && c.type !== 'value_arguments' && c.type !== 'call_suffix')
  if (!first) return null
  if (first.type === 'navigation_expression') {
    const ids = first.children.filter((c) => c !== null && c.type === 'identifier').map((c) => (c as SNode).text)
    let symbol = ids[ids.length - 1]
    const suffix = findChild(first, 'navigation_suffix')
    if (suffix) { const s = findChild(suffix, 'identifier'); if (s) symbol = s.text }
    if (!symbol) return null
    const root = ids[0]
    return { shape: 'member', symbol, rootIdentifier: root ?? null, memberChain: root ? [root, symbol] : [symbol], calleeText: first.text }
  }
  if (first.type === 'identifier') {
    return { shape: 'identifier', symbol: first.text, rootIdentifier: null, memberChain: [first.text], calleeText: first.text }
  }
  return null
}

const kotlinCallExtractor = makeCallExtractor(KOTLIN_LANGUAGE_SPEC)
function scanKotlinCalls(node: SNode, ctx: JvmParseCtx, sourceId: string): void {
  for (const child of node.children) {
    if (child === null) continue
    if (child.type === 'call_expression') {
      const callee = normalizeKotlinCallee(child)
      if (callee) emitNormalizedCallEdge(callee, findChild(child, 'value_arguments'), ctx, sourceId, KOTLIN_LANGUAGE_SPEC, kotlinCallExtractor)
    }
    scanKotlinCalls(child, ctx, sourceId)
  }
}

// BG-4 (def-use): emit a `variable` node for a method-local Kotlin `val/var x = …` that is USED as a call
// receiver in the same function body, so F5 Pass C resolves the bare receiver → its declaration. Node id
// `{methodFullName}.{name}` matches Pass C's `{source_id}.{name}` lookup. Receiver-used only (mirrors TS).
// Must run AFTER scanKotlinCalls so the receiver chain_path edges already exist.
function emitKotlinLocalReceiverVars(body: SNode, ctx: JvmParseCtx, methodNodeId: string, methodFullName: string): void {
  const declared = new Map<string, SNode>()
  collectKotlinLocalDeclarators(body, declared)
  if (declared.size === 0) return
  const receivers = new Set<string>()
  for (const e of ctx.edges) {
    if (e.relation !== 'calls' || e.source_id !== methodNodeId || !e.chain_path) continue
    const root = (e.chain_path.startsWith('this.') ? e.chain_path.slice('this.'.length) : e.chain_path).split('.')[0]
    if (root) receivers.add(root)
  }
  for (const [name, declNode] of declared) {
    if (!receivers.has(name)) continue
    engineAddNode(ctx.nodes, makeNode(ctx, `${methodFullName}.${name}`, 'variable', declNode, false, null), ctx.sourceLines)
  }
}

function collectKotlinLocalDeclarators(node: SNode, out: Map<string, SNode>): void {
  for (const child of node.children) {
    if (child === null) continue
    // a nested function/lambda owns its own scope — don't attribute its locals here
    if (child.type === 'function_declaration' || child.type === 'lambda_literal' || child.type === 'anonymous_function') continue
    if (child.type === 'property_declaration') {
      const vd = findChild(child, 'variable_declaration') ?? child
      const nm = findChild(vd, 'identifier')?.text ?? findChild(vd, 'simple_identifier')?.text
      if (nm && !out.has(nm)) out.set(nm, child)
    }
    collectKotlinLocalDeclarators(child, out)
  }
}

function kotlinDeclarationHooks(ctx: JvmParseCtx): DeclarationHooks<SNode> {
  return {
    resolveClassBody: (n) => findChild(n, 'class_body'),
    classifyMember: (member): MemberKind => {
      if (member.type === 'function_declaration') return 'method'
      if (member.type === 'property_declaration') return 'field'
      if (member.type === 'secondary_constructor') return 'constructor'
      return 'skip'
    },
    collectConstructorParams: () => [], // Kotlin primary ctor 는 class 레벨에서 처리(class_body 밖)
    processMethod: (member, _members, _i, className, classExported, classNodeId) => {
      const methodName = kotlinName(member)
      if (!methodName) return
      const fullName = `${className}.${methodName}`
      const sig = findChild(member, 'function_value_parameters')?.text ?? null
      const node = makeNode(ctx, fullName, 'method', member, classExported, sig)
      const methodNodeId = engineNodeId(ctx.repoId, ctx.filePath, fullName)
      emitMemberNodeAndContains(node, member.startPosition.row + 1, classNodeId, fullName, methodName, ctx)
      emitMemberDecorators(kotlinAnnotationDescriptors(member), methodNodeId, ctx, KOTLIN_LANGUAGE_SPEC)
      const rt = kotlinTypeName(kotlinReturnTypeNode(member))
      if (rt) emitJvmTypeRef(ctx, methodNodeId, rt, 'return_type')
      const fvp = findChild(member, 'function_value_parameters')
      if (fvp) {
        for (const par of fvp.children) {
          if (par === null || par.type !== 'parameter') continue
          const pt = kotlinTypeName(par.children.find((c) => c !== null && (c.type === 'user_type' || c.type === 'nullable_type')))
          if (pt) emitJvmTypeRef(ctx, methodNodeId, pt, 'method_param')
        }
      }
      const body = findChild(member, 'function_body')
      if (body) {
        scanKotlinCalls(body, ctx, methodNodeId)
        emitKotlinLocalReceiverVars(body, ctx, methodNodeId, fullName)
      }
    },
    processField: (member, className, classExported) => {
      const vd = findChild(member, 'variable_declaration') ?? member
      const propName = findChild(vd, 'identifier')?.text
      if (!propName) return
      const fullName = `${className}.${propName}`
      const memberNodeId = engineNodeId(ctx.repoId, ctx.filePath, fullName)
      const typeNode = vd.children.find((c) => c !== null && (c.type === 'user_type' || c.type === 'nullable_type'))
      const node = makeNode(ctx, fullName, 'property', member, classExported, typeNode?.text ?? null)
      emitMemberNodeAndContains(node, member.startPosition.row + 1, engineNodeId(ctx.repoId, ctx.filePath, className), fullName, propName, ctx)
      emitMemberDecorators(kotlinAnnotationDescriptors(member), memberNodeId, ctx, KOTLIN_LANGUAGE_SPEC)
      const ft = kotlinTypeName(typeNode)
      if (ft) emitJvmTypeRef(ctx, memberNodeId, ft, null)
    },
  }
}

// Kotlin primary constructor: val/var class_parameter → property + (모든 param) → DI ctor params
function processKotlinPrimaryConstructor(node: SNode, className: string, classNodeId: string, ctx: JvmParseCtx): void {
  const pc = findChild(node, 'primary_constructor')
  if (!pc) return
  const cps = findChild(pc, 'class_parameters')
  if (!cps) return
  const diParams: ConstructorParam[] = []
  for (const cp of cps.children) {
    if (cp === null || cp.type !== 'class_parameter') continue
    const pname = findChild(cp, 'identifier')?.text
    const typeNode = cp.children.find((c) => c !== null && (c.type === 'user_type' || c.type === 'nullable_type'))
    const tname = kotlinTypeName(typeNode)
    if (pname && tname) diParams.push({ fieldName: pname, typeName: tname })
    const isProp = cp.children.some((c) => c !== null && (c.type === 'val' || c.type === 'var'))
    if (isProp && pname) {
      const fullName = `${className}.${pname}`
      const memberNodeId = engineNodeId(ctx.repoId, ctx.filePath, fullName)
      const propNode = makeNode(ctx, fullName, 'property', cp, true, typeNode?.text ?? null)
      emitMemberNodeAndContains(propNode, cp.startPosition.row + 1, classNodeId, fullName, pname, ctx)
      emitMemberDecorators(kotlinAnnotationDescriptors(cp), memberNodeId, ctx, KOTLIN_LANGUAGE_SPEC)
      if (tname) emitJvmTypeRef(ctx, memberNodeId, tname, null)
    }
  }
  if (diParams.length > 0) ctx.constructorParams.push({ className, params: diParams })
}

// type_arguments(type_projection 으로 감싸짐) 안의 user_type 기준 이름들을 수집 (중첩 generic 은 최상위만).
function collectKotlinGenericArgs(typeArguments: SNode): string[] {
  const out: string[] = []
  const rec = (n: SNode): void => {
    if (n.type === 'user_type') { const name = kotlinTypeName(n); if (name) out.push(name); return }
    for (const c of n.children) if (c !== null) rec(c)
  }
  for (const c of typeArguments.children) if (c !== null && c.type !== '<' && c.type !== '>' && c.type !== ',') rec(c)
  return out
}

// Kotlin heritage: delegation_specifier 들. interface 선언 → 전부 extends; class → ctor-call=extends / bare=implements.
function emitKotlinDelegation(ds: SNode, isInterface: boolean, ctx: JvmParseCtx, classNodeId: string): void {
  const ci = findChild(ds, 'constructor_invocation')
  const ut = (ci ? findChild(ci, 'user_type') : null) ?? findChild(ds, 'user_type')
  if (!ut) return
  const base = kotlinTypeName(ut)
  if (!base) return
  const relation: 'extends' | 'implements' = isInterface ? 'extends' : (ci ? 'extends' : 'implements')
  ctx.edges.push(engineMakeEdge(ctx.repoId, { source_id: classNodeId, target_id: null, relation, target_specifier: ctx.importSymbolMap.get(base) ?? null, target_symbol: base, resolve_status: 'pending', first_arg: null, literal_args: null }))
  const ta = findChild(ut, 'type_arguments')
  if (ta) {
    for (const g of collectKotlinGenericArgs(ta)) {
      ctx.edges.push(engineBuildGenericArgEdge(ctx.repoId, ctx.importSymbolMap, classNodeId, g))
    }
  }
}
function emitKotlinHeritage(node: SNode, className: string, ctx: JvmParseCtx): void {
  const classNodeId = engineNodeId(ctx.repoId, ctx.filePath, className)
  const isInterface = node.children.some((c) => c !== null && c.type === 'interface')
  for (const c of node.children) {
    if (c === null || c.type === 'class_body') continue
    if (c.type === 'delegation_specifier') emitKotlinDelegation(c, isInterface, ctx, classNodeId)
    else for (const gc of c.children) if (gc !== null && gc.type === 'delegation_specifier') emitKotlinDelegation(gc, isInterface, ctx, classNodeId)
  }
}

// ── 어댑터 ──
export class JvmAstParserAdapter implements ParserAdapter {
  private constructor(private readonly javaParser: Parser, private readonly kotlinParser: Parser) {}

  static async create(): Promise<JvmAstParserAdapter> {
    await Parser.init()
    const javaLang = await Language.load(resolveWasmPath('tree-sitter-java'))
    const kotlinLang = await Language.load(resolveWasmPath('tree-sitter-kotlin'))
    const javaParser = new Parser(); javaParser.setLanguage(javaLang)
    const kotlinParser = new Parser(); kotlinParser.setLanguage(kotlinLang)
    return new JvmAstParserAdapter(javaParser, kotlinParser)
  }

  supportedExtensions(): string[] {
    return ['.java', '.kt']
  }

  parseFile(content: string, filePath: string, repoId: string): { nodes: CodeNodeRaw[]; edges: CodeEdgeRaw[]; constructorParams: { className: string; params: ConstructorParam[] }[]; enumValues: Map<string, string> } {
    const isKotlin = filePath.endsWith('.kt')
    const spec: LanguageSpec = isKotlin ? KOTLIN_LANGUAGE_SPEC : JAVA_LANGUAGE_SPEC
    const isTest = isJvmTest(filePath)
    const test_type = isTest ? 'unit' : null

    let tree: ReturnType<Parser['parse']>
    try {
      tree = (isKotlin ? this.kotlinParser : this.javaParser).parse(content)
    } catch {
      tree = null
    }
    if (!tree) {
      return { nodes: [], edges: [], constructorParams: [], enumValues: new Map() }
    }

    const ctx: JvmParseCtx = {
      repoId, filePath, isTest, test_type, sourceLines: content.split('\n'),
      nodes: [], edges: [],
      constructorParams: [], importSymbolMap: new Map(), visitedNestedExecutableRanges: new Set(), currentClassKey: null,
    }

    // pass 1: imports — importSymbolMap 를 먼저 채워 heritage/calls resolve 에 쓰이게.
    // (Java=import_declaration / Kotlin=import)
    for (const child of tree.rootNode.children) {
      if (child !== null && (child.type === 'import_declaration' || child.type === 'import')) this.processImport(child, ctx, isKotlin)
    }
    // pass 2: 선언 dispatch (per-language thin switch — §0: 공유 안 함)
    for (const child of tree.rootNode.children) {
      if (child === null) continue
      this.processTopLevel(child, ctx, spec, isKotlin)
    }

    return { nodes: ctx.nodes, edges: ctx.edges, constructorParams: ctx.constructorParams, enumValues: new Map() }
  }

  // import → imports edge (file source) + importSymbolMap (symbol → FQN)
  private processImport(node: SNode, ctx: JvmParseCtx, isKotlin: boolean): void {
    let fqn: string
    let alias: string | null = null
    if (isKotlin) {
      // Kotlin `import com.x.Y` / `import com.x.* ` / `import com.x.Y as Z` — 노드구조가 다양해 텍스트 기반이 견고
      const raw = node.text.replace(/^import\s+/, '').replace(/;?\s*$/, '').trim()
      const parts = raw.split(/\s+as\s+/)
      fqn = parts[0].replace(/\s+/g, '')
      alias = parts[1]?.trim() ?? null
    } else {
      const scoped = findChild(node, 'scoped_identifier') ?? node.namedChildren.find((c) => c.type === 'identifier') ?? null
      if (!scoped) return
      fqn = scoped.text.replace(/\s+/g, '')
    }
    const isWildcard = fqn.endsWith('.*') || node.children.some((c) => c !== null && c.type === 'asterisk')
    const symbol = isWildcard ? null : (alias ?? (fqn.split('.').pop() ?? fqn))
    ctx.edges.push(engineMakeEdge(ctx.repoId, {
      source_id: engineFileNodeId(ctx.repoId, ctx.filePath), target_id: null, relation: 'imports',
      target_specifier: fqn, target_symbol: symbol, resolve_status: 'pending', first_arg: null, literal_args: null,
    }))
    if (symbol) ctx.importSymbolMap.set(symbol, fqn)
  }

  private processTopLevel(node: SNode, ctx: JvmParseCtx, spec: LanguageSpec, isKotlin: boolean): void {
    if (isKotlin) { this.processKotlinTopLevel(node, ctx); return }
    switch (node.type) {
      case 'class_declaration':
      case 'interface_declaration':
      case 'annotation_type_declaration': {
        const className = node.childForFieldName('name')?.text
        if (!className) return
        // annotation_type(@interface) 은 interface-like 타입으로 노드화 (regex 는 class 로 셌으나 @interface 는 interface 가 정확 → 재기준선 개선).
        const isInterface = node.type === 'interface_declaration' || node.type === 'annotation_type_declaration'
        const classNode = makeNode(ctx, className, isInterface ? 'interface' : 'class', node, true, null)
        engineAddNode(ctx.nodes, classNode, ctx.sourceLines)
        const classNodeId = engineNodeId(ctx.repoId, ctx.filePath, className)
        // class-level annotations (decorates) — 공유 leaf
        emitMemberDecorators(javaAnnotationDescriptors(node), classNodeId, ctx, spec)
        // heritage (extends/implements)
        emitJvmHeritage(node, className, ctx)
        // class-body 멤버는 공유 엔진 declaration walker 로 (Java body=child-field → 기본 경로)
        const { constructorParams } = engineProcessClassBody(node, ctx, className, true, javaDeclarationHooks(ctx))
        if (constructorParams.length > 0) ctx.constructorParams.push({ className, params: constructorParams })
        break
      }
      case 'enum_declaration': {
        const enumName = node.childForFieldName('name')?.text
        if (!enumName) return
        const enumNode = makeNode(ctx, enumName, 'enum', node, true, null)
        engineAddNode(ctx.nodes, enumNode, ctx.sourceLines)
        emitMemberDecorators(javaAnnotationDescriptors(node), engineNodeId(ctx.repoId, ctx.filePath, enumName), ctx, spec)
        break
      }
      default:
        break
    }
  }

  // Kotlin top-level: class/object/interface/enum 모두 class_declaration/object_declaration. 이름=자식 identifier.
  private processKotlinTopLevel(node: SNode, ctx: JvmParseCtx): void {
    // tree-sitter-kotlin 은 top-level 어노테이션 선언(@X annotation class / @X class)을 종종 annotated_expression
    // 으로 감싼다 → 내부 선언을 unwrap (어노테이션은 kotlinAnnotationDescriptors 가 부모를 보고 흡수).
    if (node.type === 'annotated_expression') {
      for (const c of node.children) {
        if (c !== null && (c.type === 'class_declaration' || c.type === 'object_declaration')) this.processKotlinTopLevel(c, ctx)
      }
      return
    }
    if (node.type !== 'class_declaration' && node.type !== 'object_declaration') return
    const className = kotlinName(node)
    if (!className) return
    const isInterface = node.children.some((c) => c !== null && c.type === 'interface')
    const isEnum = node.children.some((c) => c !== null && (c.type === 'enum' || c.text === 'enum'))
    const nodeType: CodeNodeRaw['type'] = isEnum ? 'enum' : isInterface ? 'interface' : 'class'
    const classNode = makeNode(ctx, className, nodeType, node, true, null)
    engineAddNode(ctx.nodes, classNode, ctx.sourceLines)
    const classNodeId = engineNodeId(ctx.repoId, ctx.filePath, className)
    emitMemberDecorators(kotlinAnnotationDescriptors(node), classNodeId, ctx, KOTLIN_LANGUAGE_SPEC)
    emitKotlinHeritage(node, className, ctx)
    processKotlinPrimaryConstructor(node, className, classNodeId, ctx)
    engineProcessClassBody(node, ctx, className, true, kotlinDeclarationHooks(ctx))
  }
}
