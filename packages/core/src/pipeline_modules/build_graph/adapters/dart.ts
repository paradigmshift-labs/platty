/**
 * DartParserAdapter — web-tree-sitter (WASM) 기반 Dart 파서 어댑터
 * SOT: specs/phase3/dart_support.md §2
 *
 * 초기화: static async create() 팩토리 사용 (WASM 로드는 async)
 * 파싱:   parseFile() 자체는 동기 (초기화 완료 후)
 */
import { Parser, Language } from 'web-tree-sitter'
import type { Node as SNode } from 'web-tree-sitter'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  ParserAdapter,
  CodeNodeRaw,
  CodeEdgeRaw,
  CallArgExpression,
  ConstructorParam,
  CodeNodeType,
  EdgeRelation,
  FieldOrigin,
  FieldOriginsMap,
} from '../types.js'
import { computeNormalizedCodeHash, sliceLinesForHash } from '../normalized_code_hash.js'
// Phase C — Dart 가 common_engine 의 파서-무관 leaf 빌더를 소비 (2nd consumer ★증명).
// 이 4개는 LanguageSpec 불요(순수 데이터 빌더). TS 어댑터와 동일 엔진 함수를 공유한다.
import { nodeId as engineNodeId, fileNodeId as engineFileNodeId } from './common_engine/node_ops.js'
import { makeEdge as engineMakeEdge, emitDependsOnIfImportBound as engineEmitDependsOnIfImportBound, buildTypeRefEdge as engineBuildTypeRefEdge, buildContainsEdge as engineBuildContainsEdge } from './common_engine/edge_ops.js'
import { recordFieldOrigin as engineRecordFieldOrigin, resolveTypeOriginWith, type TypeOriginRules } from './common_engine/field_origin_ops.js'
import { addNode as engineAddNode, hashNodeSource as engineHashNodeSource } from './common_engine/node_factory_ops.js'
import { collectNestedExecutableNode as engineCollectNestedExecutableNode } from './common_engine/walk_engine.js'
import { findAncestor as engineFindAncestor, sameSpan as engineSameSpan } from './common_engine/shared_utils.js'
import { processClassBody as engineProcessClassBody, type DeclarationHooks } from './common_engine/declaration_walker.js'
import { DART_LANGUAGE_SPEC } from './dart_hooks/dart_language_spec.js'
import { findChild, findDescendant, stripQuotes } from './dart_hooks/dart_node_utils.js'
import { extractAnnotationInfo, type AnnotationInfo } from './dart_hooks/annotation.js'
import { extractDartCallLiteralArgs, extractNamedArg } from './dart_hooks/call_args.js'
import { extractConstructorParams } from './dart_hooks/constructor_params.js'

// ── WASM 경로 해석 ──

function resolveDartWasmPath(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url)
    const candidate = path.resolve(path.dirname(thisFile), 'wasm', 'tree-sitter-dart.wasm')
    if (fs.existsSync(candidate)) return candidate
  /* istanbul ignore next -- import.meta.url is always available in the ESM runtime used by this project */
  } catch {
    // import.meta.url 접근 불가 환경 (CJS 등) → fallback
  }
  return path.resolve(process.cwd(), 'src/pipeline_modules/build_graph/adapters/wasm/tree-sitter-dart.wasm')
}

// ── 내부 타입 ──

interface FileParseResult {
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  constructorParams: { className: string; params: ConstructorParam[] }[]
  enumValues: Map<string, string>
  fieldOrigins?: FieldOriginsMap
}

// AnnotationInfo, extractAnnotationInfo는 dart_hooks/annotation.ts로 이동.

interface ParseContext {
  filePath: string
  repoId: string
  isTest: boolean
  test_type: 'unit' | 'integration' | 'e2e' | null
  sourceLines: string[]
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  constructorParams: { className: string; params: ConstructorParam[] }[]
  // D1: importSymbolMap (Dart `import 'pkg/foo.dart' show A, B;` → A,B → 'pkg/foo.dart')
  // show clause 없이 단순 import면 같은 URI를 default key로 사용 (각 type 미리 알 수 없음 — 빈 map 유지)
  importSymbolMap: Map<string, string>
  // show clause 없는 import URI들 (type_ref specifier fallback용)
  importUris: string[]
  // D3: classKey({repoId}:{filePath}:{ClassName}) → fieldName → FieldOrigin
  fieldOrigins: FieldOriginsMap
  // 같은 file 안 정의된 class 이름 (RHS=ClassName() 추적용)
  localClassNames: Set<string>
  // 현재 처리 중 class의 classKey (this.X self lookup용)
  currentClassKey: string | null
  // C3: 엔진 collectNestedExecutableNode 의 nested-exec visited dedup (WalkEngineCtx 충족).
  visitedNestedExecutableRanges: Set<string>
}

// ── DartParserAdapter ──

export class DartParserAdapter implements ParserAdapter {
  private parser: Parser

  private constructor(parser: Parser) {
    this.parser = parser
  }

  static async create(): Promise<DartParserAdapter> {
    await Parser.init()
    const wasmPath = resolveDartWasmPath()
    const dartLang = await Language.load(wasmPath)
    const parser = new Parser()
    parser.setLanguage(dartLang)
    return new DartParserAdapter(parser)
  }

  supportedExtensions(): string[] {
    return ['.dart']
  }

  parseFile(
    content: string,
    filePath: string,
    repoId: string,
  ): FileParseResult {
    const { isTest, test_type } = getTestInfo(filePath)

    let tree: ReturnType<typeof this.parser.parse>
    try {
      tree = this.parser.parse(content)
    } catch {
      tree = null
    }

    if (!tree) {
      const fileNode = makeFileNode(filePath, repoId, isTest, test_type, 'failed')
      return { nodes: [fileNode], edges: [], constructorParams: [], enumValues: new Map() }
    }

    const ctx: ParseContext = {
      filePath,
      repoId,
      isTest,
      test_type,
      sourceLines: content.split('\n'),
      nodes: [],
      edges: [],
      constructorParams: [],
      importSymbolMap: new Map(),
      importUris: [],
      fieldOrigins: new Map(),
      localClassNames: collectLocalClassNames(tree.rootNode),
      currentClassKey: null,
      visitedNestedExecutableRanges: new Set<string>(),
    }

    const fileNode = makeFileNode(filePath, repoId, isTest, test_type, 'ok')
    ctx.nodes.push(fileNode)

    parseRoot(tree.rootNode, ctx)
    if (tree.rootNode.type === 'ERROR') {
      processMalformedOperatorFallback(tree.rootNode, ctx)
      processMalformedLocalVariableFallback(tree.rootNode, ctx, null)
    }

    return {
      nodes: ctx.nodes,
      edges: ctx.edges,
      constructorParams: ctx.constructorParams,
      enumValues: new Map(),
      fieldOrigins: ctx.fieldOrigins,
    }
  }
}

// D3: 같은 file 안 정의된 class 이름 수집
function collectLocalClassNames(root: SNode): Set<string> {
  const set = new Set<string>()
  function walk(node: SNode): void {
    if (!node.isNamed) return
    if (node.type === 'class_definition') {
      const id = node.children.find(c => c.isNamed && c.type === 'identifier')
      if (id) set.add(id.text)
    }
    for (const c of node.children) walk(c)
  }
  walk(root)
  return set
}

// D3: field origin 추론 — annotation 우선 → RHS 분석
const DART_BUILTIN_TYPE_NAMES = new Set<string>([
  'List', 'Map', 'Set', 'Iterable', 'Future', 'Stream', 'Duration', 'DateTime',
  'RegExp', 'Symbol', 'Type', 'Pattern', 'Comparable',
])

const RIVERPOD_REF_METHODS = new Set(['watch', 'read', 'refresh', 'invalidate', 'listen'])

function inferDartFieldOrigin(
  declNode: SNode,
  ctx: ParseContext,
): FieldOrigin {
  // 1. annotation type 우선
  const typeNodes = findFieldTypeNodes(declNode)
  if (typeNodes.length > 0) {
    for (const tn of typeNodes) {
      if (tn.type === 'type_identifier') {
        // codegraph 통합: type 표기 경로도 공유 엔진(resolveDartTypeOrigin)으로 통일.
        // 이전 inline 로직과 동일하되, import 를 isLocalImport 로 판정(로컬 파일 타입 → internal)하는
        // 개선만 추가 (RHS 경로와 일관). 'Function' 은 DART_PRIMITIVE_TYPES 에 있어 primitive 로 분류(기존과 동일).
        return resolveDartTypeOrigin(tn.text, ctx)
      }
      if (tn.type === 'function_type') return { kind: 'function' }
    }
  }
  // 2. RHS 분석 — initialized_identifier 안 '=' 다음 sibling 시리즈
  const rhsSiblings = findInitializerSiblings(declNode)
  if (rhsSiblings.length > 0) {
    return inferDartOriginFromInitializer(rhsSiblings, ctx)
  }
  return { kind: 'unknown' }
}

// initialized_identifier 안 '=' 다음 모든 isNamed children
function findInitializerSiblings(declNode: SNode): SNode[] {
  const idList = findChild(declNode, 'initialized_identifier_list')
  if (!idList) return []
  const initId = findChild(idList, 'initialized_identifier')
  if (!initId) return []
  const result: SNode[] = []
  let seenEq = false
  for (const c of initId.children) {
    if (!seenEq) {
      if (c.text === '=') seenEq = true
      continue
    }
    if (c.isNamed) result.push(c)
  }
  return result
}

function inferDartOriginFromInitializer(siblings: SNode[], ctx: ParseContext): FieldOrigin {
  if (siblings.length === 0) return { kind: 'unknown' }
  const first = siblings[0]

  // function literal
  if (first.type === 'function_expression' || first.type === 'function_body') {
    return { kind: 'function' }
  }
  // primitive literal
  if (
    first.type === 'string_literal' || first.type === 'numeric_literal' ||
    first.type === 'true' || first.type === 'false' || first.type === 'null_literal' ||
    first.type === 'list_literal' || first.type === 'set_or_map_literal'
  ) {
    return { kind: 'primitive' }
  }

  // identifier (root) + 다음 sibling 분석
  if (first.type === 'identifier') {
    const next = siblings[1]
    if (next && next.type === 'selector') {
      // constructor call: argument_part 직속 → TypeName() 호출 → resolveTypeOrigin
      if (findChild(next, 'argument_part')) {
        return resolveDartTypeOrigin(first.text, ctx)
      }
      // member access: .identifier → reference
      const sel = findChild(next, 'unconditional_assignable_selector') ?? next
      const dotIdent = sel.children.find(c => c.isNamed && c.type === 'identifier')
      if (dotIdent) {
        return { kind: 'reference', rootName: first.text, memberName: dotIdent.text }
      }
    }
    return resolveDartTypeOrigin(first.text, ctx)
  }
  return { kind: 'unknown' }
}

// codegraph 통합: Dart 도 공유 엔진 resolveTypeOriginWith 를 탄다. 데이터(룰북)만 Dart 고유.
// Dart import URI: 'package:'·'dart:' = 외부 SDK/패키지(external), 그 외 상대경로 = 우리 repo 파일(internal).
// (이전엔 import 전부 external 로 분류 → 로컬 파일 타입을 놓침. 이제 TS 와 동일 품질로 internal 판정.)
function dartIsLocalImport(uri: string): boolean {
  return !uri.startsWith('package:') && !uri.startsWith('dart:')
}

// DART_PRIMITIVE_TYPES 가 파일 뒤쪽(1700+)에 선언돼 있어 module-level const 로 만들면 TDZ.
// 호출 시점(함수 body)에서 룰을 구성한다 — 기존 코드도 이 세트들을 함수 안에서만 참조.
function dartTypeOriginRules(): TypeOriginRules {
  return {
    builtinTypeNames: DART_BUILTIN_TYPE_NAMES,
    primitiveTypeNames: DART_PRIMITIVE_TYPES,
    isLocalImport: dartIsLocalImport,
  }
}

function resolveDartTypeOrigin(typeName: string, ctx: ParseContext): FieldOrigin {
  return resolveTypeOriginWith(typeName, ctx.localClassNames, ctx.importSymbolMap, dartTypeOriginRules())
}

// Phase C: common_engine 의 recordFieldOrigin 소비 (classKey = engineNodeId).
function recordFieldOrigin(
  ctx: ParseContext,
  className: string,
  fieldName: string,
  origin: FieldOrigin,
): void {
  engineRecordFieldOrigin(ctx.fieldOrigins, engineNodeId(ctx.repoId, ctx.filePath, className), fieldName, origin)
}

// ── 파서 초기화 상태 캐시 ──
// Parser.init()은 멱등이지만 매번 await하면 오버헤드 있음 — 내부에서 한 번만 호출됨

// ── 루트 노드 파싱 ──

function parseRoot(root: SNode, ctx: ParseContext): void {
  let pendingJsdoc: string | null = null
  let pendingAnnotations: AnnotationInfo[] = []
  // top-level function pair state
  let pendingFnSig: {
    name: string
    exported: boolean
    signature: string | null
    lineStart: number
    lineEnd: number
    jsdoc: string | null
    annotations: AnnotationInfo[]
  } | null = null

  const children = root.children

  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    if (!node.isNamed) {
      const consumed = handleFragmentedClass(children, i, ctx, pendingJsdoc, pendingAnnotations)
      if (consumed > 0) {
        i += consumed
        pendingJsdoc = null
        pendingAnnotations = []
        pendingFnSig = null
      }
      continue
    }

    switch (node.type) {
      case 'documentation_comment': {
        // consecutive /// lines each become a separate documentation_comment node
        const line = extractJsdocLine(node)
        if (line !== null) {
          pendingJsdoc = pendingJsdoc !== null ? pendingJsdoc + '\n' + line : line
        }
        break
      }

      case 'annotation':
      case 'marker_annotation':
        pendingAnnotations.push(extractAnnotationInfo(node))
        break

      case 'import_or_export':
        processImport(node, ctx)
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'class_definition':
        processClass(node, ctx, pendingJsdoc, pendingAnnotations, 'class')
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'mixin_declaration':
        processClass(node, ctx, pendingJsdoc, pendingAnnotations, 'class')
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'extension_declaration':
        processClass(node, ctx, pendingJsdoc, pendingAnnotations, 'class')
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'enum_declaration':
        processEnum(node, ctx, pendingJsdoc)
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'type_alias':
        processTypeAlias(node, ctx, pendingJsdoc)
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'function_signature': {
        // top-level function: function_signature followed by function_body sibling
        const name = extractFnSigName(node)
        if (name) {
          pendingFnSig = {
            name,
            exported: !name.startsWith('_'),
            signature: extractFnSignature(node),
            lineStart: lineStartWithAnnotations(node.startPosition.row + 1, pendingAnnotations),
            lineEnd: node.endPosition.row + 1,
            jsdoc: pendingJsdoc,
            annotations: pendingAnnotations,
          }
        }
        pendingJsdoc = null
        pendingAnnotations = []
        break
      }

      case 'function_body': {
        if (pendingFnSig) {
          const isAsync = node.text.trimStart().startsWith('async')
          const fnNode: CodeNodeRaw = {
            id: nodeId(ctx, pendingFnSig.name),
            repo_id: ctx.repoId,
            type: 'function',
            file_path: ctx.filePath,
            name: pendingFnSig.name,
            line_start: pendingFnSig.lineStart,
            line_end: node.endPosition.row + 1,
            signature: pendingFnSig.signature,
            exported: pendingFnSig.exported,
            parse_status: 'ok',
            is_test: ctx.isTest,
            test_type: ctx.test_type,
            is_async: isAsync,
            jsdoc: pendingFnSig.jsdoc,
          }
          addNode(ctx, fnNode)
          // calls edges from function body
          scanCallsEdges(node, ctx, fnNode.id, { ownerName: pendingFnSig.name })
          // D2: function body 안 import-bound identifier reference → depends_on
          emitBodyIdentifierDependsOn(node, ctx, fnNode.id)
          // decorates edges
          for (const ann of pendingFnSig.annotations) {
            ctx.edges.push(makeEdge(ctx, {
              source_id: fnNode.id,
              target_id: null,
              relation: 'decorates',
              target_specifier: null,
              target_symbol: ann.name,
              resolve_status: 'pending',
              first_arg: ann.firstArg,
              literal_args: ann.literalArgs,
            }))
          }
          pendingFnSig = null
        }
        break
      }

      case 'static_final_declaration_list':
        processTopLevelVariables(node, ctx, pendingJsdoc)
        scanCallsEdges(node, ctx, fileId(ctx), { createCallbackNodes: false })
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'initialized_identifier_list':
        processTopLevelIdentifierList(node, ctx, pendingJsdoc)
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'local_variable_declaration':
        processTopLevelLocalVariableDeclaration(node, ctx, pendingJsdoc)
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'ERROR': {
        // D-1: WASM grammar가 'sealed class X'/'final class X'/'interface class X'/'base class X'를
        // ERROR로 처리. 다음 sibling block을 class body로 묶어 fallback parsing
        const consumed = handleDart30ModifierClass(children, i, ctx, pendingJsdoc, pendingAnnotations)
        if (consumed > 0) {
          i += consumed
          pendingJsdoc = null
          pendingAnnotations = []
        } else {
          processMalformedOperatorFallback(node, ctx)
          processMalformedLocalVariableFallback(node, ctx, pendingJsdoc)
        }
        break
      }

      default:
        // const_builtin, final_builtin, etc. — skip but keep pending state only if non-semantic
        if (
          node.type !== 'final_builtin' &&
          node.type !== 'const_builtin' &&
          node.type !== 'inferred_type' &&
          node.type !== 'type_identifier' &&
          node.type !== 'type_name' &&
          node.type !== 'nullable_type' &&
          node.type !== 'late_builtin'
        ) {
          // If we hit something non-trivial, clear pending fn sig state
          pendingFnSig = null
        }
        break
    }
  }
}

function processMalformedOperatorFallback(node: SNode, ctx: ParseContext): void {
  const candidates: SNode[] = []

  function walk(current: SNode): void {
    if (
      current.isNamed &&
      current.type === 'initialized_variable_definition' &&
      current.children.some((child) => child.isNamed && child.type === 'identifier' && child.text === 'operator')
    ) {
      candidates.push(current)
      return
    }
    for (const child of current.children) {
      if (child.isNamed) walk(child)
    }
  }

  walk(node)

  for (const candidate of candidates) {
    addNode(ctx, {
      id: nodeId(ctx, 'operator'),
      repo_id: ctx.repoId,
      type: 'function',
      file_path: ctx.filePath,
      name: 'operator',
      line_start: candidate.startPosition.row + 1,
      line_end: candidate.endPosition.row + 1,
      signature: candidate.text.length <= 200 ? candidate.text.replace(/\s+/g, ' ').trim() : null,
      exported: true,
      parse_status: 'ok',
      is_test: ctx.isTest,
      test_type: ctx.test_type,
      is_async: false,
      jsdoc: null,
    })
  }
}

function processMalformedLocalVariableFallback(
  node: SNode,
  ctx: ParseContext,
  jsdoc: string | null,
): void {
  const declarations: SNode[] = []

  function walk(current: SNode): void {
    if (!current.isNamed) return
    if (current.type === 'local_variable_declaration') {
      declarations.push(current)
      return
    }
    for (const child of current.children) {
      if (child.isNamed) walk(child)
    }
  }

  walk(node)

  for (const declaration of declarations) {
    const includePlainVariables = !hasAncestorOfType(declaration, 'function_body')
    if (isLocalVariableDeclarationAlreadyCaptured(declaration, ctx, includePlainVariables)) continue
    processTopLevelLocalVariableDeclaration(declaration, ctx, jsdoc, includePlainVariables)
  }
}

function isLocalVariableDeclarationAlreadyCaptured(
  declarationNode: SNode,
  ctx: ParseContext,
  includePlainVariables: boolean,
): boolean {
  const definitions = declarationNode.children.filter(
    (child) => child.isNamed &&
      child.type === 'initialized_variable_definition' &&
      (includePlainVariables || shouldPromoteLocalVariableDefinition(child)),
  )
  return definitions.length > 0 && definitions.every((definition) => {
    const nameNode = definition.children.find((child) => child.isNamed && child.type === 'identifier')
    if (!nameNode) return false
    const nodeType: CodeNodeType = isDirectFunctionInitializer(definition) ? 'function' : 'variable'
    return hasEquivalentNode(ctx, {
      name: nameNode.text,
      type: nodeType,
      lineStart: definition.startPosition.row + 1,
      lineEnd: definition.endPosition.row + 1,
    })
  })
}

// D-1: ERROR 노드의 'sealed/final/interface/base class X' 패턴 처리
// 반환: skip할 sibling 개수 (0=처리 안 함)
function handleDart30ModifierClass(
  children: SNode[],
  startIdx: number,
  ctx: ParseContext,
  pendingJsdoc: string | null,
  pendingAnnotations: AnnotationInfo[],
): number {
  const errorNode = children[startIdx]
  if (errorNode.type !== 'ERROR') return 0
  // 'sealed/final/interface/base/mixin class X' or cascading 'class X' (modifier 영향으로 일반 class도 ERROR로 인식됨)
  // [extends Y] [implements I]
  const m = errorNode.text.match(/^\s*(?:sealed\s+|final\s+|interface\s+|base\s+|mixin\s+)?class\s+(\w+)/)
  if (!m) return 0

  const className = m[1]
  const isExported = !className.startsWith('_')
  const lineStart = lineStartWithAnnotations(errorNode.startPosition.row + 1, pendingAnnotations)

  // class body는 ERROR의 다음 sibling: 'block' (정상) 또는 'set_or_map_literal' (cascading ERROR)
  let lineEnd = errorNode.endPosition.row + 1
  let consumed = 0
  const nextSib = children[startIdx + 1]
  if (nextSib && (nextSib.type === 'block' || nextSib.type === 'set_or_map_literal')) {
    lineEnd = nextSib.endPosition.row + 1
    consumed = 1
  }

  const classNodeId = nodeId(ctx, className)
  addNode(ctx, {
    id: classNodeId,
    repo_id: ctx.repoId,
    type: 'class',
    file_path: ctx.filePath,
    name: className,
    line_start: lineStart,
    line_end: lineEnd,
    signature: null,
    exported: isExported,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc: pendingJsdoc,
  })

  // class-level decorators (annotations)
  for (const ann of pendingAnnotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: classNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }

  // extends Y (text 추출 — children에 별도 노드 없음)
  const extM = errorNode.text.match(/extends\s+(\w+)/)
  if (extM) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: classNodeId,
      target_id: null,
      relation: 'extends',
      target_specifier: ctx.importSymbolMap.get(extM[1]) ?? null,
      target_symbol: extM[1],
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
    }))
  }
  // implements I, J
  const impM = errorNode.text.match(/implements\s+([\w\s,]+)/)
  if (impM) {
    const interfaces = impM[1].split(',').map((s) => s.trim()).filter(Boolean)
    for (const inf of interfaces) {
      ctx.edges.push(makeEdge(ctx, {
        source_id: classNodeId,
        target_id: null,
        relation: 'implements',
        target_specifier: ctx.importSymbolMap.get(inf) ?? null,
        target_symbol: inf,
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      }))
    }
  }

  return consumed
}

// Some newer Dart syntax can make tree-sitter-dart split a top-level class into
// root siblings: `class`, `identifier`, `superclass`, `{`, body nodes, `}`.
// Recover enough structure for route/document context instead of losing the
// State class and its build/helper methods.
function handleFragmentedClass(
  children: SNode[],
  startIdx: number,
  ctx: ParseContext,
  pendingJsdoc: string | null,
  pendingAnnotations: AnnotationInfo[],
): number {
  const classToken = children[startIdx]
  if (classToken.type !== 'class') return 0

  const nameIdx = startIdx + 1
  const nameNode = children[nameIdx]
  if (!nameNode?.isNamed || nameNode.type !== 'identifier') return 0

  const className = nameNode.text
  const classNodeId = nodeId(ctx, className)
  const exported = !className.startsWith('_')

  let cursor = nameIdx + 1
  const superclass = children[cursor]?.isNamed && children[cursor].type === 'superclass'
    ? children[cursor]
    : null
  if (superclass) cursor++

  while (children[cursor] && children[cursor].text !== '{') cursor++
  if (!children[cursor]) return 0

  let endIdx = -1
  for (let i = cursor + 1; i < children.length; i++) {
    const child = children[i]
    if ((child.type === 'ERROR' || !child.isNamed) && child.text.trim() === '}') {
      endIdx = i
      continue
    }
    if (endIdx >= 0 && isTopLevelDeclarationStart(child)) break
  }
  if (endIdx < 0) return 0

  addNode(ctx, {
    id: classNodeId,
    repo_id: ctx.repoId,
    type: 'class',
    file_path: ctx.filePath,
    name: className,
    line_start: lineStartWithAnnotations(classToken.startPosition.row + 1, pendingAnnotations),
    line_end: children[endIdx].endPosition.row + 1,
    signature: null,
    exported,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc: pendingJsdoc,
  })

  for (const ann of pendingAnnotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: classNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }

  if (superclass) {
    const superName = findChild(superclass, 'type_identifier')
    if (superName) {
      ctx.edges.push(makeEdge(ctx, {
        source_id: classNodeId,
        target_id: null,
        relation: 'extends',
        target_specifier: ctx.importSymbolMap.get(superName.text) ?? null,
        target_symbol: superName.text,
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      }))
    }
    const mixins = findChild(superclass, 'mixins')
    if (mixins) {
      for (const c of mixins.children) {
        if (!c.isNamed || c.type !== 'type_identifier') continue
        ctx.edges.push(makeEdge(ctx, {
          source_id: classNodeId,
          target_id: null,
          relation: 'mixes',
          target_specifier: ctx.importSymbolMap.get(c.text) ?? null,
          target_symbol: c.text,
          resolve_status: 'pending',
          first_arg: null,
          literal_args: null,
        }))
      }
    }
  }

  processFragmentedClassBody(children.slice(cursor + 1, endIdx), ctx, className)
  return endIdx - startIdx
}

function isTopLevelDeclarationStart(node: SNode): boolean {
  if (node.type === 'class_definition' || node.type === 'mixin_declaration' ||
      node.type === 'extension_declaration' || node.type === 'enum_declaration' ||
      node.type === 'type_alias' || node.type === 'import_or_export') {
    return true
  }
  return node.type === 'ERROR' && /^\s*(?:sealed\s+|final\s+|interface\s+|base\s+|mixin\s+)?class\s+\w+/.test(node.text)
}

function processFragmentedClassBody(children: SNode[], ctx: ParseContext, className: string): void {
  let pendingJsdoc: string | null = null
  let pendingAnnotations: AnnotationInfo[] = []
  let pendingMethSig: {
    name: string
    exported: boolean
    signature: string | null
    lineStart: number
    lineEnd: number
    type: CodeNodeType
    jsdoc: string | null
    annotations: AnnotationInfo[]
    sigNode: SNode
  } | null = null

  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    if (!node.isNamed) continue

    switch (node.type) {
      case 'documentation_comment': {
        const line = extractJsdocLine(node)
        if (line !== null) {
          pendingJsdoc = pendingJsdoc !== null ? pendingJsdoc + '\n' + line : line
        }
        break
      }

      case 'annotation':
      case 'marker_annotation':
        pendingAnnotations.push(extractAnnotationInfo(node))
        break

      case 'declaration':
        processClassField(node, ctx, className, pendingJsdoc, pendingAnnotations)
        pendingJsdoc = null
        pendingAnnotations = []
        break

      case 'method_signature': {
        const methInfo = extractMethodSigInfo(node, className)
        if (methInfo) {
          pendingMethSig = {
            ...methInfo,
            lineStart: lineStartWithAnnotations(methInfo.lineStart, pendingAnnotations),
            jsdoc: pendingJsdoc,
            annotations: pendingAnnotations,
            sigNode: node,
          }
        }
        pendingJsdoc = null
        pendingAnnotations = []
        break
      }

      case 'function_body':
        if (pendingMethSig) {
          processClassMethodBody(node, ctx, className, pendingMethSig)
          pendingMethSig = null
        }
        break

      case 'local_function_declaration': {
        const name = extractLocalFunctionName(node)
        if (!name) break
        processFragmentedLocalFunction(node, ctx, className, name, pendingJsdoc, pendingAnnotations)
        pendingJsdoc = null
        pendingAnnotations = []
        pendingMethSig = null
        break
      }

      default:
        break
    }
  }
}

function processClassMethodBody(
  body: SNode,
  ctx: ParseContext,
  className: string,
  meth: {
    name: string
    exported: boolean
    signature: string | null
    lineStart: number
    jsdoc: string | null
    annotations: AnnotationInfo[]
    sigNode: SNode
  },
): void {
  const isAsync = body.text.trimStart().startsWith('async')
  const methNodeId = nodeId(ctx, `${className}.${meth.name}`)
  addNode(ctx, {
    id: methNodeId,
    repo_id: ctx.repoId,
    type: 'method',
    file_path: ctx.filePath,
    name: meth.name,
    line_start: meth.lineStart,
    line_end: body.endPosition.row + 1,
    signature: meth.signature,
    parent_node_id: nodeId(ctx, className),
    origin_kind: 'class_member',
    role: meth.name,
    exported: meth.exported,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: isAsync,
    jsdoc: meth.jsdoc,
  })
  // contains: class → method (recovered) — shared leaf (GAP-2)
  ctx.edges.push(engineBuildContainsEdge(ctx.repoId, ctx.filePath, nodeId(ctx, className), `${className}.${meth.name}`, null))
  scanCallsEdges(body, ctx, methNodeId, { ownerName: `${className}.${meth.name}` })
  emitBodyIdentifierDependsOn(body, ctx, methNodeId)

  const sigInner = findChild(meth.sigNode, 'function_signature')
                ?? findChild(meth.sigNode, 'factory_constructor_signature')
  if (sigInner) {
    if (sigInner.type === 'function_signature') {
      emitTypeRefEdges(findFnReturnTypeNodes(sigInner), ctx, methNodeId)
    }
    const fpl = findChild(sigInner, 'formal_parameter_list')
    if (fpl) {
      for (const param of fpl.children) {
        if (!param.isNamed) continue
        emitTypeRefEdges([param], ctx, methNodeId)
      }
    }
  }

  for (const ann of meth.annotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: methNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }
}

function processFragmentedLocalFunction(
  node: SNode,
  ctx: ParseContext,
  className: string,
  name: string,
  jsdoc: string | null,
  annotations: AnnotationInfo[],
): void {
  const methNodeId = nodeId(ctx, `${className}.${name}`)
  addNode(ctx, {
    id: methNodeId,
    repo_id: ctx.repoId,
    type: 'method',
    file_path: ctx.filePath,
    name,
    line_start: lineStartWithAnnotations(node.startPosition.row + 1, annotations),
    line_end: node.endPosition.row + 1,
    signature: extractLeadingSignature(node.text),
    parent_node_id: nodeId(ctx, className),
    origin_kind: 'class_member',
    role: name,
    exported: !name.startsWith('_'),
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: node.text.trimStart().startsWith('async'),
    jsdoc,
  })
  // contains: class → method (fragmented-class recovery) — shared leaf (GAP-2)
  ctx.edges.push(engineBuildContainsEdge(ctx.repoId, ctx.filePath, nodeId(ctx, className), `${className}.${name}`, null))
  scanCallsEdges(node, ctx, methNodeId, { ownerName: `${className}.${name}` })
  emitBodyIdentifierDependsOn(node, ctx, methNodeId)
  for (const ann of annotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: methNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }
}

function extractLocalFunctionName(node: SNode): string | null {
  const head = extractLeadingSignature(node.text) ?? node.text
  const match = head.match(/([_$A-Za-z][_$A-Za-z0-9]*)\s*\(/)
  return match?.[1] ?? null
}

function extractLeadingSignature(text: string): string | null {
  const idx = text.indexOf('{')
  const head = (idx >= 0 ? text.slice(0, idx) : text).replace(/\s+/g, ' ').trim()
  return head.length > 0 ? head : null
}

// ── import 처리 ──

function processImport(importOrExport: SNode, ctx: ParseContext): void {
  const libImport = findChild(importOrExport, 'library_import')
  if (!libImport) return

  const importSpec = findChild(libImport, 'import_specification')
  if (!importSpec) return

  const uri = extractUri(importSpec)
  if (!uri) return

  const combinator = findChild(importSpec, 'combinator')
  if (combinator) {
    // show clause: one edge per symbol
    const symbols = combinator.children.filter(c => c.isNamed && c.type === 'identifier')
    for (const sym of symbols) {
      ctx.edges.push(makeEdge(ctx, {
        source_id: fileId(ctx),
        target_id: null,
        relation: 'imports',
        target_specifier: uri,
        target_symbol: sym.text,
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      }))
      // D1: importSymbolMap에 등록 (show clause로 명시된 symbol들)
      ctx.importSymbolMap.set(sym.text, uri)
    }
  } else {
    // No show clause (might have as alias, we ignore the alias per spec)
    ctx.edges.push(makeEdge(ctx, {
      source_id: fileId(ctx),
      target_id: null,
      relation: 'imports',
      target_specifier: uri,
      target_symbol: null,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
    }))
    // D1: show 없는 import URI 보존 (type_ref specifier fallback용)
    ctx.importUris.push(uri)
  }
}

// ── class/mixin/extension 처리 ──

function processClass(
  node: SNode,
  ctx: ParseContext,
  jsdoc: string | null,
  annotations: AnnotationInfo[],
  _type: CodeNodeType,
): void {
  const nameNode = node.children.find(c => c.isNamed && c.type === 'identifier')
  if (!nameNode) return
  const className = nameNode.text
  const exported = !className.startsWith('_')

  const classNodeId = nodeId(ctx, className)
  const classNode: CodeNodeRaw = {
    id: classNodeId,
    repo_id: ctx.repoId,
    type: 'class',
    file_path: ctx.filePath,
    name: className,
    line_start: lineStartWithAnnotations(node.startPosition.row + 1, annotations),
    line_end: node.endPosition.row + 1,
    signature: null,
    exported,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc,
  }
  addNode(ctx, classNode)

  // decorates edges (class-level annotations)
  for (const ann of annotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: classNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }

  // D-7: class generic type bound `<T extends Comparable>` → type_ref edge
  // type_parameters > type_parameter > type_bound > type_identifier (또는 generic_type)
  const typeParams = findChild(node, 'type_parameters')
  if (typeParams) {
    const boundTypeNodes: SNode[] = []
    for (const tp of typeParams.children) {
      if (!tp.isNamed) continue
      if (tp.type !== 'type_parameter') continue
      const bound = findChild(tp, 'type_bound')
      if (!bound) continue
      for (const c of bound.children) {
        if (!c.isNamed) continue
        if (c.type === 'type_identifier' || c.type === 'type_arguments' ||
            c.type === 'type_name' || c.type === 'nullable_type') {
          boundTypeNodes.push(c)
        }
      }
    }
    emitTypeRefEdges(boundTypeNodes, ctx, classNodeId)
  }

  // D5: extension declaration의 'on Type' → type_ref edge
  if (node.type === 'extension_declaration') {
    // extension의 children: identifier(extension name)? + type_identifier(on Target) + type_arguments? + extension_body
    // type_identifier + 그 직후 type_arguments까지 묶어서 type_ref 발화 (generic root + nested)
    const onTypeNodes: SNode[] = []
    let foundOnType = false
    for (const c of node.children) {
      if (!c.isNamed) continue
      if (c.type === 'extension_body') break
      if (c.type === 'type_parameters') continue  // extension generics (<K, V>) skip
      if (c.type === 'type_identifier' || c.type === 'type_arguments') {
        if (c.type === 'type_identifier' && !foundOnType) {
          // 첫 type_identifier — extension name 다음에 오는 'on Target'
          // 단 unnamed extension은 'identifier' 없이 바로 type_identifier
          // 어느 쪽이든 첫 type_identifier가 on Target
          foundOnType = true
        }
        onTypeNodes.push(c)
      }
    }
    emitTypeRefEdges(onTypeNodes, ctx, classNodeId)
  }

  // extends / implements / mixes edges (only class_definition has superclass/interfaces)
  if (node.type === 'class_definition') {
    const superclass = findChild(node, 'superclass')
    if (superclass) {
      const superName = findChild(superclass, 'type_identifier')
      if (superName) {
        ctx.edges.push(makeEdge(ctx, {
          source_id: classNodeId,
          target_id: null,
          relation: 'extends',
          target_specifier: ctx.importSymbolMap.get(superName.text) ?? null,
          target_symbol: superName.text,
          resolve_status: 'pending',
          first_arg: null,
          literal_args: null,
        }))
      }
      // D4: with clause → mixes edge (superclass > mixins > type_identifier)
      const mixins = findChild(superclass, 'mixins')
      if (mixins) {
        for (const c of mixins.children) {
          if (!c.isNamed) continue
          if (c.type === 'type_identifier') {
            ctx.edges.push(makeEdge(ctx, {
              source_id: classNodeId,
              target_id: null,
              relation: 'mixes',
              target_specifier: ctx.importSymbolMap.get(c.text) ?? null,
              target_symbol: c.text,
              resolve_status: 'pending',
              first_arg: null,
              literal_args: null,
            }))
          }
        }
      }
    }

    const interfaces = findChild(node, 'interfaces')
    if (interfaces) {
      for (const child of interfaces.children) {
        if (child.isNamed && child.type === 'type_identifier') {
          ctx.edges.push(makeEdge(ctx, {
            source_id: classNodeId,
            target_id: null,
            relation: 'implements',
            target_specifier: ctx.importSymbolMap.get(child.text) ?? null,
            target_symbol: child.text,
            resolve_status: 'pending',
            first_arg: null,
            literal_args: null,
          }))
        }
      }
    }
  }

  // class body: methods, constructors
  const bodyNode = findChild(node, 'class_body') ?? findChild(node, 'extension_body')
  if (bodyNode) {
    processClassBody(bodyNode, ctx, className)
  }
}

// ── class body 처리 ──

// Dart class-body 의 forward-flowing pending state. 공유 엔진 processClassBody 의 loop 가 stateless
// hook 을 (member, members, index) 로 부르므로, loop-local 변수 대신 hook 들이 closure 로 닫는 이 scratch 에
// 보관한다 (documentation_comment / annotation / method_signature 가 다음 멤버로 누적되는 Dart 특성).
interface DartClassBodyState {
  pendingJsdoc: string | null
  pendingAnnotations: AnnotationInfo[]
  pendingMethSig: {
    name: string
    exported: boolean
    signature: string | null
    lineStart: number
    lineEnd: number
    type: CodeNodeType
    jsdoc: string | null
    annotations: AnnotationInfo[]
    sigNode: SNode  // D1: type_ref용 raw node 보존
  } | null
  fieldTypes: Map<string, string>
}

// 버퍼링된 method_signature + 그 function_body → method 노드 + contains + calls + type_ref + decorates.
function emitDartMethodNode(bodyNode: SNode, sig: NonNullable<DartClassBodyState['pendingMethSig']>, className: string, ctx: ParseContext): void {
  const isAsync = bodyNode.text.trimStart().startsWith('async')
  const methNodeId = nodeId(ctx, `${className}.${sig.name}`)
  const methNode: CodeNodeRaw = {
    id: methNodeId,
    repo_id: ctx.repoId,
    type: 'method',
    file_path: ctx.filePath,
    name: sig.name,
    line_start: sig.lineStart,
    line_end: bodyNode.endPosition.row + 1,
    signature: sig.signature,
    parent_node_id: nodeId(ctx, className),
    origin_kind: 'class_member',
    role: sig.name,
    exported: sig.exported,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: isAsync,
    jsdoc: sig.jsdoc,
  }
  addNode(ctx, methNode)
  // contains edge: class → method (Dart: target_symbol=null) — shared leaf (GAP-2)
  ctx.edges.push(engineBuildContainsEdge(ctx.repoId, ctx.filePath, nodeId(ctx, className), `${className}.${sig.name}`, null))
  // calls edges from method body
  scanCallsEdges(bodyNode, ctx, methNodeId, { ownerName: `${className}.${sig.name}` })
  // BG-4 (def-use): method-local receiver vars → variable node (after calls so chain_path edges exist)
  emitDartLocalReceiverVars(bodyNode, ctx, methNodeId)
  // D2: method body 안 import-bound identifier reference → depends_on
  emitBodyIdentifierDependsOn(bodyNode, ctx, methNodeId)
  // D1+D5: method/factory signature의 param/return type → type_ref edges
  const sigInner = findChild(sig.sigNode, 'function_signature')
                ?? findChild(sig.sigNode, 'factory_constructor_signature')
  if (sigInner) {
    if (sigInner.type === 'function_signature') {
      emitTypeRefEdges(findFnReturnTypeNodes(sigInner), ctx, methNodeId)
    }
    const fpl = findChild(sigInner, 'formal_parameter_list')
    if (fpl) {
      for (const param of fpl.children) {
        if (!param.isNamed) continue
        emitTypeRefEdges([param], ctx, methNodeId)
      }
    }
  }
  // decorates edges (Dart: target_specifier=null)
  for (const ann of sig.annotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: methNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }
}

// Dart DeclarationHooks (ctx/className/scratch 를 closure). 공유 engine processClassBody 가 구동(STEP B).
// 주의: Dart 는 engine 의 'constructor' kind 를 쓰지 않는다 — 그 kind 는 노드 없이 DI param 만 버퍼하지만
// Dart ctor 는 full 노드 + contains(target_symbol:null) 를 내므로 'method' 로 분류하고 processMethod 가 내부 디스패치.
function makeDartDeclarationHooks(ctx: ParseContext, className: string, scratch: DartClassBodyState): DeclarationHooks<SNode> {
  return {
    resolveClassBody: (n: SNode): SNode | null => n,
    classifyMember: (member: SNode, _members: SNode[], _index: number): 'method' | 'field' | 'constructor' | 'skip' => {
      if (!member.isNamed) return 'skip'
      switch (member.type) {
        case 'documentation_comment': {
          const line = extractJsdocLine(member)
          if (line !== null) scratch.pendingJsdoc = scratch.pendingJsdoc !== null ? scratch.pendingJsdoc + '\n' + line : line
          return 'skip'
        }
        case 'annotation':
        case 'marker_annotation':
          scratch.pendingAnnotations.push(extractAnnotationInfo(member))
          return 'skip'
        case 'declaration':
          // ctor-no-body → 'method' (processMethod → processConstructor); 아니면 field
          return findChild(member, 'constructor_signature') ? 'method' : 'field'
        case 'method_signature': {
          const ctorSig = findChild(member, 'constructor_signature')
          if (ctorSig && isDartConstructorSignature(ctorSig, className)) return 'method'
          const methInfo = extractMethodSigInfo(member, className)
          if (methInfo) {
            scratch.pendingMethSig = {
              ...methInfo,
              lineStart: lineStartWithAnnotations(methInfo.lineStart, scratch.pendingAnnotations),
              jsdoc: scratch.pendingJsdoc,
              annotations: scratch.pendingAnnotations,
              sigNode: member,
            }
          }
          scratch.pendingJsdoc = null
          scratch.pendingAnnotations = []
          return 'skip'
        }
        case 'function_body':
          return scratch.pendingMethSig ? 'method' : 'skip'
        default:
          return 'skip'
      }
    },
    collectConstructorParams: (_member: SNode): ConstructorParam[] => [],
    processMethod: (member: SNode, members: SNode[], index: number, _className: string, _classExported: boolean, _classNodeId: string): void => {
      if (member.type === 'function_body') {
        if (scratch.pendingMethSig) {
          emitDartMethodNode(member, scratch.pendingMethSig, className, ctx)
          scratch.pendingMethSig = null
        }
        return
      }
      if (member.type === 'method_signature') {
        // ctor-with-body: function_body 를 sibling lookahead 로 페어링
        const ctorSig = findChild(member, 'constructor_signature')
        if (ctorSig) {
          const bodyNode = nextNamedSibling(members, index, 'function_body')
          processConstructor(ctorSig, ctx, className, scratch.pendingJsdoc, scratch.pendingAnnotations, scratch.fieldTypes, bodyNode)
        }
        scratch.pendingJsdoc = null
        scratch.pendingAnnotations = []
        scratch.pendingMethSig = null
        return
      }
      if (member.type === 'declaration') {
        // ctor-no-body
        const ctorSig = findChild(member, 'constructor_signature')
        if (ctorSig) processConstructor(ctorSig, ctx, className, scratch.pendingJsdoc, scratch.pendingAnnotations, scratch.fieldTypes)
        scratch.pendingJsdoc = null
        scratch.pendingAnnotations = []
      }
    },
    processField: (member: SNode, _className: string, _classExported: boolean): void => {
      // E7 — class field declaration (annotation 있으면 property 노드 + decorates edge)
      processClassField(member, ctx, className, scratch.pendingJsdoc, scratch.pendingAnnotations)
      scratch.pendingJsdoc = null
      scratch.pendingAnnotations = []
    },
  }
}

function processClassBody(body: SNode, ctx: ParseContext, className: string): void {
  const scratch: DartClassBodyState = {
    pendingJsdoc: null,
    pendingAnnotations: [],
    pendingMethSig: null,
    // First pass: collect field declarations for DI type lookup
    fieldTypes: collectClassFieldTypes(body),
  }
  // STEP B: 공유 엔진 processClassBody 가 loop/dispatch/currentClassKey-scope/ctor-param 버퍼링을 소유.
  // Dart 는 5개 hook 만 제공 — per-member emit 은 Dart-local 유지 (null target_symbol contains,
  // null target_specifier decorates, subtype 없는 type_ref 가 engine leaf 와 발산하므로 hook 안에서 직접 emit).
  // Dart ctor 는 processConstructor 가 ctx.constructorParams 에 직접 push → 엔진 반환값은 비어있음(flush 안 함).
  // (TS typescript.ts:1297 / JVM jvm_ast.ts:605 에 이어 Dart = 3번째 uniform consumer.)
  engineProcessClassBody(body, ctx, className, true, makeDartDeclarationHooks(ctx, className, scratch))
}

// ── constructor 처리 ──

function processConstructor(
  ctorSig: SNode,
  ctx: ParseContext,
  className: string,
  jsdoc: string | null,
  annotations: AnnotationInfo[],
  fieldTypes: Map<string, string>,
  bodyNode?: SNode | null,
): void {
  // Named constructor: has two identifier children (ClassName + methodName)
  // Default constructor: has one identifier child (ClassName)
  const identifiers = ctorSig.children.filter(c => c.isNamed && c.type === 'identifier')

  let ctorName: string
  if (identifiers.length >= 2) {
    // Named constructor: 'ClassName.named'
    ctorName = `${identifiers[0].text}.${identifiers[1].text}`
  } else {
    // Default constructor: name = class name
    ctorName = className
  }

  const exported = !ctorName.startsWith('_')
  const ctorNodeId = nodeId(ctx, `${className}.${ctorName}`)

  const ctorNode: CodeNodeRaw = {
    id: ctorNodeId,
    repo_id: ctx.repoId,
    type: 'method',
    file_path: ctx.filePath,
    name: ctorName,
    line_start: ctorSig.startPosition.row + 1,
    line_end: (bodyNode ?? ctorSig).endPosition.row + 1,
    signature: extractCtorSignature(ctorSig),
    parent_node_id: nodeId(ctx, className),
    origin_kind: 'class_member',
    role: ctorName,
    exported,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc,
  }
  addNode(ctx, ctorNode)
  // contains edge: class → constructor — shared leaf (GAP-2)
  ctx.edges.push(engineBuildContainsEdge(ctx.repoId, ctx.filePath, nodeId(ctx, className), `${className}.${ctorName}`, null))

  // Constructor params for DI
  const params = extractConstructorParams(ctorSig, fieldTypes)
  if (params.length > 0 || isDefaultConstructorName(ctorName, className)) {
    ctx.constructorParams.push({ className, params })
  }

  // decorates
  for (const ann of annotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: ctorNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }

  if (bodyNode) {
    scanCallsEdges(bodyNode, ctx, ctorNodeId, { ownerName: ctorName })
    emitBodyIdentifierDependsOn(bodyNode, ctx, ctorNodeId)
  }

  // D-8: initializer list 안 super(...) / super.named(...) 호출 → calls edge
  const decl = ctorSig.parent
  if (decl) {
    const initializers = findChild(decl, 'initializers')
    if (initializers) {
      for (const entry of initializers.children) {
        if (!entry.isNamed) continue
        if (entry.type !== 'initializer_list_entry') continue
        // 'super' 시작인 entry만 (this.field=... 같은 다른 initializer skip)
        if (!entry.text.trimStart().startsWith('super')) continue
        // super.named의 'named' identifier — qualified 노드 안 또는 직접 child
        let namedIdent: SNode | undefined
        const qualified = entry.children.find((c) => c.isNamed && c.type === 'qualified')
        if (qualified) {
          namedIdent = qualified.children.find((c) => c.isNamed && c.type === 'identifier')
        } else {
          namedIdent = entry.children.find((c) => c.isNamed && c.type === 'identifier')
        }
        const args = findChild(entry, 'arguments')
        const firstArg = args ? extractFirstStringArgGeneric(args) : null
        const literalArgs = args ? extractDartCallLiteralArgs(args) : null
        ctx.edges.push(makeEdge(ctx, {
          source_id: ctorNodeId,
          target_id: null,
          relation: 'calls',
          target_specifier: namedIdent ? `super.${namedIdent.text}` : 'super',
          target_symbol: namedIdent?.text ?? null,
          resolve_status: 'pending',
          first_arg: firstArg,
          literal_args: literalArgs,
          chain_path: 'super',
        }))
      }
    }
  }
}

function isDefaultConstructorName(ctorName: string, className: string): boolean {
  return ctorName === className
}

function isDartConstructorSignature(ctorSig: SNode, className: string): boolean {
  const firstIdentifier = ctorSig.children.find(c => c.isNamed && c.type === 'identifier')
  return firstIdentifier?.text === className
}

// ── enum 처리 ──

function processEnum(node: SNode, ctx: ParseContext, jsdoc: string | null): void {
  const nameNode = node.children.find(c => c.isNamed && c.type === 'identifier')
  if (!nameNode) return
  const enumName = nameNode.text

  addNode(ctx, {
    id: nodeId(ctx, enumName),
    repo_id: ctx.repoId,
    type: 'enum',
    file_path: ctx.filePath,
    name: enumName,
    line_start: node.startPosition.row + 1,
    line_end: node.endPosition.row + 1,
    signature: null,
    exported: !enumName.startsWith('_'),
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc,
  })
  // enumValues: empty Map (Dart enums have no string literal values — spec §2-2)
}

// ── type alias 처리 ──

function processTypeAlias(node: SNode, ctx: ParseContext, jsdoc: string | null): void {
  const nameNode = node.children.find(c => c.isNamed && c.type === 'type_identifier')
  if (!nameNode) return
  const typeName = nameNode.text

  addNode(ctx, {
    id: nodeId(ctx, typeName),
    repo_id: ctx.repoId,
    type: 'type',
    file_path: ctx.filePath,
    name: typeName,
    line_start: node.startPosition.row + 1,
    line_end: node.endPosition.row + 1,
    signature: null,
    exported: !typeName.startsWith('_'),
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc,
  })
}

// ── top-level variables 처리 ──

function processTopLevelVariables(
  listNode: SNode,
  ctx: ParseContext,
  jsdoc: string | null,
): void {
  for (const decl of listNode.children) {
    if (!decl.isNamed || decl.type !== 'static_final_declaration') continue

    const nameNode = decl.children.find(c => c.isNamed && c.type === 'identifier')
    if (!nameNode) continue
    const varName = nameNode.text

    // Only a direct function literal initializer is a function node.
    // Callback literals inside call chains (e.g. response.fold((l) => ...)) stay variables.
    const isFn = isDirectFunctionInitializer(decl)
    const nodeType: CodeNodeType = isFn ? 'function' : 'variable'

    addNode(ctx, {
      id: nodeId(ctx, varName),
      repo_id: ctx.repoId,
      type: nodeType,
      file_path: ctx.filePath,
      name: varName,
      line_start: listNode.startPosition.row + 1,
      line_end: listNode.endPosition.row + 1,
      signature: null,
      exported: !varName.startsWith('_'),
      parse_status: 'ok',
      is_test: ctx.isTest,
      test_type: ctx.test_type,
      is_async: false,
      jsdoc,
    })

    scanCallsEdges(decl, ctx, nodeId(ctx, varName), {
      ownerName: varName,
      skipFunctionExpression: directFunctionInitializer(decl),
    })
    emitRiverpodNotifierProviderEdge(decl, ctx, nodeId(ctx, varName))
  }
}

function processTopLevelIdentifierList(
  listNode: SNode,
  ctx: ParseContext,
  jsdoc: string | null,
): void {
  for (const decl of listNode.children) {
    if (!decl.isNamed || decl.type !== 'initialized_identifier') continue

    const nameNode = findChild(decl, 'identifier')
    if (!nameNode) continue
    const varName = nameNode.text
    const isFn = isDirectFunctionInitializer(decl)
    const nodeType: CodeNodeType = isFn ? 'function' : 'variable'
    const varNodeId = nodeId(ctx, varName)

    addNode(ctx, {
      id: varNodeId,
      repo_id: ctx.repoId,
      type: nodeType,
      file_path: ctx.filePath,
      name: varName,
      line_start: listNode.startPosition.row + 1,
      line_end: listNode.endPosition.row + 1,
      signature: null,
      exported: !varName.startsWith('_'),
      parse_status: 'ok',
      is_test: ctx.isTest,
      test_type: ctx.test_type,
      is_async: false,
      jsdoc,
    })

    scanCallsEdges(decl, ctx, varNodeId, {
      ownerName: varName,
      skipFunctionExpression: directFunctionInitializer(decl),
    })
    emitRiverpodNotifierProviderEdge(decl, ctx, varNodeId)
  }
}

function processTopLevelLocalVariableDeclaration(
  declarationNode: SNode,
  ctx: ParseContext,
  jsdoc: string | null,
  includePlainVariables = true,
): void {
  for (const child of declarationNode.children) {
    if (!child.isNamed || child.type !== 'initialized_variable_definition') continue
    if (includePlainVariables || shouldPromoteLocalVariableDefinition(child)) {
      processLocalVariableDefinition(child, ctx, fileId(ctx), jsdoc)
    }
  }
}

function processTopLevelVariableDefinition(
  definitionNode: SNode,
  ctx: ParseContext,
  jsdoc: string | null,
): void {
  const nameNode = definitionNode.children.find((child) => child.isNamed && child.type === 'identifier')
  if (!nameNode) return
  const varName = nameNode.text
  const isFn = isDirectFunctionInitializer(definitionNode)
  const nodeType: CodeNodeType = isFn ? 'function' : 'variable'
  const varNodeId = nodeId(ctx, varName)
  if (hasEquivalentNode(ctx, {
    name: varName,
    type: nodeType,
    lineStart: definitionNode.startPosition.row + 1,
    lineEnd: definitionNode.endPosition.row + 1,
  })) {
    return
  }

  addNode(ctx, {
    id: varNodeId,
    repo_id: ctx.repoId,
    type: nodeType,
    file_path: ctx.filePath,
    name: varName,
    line_start: definitionNode.startPosition.row + 1,
    line_end: definitionNode.endPosition.row + 1,
    signature: definitionNode.text.length <= 200 ? definitionNode.text.replace(/\s+/g, ' ').trim() : null,
    exported: !varName.startsWith('_'),
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc,
  })

  scanCallsEdges(definitionNode, ctx, varNodeId, {
    ownerName: varName,
    skipFunctionExpression: directFunctionInitializer(definitionNode),
  })
  emitRiverpodNotifierProviderEdge(definitionNode, ctx, varNodeId)
}

function emitRiverpodNotifierProviderEdge(
  definitionNode: SNode,
  ctx: ParseContext,
  sourceId: string,
): void {
  const match = definitionNode.text.match(
    /\b(?:AutoDispose)?(?:Async)?NotifierProvider(?:\.\w+)?\s*<\s*([A-Za-z_]\w*)/,
  )
  const notifierClass = match?.[1]
  if (!notifierClass) return
  ctx.edges.push(makeEdge(ctx, {
    source_id: sourceId,
    target_id: null,
    relation: 'calls',
    target_specifier: ctx.importSymbolMap.get(notifierClass) ?? null,
    target_symbol: notifierClass,
    resolve_status: 'pending',
    first_arg: null,
    literal_args: null,
    chain_path: 'riverpod_provider',
  }))
}

function isDirectFunctionInitializer(node: SNode): boolean {
  return directFunctionInitializer(node) !== null
}

function directFunctionInitializer(node: SNode): SNode | null {
  let seenEquals = false
  for (const child of node.children) {
    if (!seenEquals) {
      if (child.text === '=') seenEquals = true
      continue
    }
    if (!child.isNamed) continue
    return child.type === 'function_expression' ? child : null
  }
  return null
}

// ── D1: type_ref edge 발화 헬퍼 ──

// Dart primitive — type_ref 안 함 (noise 방지)
const DART_PRIMITIVE_TYPES = new Set<string>([
  'int', 'double', 'num', 'bool', 'String', 'void', 'dynamic', 'Object',
  'Null', 'Never', 'Function',
])

// 노드 트리에서 type_identifier 모두 추출 (generic 안 nested 포함)
function collectTypeIdentifiers(node: SNode | null, out: Set<string>): void {
  if (!node) return
  if (node.type === 'type_identifier') {
    out.add(node.text)
    return
  }
  for (const c of node.children) {
    if (c.isNamed) collectTypeIdentifiers(c, out)
  }
}

// type 노드 집합 → type_ref edge 발화 (sourceId 기준)
function emitTypeRefEdges(typeNodes: readonly (SNode | null)[], ctx: ParseContext, sourceId: string): void {
  const types = new Set<string>()
  for (const tn of typeNodes) {
    if (tn) collectTypeIdentifiers(tn, types)
  }
  for (const typeName of types) {
    if (DART_PRIMITIVE_TYPES.has(typeName)) continue
    // GAP-3: 공유 leaf (JVM emitJvmTypeRef 와 동일 edge 규약). Dart 는 subtype 미사용(null).
    ctx.edges.push(engineBuildTypeRefEdge(ctx.repoId, ctx.importSymbolMap, sourceId, typeName, null))
  }
}

// declaration 노드에서 type 부분 찾기 — type_identifier/type_arguments(generic)/type_name 등 모두 수집
// (`final List<User> users` → ['List' type_identifier, '<User>' type_arguments] 둘 다 반환)
function findFieldTypeNodes(declNode: SNode): SNode[] {
  const result: SNode[] = []
  for (const c of declNode.children) {
    if (!c.isNamed) continue
    if (c.type === 'initialized_identifier_list') break
    if (c.type === 'type_identifier' || c.type === 'type_name' ||
        c.type === 'function_type' || c.type === 'nullable_type' ||
        c.type === 'type_arguments') {
      result.push(c)
    }
  }
  return result
}

// function_signature에서 return type 노드들 (type_identifier + type_arguments + nullable_type 등)
function findFnReturnTypeNodes(fnSig: SNode): SNode[] {
  const result: SNode[] = []
  for (const c of fnSig.children) {
    if (!c.isNamed) continue
    if (c.type === 'formal_parameter_list') break
    if (c.type === 'type_identifier' || c.type === 'type_name' ||
        c.type === 'function_type' || c.type === 'nullable_type' ||
        c.type === 'type_arguments') {
      result.push(c)
    }
  }
  return result
}

// ── D2: depends_on edge 발화 (P19 패턴) ──

// 노드 트리에서 identifier 만나면 import-bound이면 depends_on 발화
// - selector chain은 root identifier만 (Dart는 .member 접근에 'identifier' 사용)
// - dedup: source 단위 seen set
function emitBodyIdentifierDependsOn(node: SNode, ctx: ParseContext, sourceId: string): void {
  walkIdentifiersForDependsOn(node, ctx, sourceId, new Set<string>())
}

function walkIdentifiersForDependsOn(
  node: SNode,
  ctx: ParseContext,
  sourceId: string,
  seen: Set<string>,
): void {
  if (node.type === 'identifier') {
    emitDependsOnIfImportBound(node.text, ctx, sourceId, seen)
    return
  }
  // selector: '.foo' 같은 property access — 이건 기본 identifier가 아니라 property name이라 skip
  // (Dart selector children: '.', identifier(property name), 또는 argument_part)
  if (node.type === 'selector') {
    // selector 안 argument_part(=함수 호출 인자)는 walk, identifier는 property name이라 skip
    for (const c of node.children) {
      if (!c.isNamed) continue
      if (c.type === 'identifier') continue   // property name skip
      walkIdentifiersForDependsOn(c, ctx, sourceId, seen)
    }
    return
  }
  // 기타 children 재귀
  for (const c of node.children) {
    if (!c.isNamed) continue
    walkIdentifiersForDependsOn(c, ctx, sourceId, seen)
  }
}

// Phase C: shared depends_on emitter from common_engine (no LanguageSpec needed — pure
// name/specifier emit). Dart keeps its OWN walkIdentifiersForDependsOn (Dart 'selector'
// grammar) — the engine/hook split: shared emit + per-language walk.
function emitDependsOnIfImportBound(
  name: string,
  ctx: ParseContext,
  sourceId: string,
  seen: Set<string>,
): void {
  engineEmitDependsOnIfImportBound(name, ctx.repoId, ctx.importSymbolMap, sourceId, seen, ctx.edges)
}

// ── 헬퍼: method_signature 정보 추출 ──

function extractMethodSigInfo(
  methSig: SNode,
  className: string,
): { name: string; exported: boolean; signature: string | null; lineStart: number; lineEnd: number; type: CodeNodeType } | null {
  const inner = methSig.children.find(c => c.isNamed)
  if (!inner) return null

  if (inner.type === 'getter_signature') {
    const name = findIdentifierText(inner)
    if (!name) return null
    return {
      name: `get:${name}`,
      exported: !name.startsWith('_'),
      signature: null,
      lineStart: methSig.startPosition.row + 1,
      lineEnd: methSig.endPosition.row + 1,
      type: 'method',
    }
  }

  if (inner.type === 'setter_signature') {
    const name = findIdentifierText(inner)
    if (!name) return null
    return {
      name: `set:${name}`,
      exported: !name.startsWith('_'),
      signature: null,
      lineStart: methSig.startPosition.row + 1,
      lineEnd: methSig.endPosition.row + 1,
      type: 'method',
    }
  }

  if (inner.type === 'function_signature') {
    const name = extractFnSigName(inner)
    if (!name) return null
    return {
      name,
      exported: !name.startsWith('_'),
      signature: extractFnSignature(inner),
      lineStart: methSig.startPosition.row + 1,
      lineEnd: methSig.endPosition.row + 1,
      type: 'method',
    }
  }

  if (inner.type === 'operator_signature') {
    return {
      name: 'operator',
      exported: true,
      signature: inner.text.length <= 200 ? inner.text.replace(/\s+/g, ' ').trim() : null,
      lineStart: methSig.startPosition.row + 1,
      lineEnd: methSig.endPosition.row + 1,
      type: 'method',
    }
  }

  // The Dart grammar reports methods with omitted return types as
  // constructor_signature. Treat them as methods unless the leading identifier
  // is the current class name.
  if (inner.type === 'constructor_signature' && !isDartConstructorSignature(inner, className)) {
    const ids = inner.children.filter((c) => c.isNamed && c.type === 'identifier')
    const name = ids[0]?.text
    if (!name) return null
    return {
      name,
      exported: !name.startsWith('_'),
      signature: extractCtorSignature(inner),
      lineStart: methSig.startPosition.row + 1,
      lineEnd: methSig.endPosition.row + 1,
      type: 'method',
    }
  }

  // D-5: factory constructor — `factory Foo.fromJson(...)` / `factory Foo.empty()`
  // structure: method_signature > factory_constructor_signature > [identifier(class), identifier(name)?, formal_parameter_list]
  if (inner.type === 'factory_constructor_signature') {
    const ids = inner.children.filter((c) => c.isNamed && c.type === 'identifier')
    if (ids.length === 0) return null
    // ids[0] = class name, ids[1] = factory method name (optional — 기본 factory도 있음)
    const factoryName = ids.length >= 2 ? ids[1].text : ids[0].text
    return {
      name: factoryName,
      exported: !factoryName.startsWith('_'),
      signature: inner.text.length <= 200 ? inner.text.replace(/\s+/g, ' ').trim() : null,
      lineStart: methSig.startPosition.row + 1,
      lineEnd: methSig.endPosition.row + 1,
      type: 'method',
    }
  }

  return null
}

// ── E7: class field 처리 ──

/**
 * Dart class field declaration → property 노드 + 위 annotation을 decorates edge로.
 * field 이름은 initialized_identifier_list/initialized_identifier/identifier에서 추출.
 */
function processClassField(
  declNode: SNode,
  ctx: ParseContext,
  className: string,
  pendingJsdoc: string | null,
  pendingAnnotations: AnnotationInfo[],
): void {
  const propNames: string[] = []
  const idList = findChild(declNode, 'initialized_identifier_list')
  if (idList) {
    for (const initId of idList.children) {
      if (!initId.isNamed || initId.type !== 'initialized_identifier') continue
      const ident = findChild(initId, 'identifier')
      if (ident) propNames.push(ident.text)
    }
  }
  const staticFinalList = findChild(declNode, 'static_final_declaration_list')
  if (staticFinalList) {
    for (const staticDecl of staticFinalList.children) {
      if (!staticDecl.isNamed || staticDecl.type !== 'static_final_declaration') continue
      const ident = findChild(staticDecl, 'identifier')
      if (ident) propNames.push(ident.text)
    }
  }
  // fallback: declaration 직접 자식에서 identifier (type_identifier 제외)
  if (propNames.length === 0) {
    for (const c of declNode.children) {
      if (c.type === 'identifier') { propNames.push(c.text); break }
    }
  }
  if (propNames.length === 0) return

  for (const propName of propNames) {
    emitClassFieldProperty(declNode, ctx, className, propName, pendingJsdoc, pendingAnnotations)
  }
}

function emitClassFieldProperty(
  declNode: SNode,
  ctx: ParseContext,
  className: string,
  propName: string,
  pendingJsdoc: string | null,
  pendingAnnotations: AnnotationInfo[],
): void {
  const fullName = `${className}.${propName}`
  const propNodeId = nodeId(ctx, fullName)

  // exported 추정: Dart는 _ prefix가 private
  const isExported = !propName.startsWith('_')

  const lineStart = lineStartWithAnnotations(declNode.startPosition.row + 1, pendingAnnotations)

  const propRaw: CodeNodeRaw = {
    id: propNodeId,
    repo_id: ctx.repoId,
    type: 'property',
    file_path: ctx.filePath,
    name: fullName,
    line_start: lineStart,
    line_end: declNode.endPosition.row + 1,
    signature: declNode.text.length <= 200 ? declNode.text.replace(/\s+/g, ' ').trim() : null,
    exported: isExported,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: false,
    jsdoc: pendingJsdoc,
  }
  addNode(ctx, propRaw)

  // contains edge: class → property — shared leaf (GAP-2)
  ctx.edges.push(engineBuildContainsEdge(ctx.repoId, ctx.filePath, nodeId(ctx, className), fullName, propName))

  // decorates edges: 각 annotation
  for (const ann of pendingAnnotations) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: propNodeId,
      target_id: null,
      relation: 'decorates',
      target_specifier: null,
      target_symbol: ann.name,
      resolve_status: 'pending',
      first_arg: ann.firstArg,
      literal_args: ann.literalArgs,
    }))
  }

  // D1: field type annotation → type_ref edge (generic 안 nested type까지 포함)
  emitTypeRefEdges(findFieldTypeNodes(declNode), ctx, propNodeId)

  // Field initializers can hold route graphs such as `final _router = GoRouter(...)`.
  scanCallsEdges(declNode, ctx, propNodeId, { ownerName: `${className}.${propName}` })

  // D3: field origin 기록 (annotation → RHS → unknown)
  const origin = inferDartFieldOrigin(declNode, ctx)
  recordFieldOrigin(ctx, className, propName, origin)
}

// ── 헬퍼: class field type 수집 (DI용) ──

function collectClassFieldTypes(body: SNode): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of body.children) {
    if (!node.isNamed || node.type !== 'declaration') continue
    // Skip constructor declarations
    if (findChild(node, 'constructor_signature')) continue

    // Look for: [final_builtin] type_identifier initialized_identifier_list
    const typeId = node.children.find(c => c.isNamed && c.type === 'type_identifier')
    const idList = node.children.find(c => c.isNamed && c.type === 'initialized_identifier_list')
    if (!typeId || !idList) continue

    for (const init of idList.children) {
      if (!init.isNamed || init.type !== 'initialized_identifier') continue
      const nameNode = findChild(init, 'identifier')
      if (nameNode) {
        map.set(nameNode.text, typeId.text)
      }
    }
  }
  return map
}

// ── 헬퍼: signature 추출 ──

function extractFnSigName(fnSig: SNode): string | null {
  const nameNode = fnSig.children.find(c => c.isNamed && c.type === 'identifier')
  return nameNode?.text ?? null
}

function extractFnSignature(fnSig: SNode): string | null {
  // '(params) → ReturnType' — null if return type is dynamic
  const paramList = findChild(fnSig, 'formal_parameter_list')
  const paramsText = paramList ? paramList.text : '()'

  // Find function name identifier index
  const nameIdx = fnSig.children.findIndex(c => c.isNamed && c.type === 'identifier')
  if (nameIdx === -1) return null

  // Collect all named children before the name identifier as return type parts
  // (e.g. type_identifier + type_arguments → 'Future' + '<Order>' = 'Future<Order>')
  const retTypeParts: string[] = []
  for (let i = 0; i < nameIdx; i++) {
    const c = fnSig.children[i]
    if (!c.isNamed) continue
    if (c.type === 'type_parameters' || c.type === 'async_marker') continue
    retTypeParts.push(c.text)
  }

  const retType = retTypeParts.join('')
  if (!retType || retType === 'dynamic') return null

  return `${paramsText} → ${retType}`
}

function extractCtorSignature(ctorSig: SNode): string | null {
  const paramList = findChild(ctorSig, 'formal_parameter_list')
  return paramList ? paramList.text : null
}

function findIdentifierText(node: SNode): string | null {
  const id = node.children.find(c => c.isNamed && c.type === 'identifier')
  return id?.text ?? null
}

// ── 헬퍼: URI 추출 ──

function extractUri(importSpec: SNode): string | null {
  const configUri = findChild(importSpec, 'configurable_uri')
  if (!configUri) return null

  const uri = findChild(configUri, 'uri')
  if (!uri) return null

  const strLit = findChild(uri, 'string_literal')
  if (!strLit) return null

  return stripQuotes(strLit.text)
}

// ── 헬퍼: jsdoc 추출 ──

// 단일 documentation_comment 노드에서 텍스트 추출.
// /// 형식: '/// Line' → 'Line'
// block 형식: 전체 블록 처리 → 한 문자열
function extractJsdocLine(node: SNode): string | null {
  const text = node.text
  if (!text) return null

  // /// 형식 단일 라인
  if (text.startsWith('///')) {
    // The node may contain a single '/// line' or multiple lines (grammar dependent)
    return text
      .split('\n')
      .map(line => line.replace(/^\/\/\/\s?/, '').trimEnd())
      .join('\n')
      .trim() || null
  }

  // /** ... */ 블록
  if (text.startsWith('/**') || text.startsWith('/*')) {
    return text
      .replace(/^\/\*+/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trimEnd())
      .join('\n')
      .trim() || null
  }

  return null
}

// ── 헬퍼: annotation 추출 ──

// extractAnnotationInfo → dart_hooks/annotation.ts

// ── 헬퍼: test 정보 ──

function getTestInfo(filePath: string): {
  isTest: boolean
  test_type: 'unit' | 'integration' | null
} {
  const isTest = /_test\.dart$/.test(filePath)
  if (!isTest) return { isTest: false, test_type: null }
  const test_type = filePath.includes('integration') ? 'integration' : 'unit'
  return { isTest, test_type }
}

// ── 헬퍼: file node 생성 ──
// ENGINE-TODO (KNOWN-DIVERGENCES §3): Dart 어댑터가 file 노드를 직접 emit하는 것은 spec 위반이다.
// file 노드는 F2 buildFileNode가 소유해야 한다(TS 어댑터는 emit 안 함). 이번 리팩토링에선 출력 byte 동일성
// 보존을 위해 고치지 않고 보류 — 후속에서 F2로 일원화.
function makeFileNode(
  filePath: string,
  repoId: string,
  isTest: boolean,
  test_type: 'unit' | 'integration' | 'e2e' | null,
  parse_status: 'ok' | 'failed',
): CodeNodeRaw {
  return {
    id: `${repoId}:${filePath}`,
    repo_id: repoId,
    type: 'file',
    file_path: filePath,
    name: path.basename(filePath),
    line_start: null,
    line_end: null,
    signature: null,
    exported: true,
    parse_status,
    is_test: isTest,
    test_type: test_type as any,
    is_async: false,
    jsdoc: null,
  }
}

// ── 헬퍼: 노드 / 엣지 ──

// Phase C: common_engine 의 nodeId/fileNodeId 소비 (thin wrapper, ctx 풀어 넘김).
function nodeId(ctx: ParseContext, name: string): string {
  return engineNodeId(ctx.repoId, ctx.filePath, name)
}

function fileId(ctx: ParseContext): string {
  return engineFileNodeId(ctx.repoId, ctx.filePath)
}

function firstAnnotationLine(annotations: readonly AnnotationInfo[]): number | null {
  if (annotations.length === 0) return null
  return Math.min(...annotations.map((ann) => ann.lineStart))
}

function lineStartWithAnnotations(defaultLineStart: number, annotations: readonly AnnotationInfo[]): number {
  return firstAnnotationLine(annotations) ?? defaultLineStart
}

function hashNodeSource(ctx: ParseContext, node: CodeNodeRaw): string | null {
  // A-8: delegate to the shared engine leaf (byte-identical; only ctx.sourceLines vs param differs).
  return engineHashNodeSource(ctx.sourceLines, node)
}

// ── routing constructor 탐지 ──

const ROUTING_CONSTRUCTORS = new Set(['GoRoute', 'ShellRoute', 'AutoRoute', 'GetPage'])
const ROUTING_PATH_ARG: Record<string, string> = {
  GoRoute: 'path',
  ShellRoute: 'path',
  AutoRoute: 'path',
  GetPage: 'name',
}

interface ScanCallsOptions {
  ownerName?: string
  skipFunctionExpression?: SNode | null
  createCallbackNodes?: boolean
  emitLocalVariableNodes?: boolean
  createCallEdges?: boolean
  callbackRoleOverride?: string
}

/**
 * 서브트리를 재귀 탐색하며 GoRoute/ShellRoute/AutoRoute/GetPage 생성자 호출을 찾아
 * `calls` 엣지를 생성한다.
 *
 * Dart tree-sitter 문법에서 `GoRoute(path: '/home')` 는:
 *   [identifier] "GoRoute"  + [selector] → [argument_part] → [arguments]
 * 형태로 파싱된다 (siblings).  selector.previousNamedSibling 으로 callee 를 찾는다.
 */
function scanCallsEdges(
  node: SNode,
  ctx: ParseContext,
  sourceId: string,
  options: ScanCallsOptions = {},
): void {
  const ownerName = options.ownerName ?? sourceNameFromId(sourceId)
  const createCallbackNodes = options.createCallbackNodes ?? true
  const createCallEdges = options.createCallEdges ?? true
  // E6/E8 — selector chain 처리: (identifier|this) (root) + selector들 (sibling)
  // children을 scan하면서 root로 시작하는 chain을 발견하면 emitDartChainCalls
  // 처리된 selector들은 skipSet에 추가 (재방문 방지)
  const skipSet = new WeakSet<SNode>()
  const callbackSet = new WeakSet<SNode>()
  const localVariableSet = new WeakSet<SNode>()
  const children = node.children
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    if (skipSet.has(c)) continue
    if (
      options.emitLocalVariableNodes !== false &&
      c.isNamed &&
      c.type === 'initialized_variable_definition' &&
      shouldPromoteLocalVariableDefinition(c)
    ) {
      processLocalVariableDefinition(c, ctx, sourceId)
      localVariableSet.add(c)
      skipSet.add(c)
      continue
    }
    if (
      createCallbackNodes &&
      c.isNamed &&
      c.type === 'function_expression' &&
      c !== options.skipFunctionExpression
    ) {
      const callbackRole = options.callbackRoleOverride ?? dartCallbackRole(c) ?? 'callback'
      skipSet.add(c)
      callbackSet.add(c)
      // C3: 콜백 노드 발화를 공유 엔진 collectNestedExecutableNode 로 통일 →
      // 일관 id({parent}:{role}:{row+1}:{col+1}) + inverse-of-contains calls edge(build_docs 도달성) 획득.
      // Dart 문법-특정 값은 hooks 로 주입; 재귀는 c 자체를 scan(원본 scanCallsEdges(c) 와 동일).
      const callbackId = engineCollectNestedExecutableNode(c, ctx, sourceId, sourceId, callbackRole, DART_LANGUAGE_SPEC, {
        recurseCalls: (_body, sid) => scanCallsEdges(c, ctx, sid, { ownerName }),
        leadingComment: () => null,
        isAsync: (n) => /\basync\b/.test(n.text),
        nodeMeta: () => ({ is_test: ctx.isTest, test_type: ctx.test_type }),
      })
      emitBodyIdentifierDependsOn(c, ctx, callbackId)
      continue
    }
    if (c.isNamed && c.type === 'const_object_expression') {
      if (createCallEdges) emitDartObjectConstructorCall(c, ctx, sourceId)
    }
    // D6: 'this'도 chain root로 인식 (this.X.Y.method 패턴)
    if (c.type === 'identifier' || c.type === 'this') {
      // 이어지는 selector chain 있는지 확인
      const next = children[i + 1]
      if (next && next.type === 'selector') {
        if (createCallEdges) {
          const consumed = emitDartChainCalls(c, children, i, ctx, sourceId)
          for (let j = i + 1; j <= i + consumed; j++) {
            if (children[j]) skipSet.add(children[j])
          }
        }
      }
    }
    // ROUTING_CONSTRUCTORS 처리 (V1 기존 동작 유지) — 단, 위에서 잡혔으면 skip
    if (c.type === 'selector' && !skipSet.has(c)) {
      const argPart = findChild(c, 'argument_part')
      if (argPart) {
        const args = findChild(argPart, 'arguments')
        if (args) {
          const callee = c.previousNamedSibling
          if (createCallEdges && callee && callee.type === 'identifier' && ROUTING_CONSTRUCTORS.has(callee.text)) {
            const constructorName = callee.text
            const argName = ROUTING_PATH_ARG[constructorName]
            const firstArg = extractNamedArg(args, argName)
            ctx.edges.push(makeEdge(ctx, {
              source_id: sourceId,
              target_id: null,
              relation: 'calls',
              target_specifier: null,
              target_symbol: constructorName,
              resolve_status: 'pending',
              first_arg: firstArg,
              literal_args: null,
            }))
          }
        }
      }
    }
  }
  for (const child of node.children) {
    if (callbackSet.has(child)) continue
    if (localVariableSet.has(child)) continue
    scanCallsEdges(child, ctx, sourceId, options)
  }
}

function shouldPromoteLocalVariableDefinition(definitionNode: SNode): boolean {
  return isDirectFunctionInitializer(definitionNode) || containsFunctionExpression(definitionNode)
}

function containsFunctionExpression(node: SNode): boolean {
  if (node.isNamed && node.type === 'function_expression') return true
  return node.children.some((child) => child.isNamed && containsFunctionExpression(child))
}

function hasAncestorOfType(node: SNode, type: string): boolean {
  let current = node.parent
  while (current) {
    if (current.type === type) return true
    current = current.parent
  }
  return false
}

// BG-4 (def-use): emit a `variable` node for a method-local Dart `final/var x = …` USED as a call receiver
// in the same body, so F5 Pass C resolves the bare receiver → its declaration. Node id `{methNodeId}.{name}`
// matches Pass C's `{source_id}.{name}` lookup (NOT the localNodeId scheme used for top-level locals).
// Receiver-used only; runs after scanCallsEdges so the receiver chain_path edges exist.
function emitDartLocalReceiverVars(body: SNode, ctx: ParseContext, methNodeId: string): void {
  const declared = new Map<string, SNode>()
  collectDartLocalDeclarators(body, declared)
  if (declared.size === 0) return
  const receivers = new Set<string>()
  for (const e of ctx.edges) {
    if (e.relation !== 'calls' || e.source_id !== methNodeId || !e.chain_path) continue
    const root = (e.chain_path.startsWith('this.') ? e.chain_path.slice('this.'.length) : e.chain_path).split('.')[0]
    if (root) receivers.add(root)
  }
  for (const [name, defNode] of declared) {
    if (!receivers.has(name)) continue
    addNode(ctx, {
      id: `${methNodeId}.${name}`,
      repo_id: ctx.repoId,
      type: 'variable',
      file_path: ctx.filePath,
      name,
      line_start: defNode.startPosition.row + 1,
      line_end: defNode.endPosition.row + 1,
      signature: null,
      exported: false,
      parse_status: 'ok',
      is_test: ctx.isTest,
      test_type: ctx.test_type,
      is_async: false,
      jsdoc: null,
    })
  }
}

function collectDartLocalDeclarators(node: SNode, out: Map<string, SNode>): void {
  for (const child of node.children) {
    if (!child.isNamed) continue
    if (child.type === 'function_expression' || child.type === 'function_body') continue // nested scope
    if (child.type === 'initialized_variable_definition') {
      const nm = child.children.find((c) => c.isNamed && c.type === 'identifier')?.text
      if (nm && !out.has(nm)) out.set(nm, child)
    }
    collectDartLocalDeclarators(child, out)
  }
}

function processLocalVariableDefinition(
  definitionNode: SNode,
  ctx: ParseContext,
  parentSourceId: string,
  jsdoc: string | null = null,
): void {
  const nameNode = definitionNode.children.find((child) => child.isNamed && child.type === 'identifier')
  if (!nameNode) return

  const varName = nameNode.text
  const isFn = isDirectFunctionInitializer(definitionNode)
  const varNodeId = localNodeId(ctx, varName, definitionNode)
  addNode(ctx, {
    id: varNodeId,
    repo_id: ctx.repoId,
    type: isFn ? 'function' : 'variable',
    file_path: ctx.filePath,
    name: varName,
    line_start: definitionNode.startPosition.row + 1,
    line_end: definitionNode.endPosition.row + 1,
    signature: definitionNode.text.length <= 200 ? definitionNode.text.replace(/\s+/g, ' ').trim() : null,
    parent_node_id: isFn ? parentSourceId : undefined,
    origin_kind: isFn ? 'local_function' : undefined,
    role: isFn ? varName : undefined,
    exported: false,
    parse_status: 'ok',
    is_test: ctx.isTest,
    test_type: ctx.test_type,
    is_async: /\basync\b/.test(definitionNode.text),
    jsdoc,
  })
  ctx.edges.push(makeEdge(ctx, {
    source_id: parentSourceId,
    target_id: varNodeId,
    relation: 'contains',
    target_specifier: null,
    target_symbol: null,
    resolve_status: 'resolved',
    first_arg: null,
    literal_args: null,
  }))
  scanCallsEdges(definitionNode, ctx, varNodeId, {
    ownerName: varName,
    skipFunctionExpression: directFunctionInitializer(definitionNode),
    emitLocalVariableNodes: false,
  })
  emitBodyIdentifierDependsOn(definitionNode, ctx, varNodeId)
}

function localNodeId(ctx: ParseContext, name: string, node: SNode): string {
  return `${nodeId(ctx, name)}:${node.startPosition.row + 1}`
}

function emitDartObjectConstructorCall(node: SNode, ctx: ParseContext, sourceId: string): void {
  const typeNode = findChild(node, 'type_identifier')
  if (!typeNode) return
  const constructorName = typeNode.text
  const argsNode = findDescendant(node, 'arguments')
  const firstArg = argsNode ? extractFirstStringArgGeneric(argsNode) : null
  const literalArgs = argsNode ? extractDartCallLiteralArgs(argsNode) : null
  const argExpressions = argsNode ? buildDartArgExpressions(argsNode) : null
  ctx.edges.push(makeEdge(ctx, {
    source_id: sourceId,
    target_id: null,
    relation: 'calls',
    target_specifier: ctx.importSymbolMap.get(constructorName) ?? null,
    target_symbol: constructorName,
    resolve_status: 'pending',
    first_arg: firstArg,
    literal_args: literalArgs,
    arg_expressions: argExpressions,
    chain_path: null,
  }))
}

function dartCallbackRole(node: SNode): string | null {
  const namedArg = engineFindAncestor(node, (candidate) =>
    candidate.type === 'named_argument'
  )
  if (namedArg && isDirectNamedArgumentCallbackValue(namedArg, node)) {
    const label = findChild(namedArg, 'label')
    const labelName = label?.text.match(/^([_$A-Za-z][_$A-Za-z0-9]*)\s*:/)?.[1] ?? null
    if (labelName) return labelName
  }

  const args = engineFindAncestor(node, (candidate) =>
    candidate.type === 'arguments'
  )
  if (!args) return null

  const argPart = args.parent
  const callSelector = argPart?.parent
  if (argPart?.type !== 'argument_part' || callSelector?.type !== 'selector') return null

  const callee = callSelector.previousNamedSibling
  const calleeName = callee ? dartCallableName(callee) : null
  if (calleeName === 'map') return 'mapCallback'
  if (calleeName === 'forEach') return 'forEachCallback'
  if (calleeName === 'where') return 'whereCallback'
  if (calleeName === '$transaction') return 'transactionCallback'
  return calleeName ? 'callback' : null
}

function isDirectNamedArgumentCallbackValue(namedArg: SNode, callback: SNode): boolean {
  const valueNode = namedArg.children.find((child) => child.isNamed && child.type !== 'label')
  if (!valueNode) return false
  return isDirectCallbackValue(valueNode, callback)
}

function isDirectCallbackValue(valueNode: SNode, callback: SNode): boolean {
  if (engineSameSpan(valueNode, callback)) return true
  if (valueNode.type !== 'parenthesized_expression') return false
  return valueNode.children.some((child) => child.isNamed && engineSameSpan(child, callback))
}

function dartCallableName(node: SNode): string | null {
  if (node.type === 'identifier') return node.text
  if (node.type !== 'selector') return null
  const innerMethod = node.children.find((child) =>
    child.type === 'unconditional_assignable_selector' ||
    child.type === 'conditional_assignable_selector' ||
    child.type === 'assignable_selector'
  )
  const ident = innerMethod ? findChild(innerMethod, 'identifier') : null
  return ident?.text ?? null
}

function containsNode(root: SNode, target: SNode): boolean {
  if (engineSameSpan(root, target)) return true
  return root.children.some((child) => containsNode(child, target))
}

function sourceNameFromId(sourceId: string): string {
  const idx = sourceId.lastIndexOf(':')
  return idx >= 0 ? sourceId.slice(idx + 1) : sourceId
}

/**
 * E6/E8 — Dart selector chain 처리.
 * 형태: rootIdent + selector(.method) + selector(args) + selector(.method) + ...
 *
 * 각 method 호출에 대해 calls edge 추가:
 *   - target_symbol = method 이름
 *   - chain_path = 호출 직전까지의 chain text (예: 'list', 'list.where()', ...)
 *   - first_arg = 인자 첫 string literal (있으면)
 *
 * 반환: consumed selector 개수 (skip 위해)
 */
function emitDartChainCalls(
  rootIdent: SNode,
  siblings: SNode[],
  rootIdx: number,
  ctx: ParseContext,
  sourceId: string,
): number {
  let chainText = rootIdent.text
  let i = rootIdx + 1
  let consumed = 0
  while (i < siblings.length) {
    const sel = siblings[i]
    if (sel.type !== 'selector') break
    consumed++
    // selector 안: unconditional_assignable_selector (.method) 또는 argument_part (())
    const innerMethod = sel.children.find(
      (c) => c.type === 'unconditional_assignable_selector' || c.type === 'conditional_assignable_selector',
    )
    const innerArg = sel.children.find((c) => c.type === 'argument_part')

    if (innerMethod) {
      const ident = findChild(innerMethod, 'identifier')
      if (!ident) {
        i++
        continue
      }
      const methodName = ident.text
      // 다음 selector가 argument_part면 method 호출
      const nextSel = siblings[i + 1]
      let firstArg: string | null = null
      let hasArgs = false
      if (nextSel && nextSel.type === 'selector') {
        const nextArgPart = nextSel.children.find((c) => c.type === 'argument_part')
        if (nextArgPart) {
          hasArgs = true
          const args = findChild(nextArgPart, 'arguments')
          if (args) firstArg = extractFirstStringArgGeneric(args)
        }
      }
      if (hasArgs) {
        // literal_args도 채움 (E4)
        const argPart = nextSel?.children.find((c) => c.type === 'argument_part')
        const argsNode = argPart ? findChild(argPart, 'arguments') : null
        const literalArgs = extractDartCallLiteralArgs(argsNode)
        const argExpressions = buildDartArgExpressions(argsNode)
        // D6: root='this'면 target_specifier에 full chain 발화 (F5 resolveDICall 호환)
        const targetSpec = rootIdent.type === 'this' ? `${chainText}.${methodName}` : null
        ctx.edges.push(makeEdge(ctx, {
          source_id: sourceId,
          target_id: null,
          relation: 'calls',
          target_specifier: targetSpec,
          target_symbol: methodName,
          resolve_status: 'pending',
          first_arg: firstArg,
          literal_args: literalArgs,
          arg_expressions: argExpressions,
          chain_path: chainText,
        }))
        emitRiverpodProviderArgEdge(argsNode, methodName, chainText, ctx, sourceId)
        chainText += `.${methodName}()`
        i += 2
        consumed++
      } else {
        chainText += `.${methodName}`
        i++
      }
    } else if (innerArg) {
      // root identifier에 직접 호출 (예: foo() — root는 identifier 'foo', selector는 argument_part)
      const args = findChild(innerArg, 'arguments')
      let firstArg: string | null = null
      let literalArgs: string | null = null
      if (args) {
        // V1 ROUTING_CONSTRUCTORS 호환 — named arg 'path' 우선 (GoRoute, GetPage 등)
        if (ROUTING_CONSTRUCTORS.has(rootIdent.text)) {
          const argName = ROUTING_PATH_ARG[rootIdent.text]
          firstArg = extractNamedArg(args, argName)
        } else {
          firstArg = extractFirstStringArgGeneric(args)
        }
        literalArgs = extractDartCallLiteralArgs(args)
      }
      const argExpressions = args ? buildDartArgExpressions(args) : null
      // ROUTING_CONSTRUCTORS는 일반 함수 호출을 V1에서 제외했음 — 그러나 이 분기는
      // root가 import-bound 또는 routing이라 가정. 일반 함수 호출 (MyWidget()) 보호:
      // V1 의도 = 라우터 외 일반 호출은 calls X. 그러나 새 Widget tree(E5b)는 잡고 싶음.
      // 절충: identifier가 대문자로 시작하면서 ROUTING_CONSTRUCTORS 아니면 → constructor (Widget) → calls 잡음
      // 소문자 시작 (일반 함수) + ROUTING_CONSTRUCTORS 아님 → V1 호환 안 잡음
      const firstChar = rootIdent.text[0]
      const isCapital = firstChar && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
      const isRouting = ROUTING_CONSTRUCTORS.has(rootIdent.text)
      const isImportBound = ctx.importSymbolMap.has(rootIdent.text)
      // D9: file-level import (show 없음) 가능성 — importUris 있으면 cross-file 후보로 발화
      const hasFileLevelImports = ctx.importUris.length > 0
      if (!isCapital && !isRouting && !isImportBound && !hasFileLevelImports) {
        // 일반 소문자 함수 호출 (V1 호환) — calls X
        i++
        chainText += '()'
        continue
      }
      ctx.edges.push(makeEdge(ctx, {
        source_id: sourceId,
        target_id: null,
        relation: 'calls',
        target_specifier: ctx.importSymbolMap.get(rootIdent.text) ?? null,
        target_symbol: rootIdent.text,
        resolve_status: 'pending',
        first_arg: firstArg,
        literal_args: literalArgs,
        arg_expressions: argExpressions,
        chain_path: null,
      }))
      chainText += '()'
      i++
    } else {
      break
    }
  }
  return consumed
}

function emitRiverpodProviderArgEdge(
  argsNode: SNode | null,
  methodName: string,
  chainText: string,
  ctx: ParseContext,
  sourceId: string,
): void {
  if (!argsNode || !RIVERPOD_REF_METHODS.has(methodName)) return
  if (!/(^|\.|\b)ref$|Ref$|WidgetRef$/.test(chainText)) return

  const providerSymbol = extractFirstDartIdentifierArg(argsNode)
  if (!providerSymbol || providerSymbol === 'null') return

  ctx.edges.push(makeEdge(ctx, {
    source_id: sourceId,
    target_id: null,
    relation: 'calls',
    target_specifier: ctx.importSymbolMap.get(providerSymbol) ?? null,
    target_symbol: providerSymbol,
    resolve_status: 'pending',
    first_arg: null,
    literal_args: null,
    chain_path: `${chainText}.${methodName}()`,
  }))
}

function extractFirstDartIdentifierArg(argsNode: SNode): string | null {
  const text = stripOuterParens(argsNode.text).trim()
  if (!text) return null
  const first = takeTopLevelFirstArg(text).trim()
  const normalized = first.replace(/^(?:[A-Za-z_]\w*)\s*:\s*/, '').trim()
  const m = normalized.match(/^([A-Za-z_]\w*)/)
  return m?.[1] ?? null
}

function stripOuterParens(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed.slice(1, -1)
  return trimmed
}

function takeTopLevelFirstArg(text: string): string {
  let paren = 0
  let bracket = 0
  let brace = 0
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const prev = i > 0 ? text[i - 1] : ''
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') paren++
    else if (ch === ')') paren = Math.max(0, paren - 1)
    else if (ch === '[') bracket++
    else if (ch === ']') bracket = Math.max(0, bracket - 1)
    else if (ch === '{') brace++
    else if (ch === '}') brace = Math.max(0, brace - 1)
    else if (ch === ',' && paren === 0 && bracket === 0 && brace === 0) {
      return text.slice(0, i)
    }
  }
  return text
}

/** arguments 노드의 첫 인자가 string literal이면 그 값 반환 */
function extractFirstStringArgGeneric(args: SNode): string | null {
  for (const c of args.children) {
    if (!c.isNamed) continue
    if (c.type === 'argument') {
      const inner = c.children.find((x) => x.isNamed)
      if (inner?.type === 'string_literal') {
        return stripQuotes(inner.text)
      }
      return null
    }
    if (c.type === 'string_literal') {
      return stripQuotes(c.text)
    }
    if (c.type === 'named_argument') {
      return null
    }
  }
  return null
}


// Phase C: 공유 node factory(common_engine/node_factory_ops) 소비 — TS·Dart 가 같은
// dedup/id-collision/normalized_code_hash 규칙을 공유. (Dart 의 file-level export 모델상
// engine 의 export-promotion 분기는 실질적으로 발화되지 않아 byte-identical — golden/conformance/scenario 검증.)
function addNode(ctx: ParseContext, node: CodeNodeRaw): void {
  engineAddNode(ctx.nodes, node, ctx.sourceLines)
}

function hasEquivalentNode(
  ctx: ParseContext,
  node: {
    name: string
    type: CodeNodeType
    lineStart: number | null
    lineEnd: number | null
  },
): boolean {
  if (node.lineStart === null || node.lineEnd === null) return false
  return ctx.nodes.some((existing) =>
    existing.file_path === ctx.filePath &&
    existing.name === node.name &&
    existing.type === node.type &&
    existing.line_start === node.lineStart &&
    existing.line_end === node.lineEnd
  )
}

// Phase C: common_engine 의 makeEdge 소비 (ctx.repoId 풀어 넘김). engine 은 동일 18필드
// CodeEdgeRaw 를 만들되 dart 가 안 넘기는 필드(target_imported/local_symbol, type_ref_subtype,
// destructured_alias_*)는 null/undefined → DB NULL 로 들어가므로 dart 기존 출력과 canonical-동일.
function makeEdge(
  ctx: ParseContext,
  opts: {
    source_id: string
    target_id: string | null
    relation: EdgeRelation
    target_specifier: string | null
    target_symbol: string | null
    resolve_status: CodeEdgeRaw['resolve_status']
    first_arg: string | null
    literal_args: string | null
    arg_expressions?: CodeEdgeRaw['arg_expressions']
    chain_path?: string | null
  },
): CodeEdgeRaw {
  return engineMakeEdge(ctx.repoId, opts)
}

// ── 트리 탐색 유틸 ──

// findChild → dart_hooks/dart_node_utils.ts

function nextNamedSibling(children: readonly SNode[], index: number, type: string): SNode | null {
  for (let i = index + 1; i < children.length; i += 1) {
    const child = children[i]
    if (!child.isNamed) continue
    return child.type === type ? child : null
  }
  /* c8 ignore next -- constructor signatures in valid Dart class bodies are followed by a body when this helper is used */
  return null
}

// findDescendant, stripQuotes → dart_hooks/dart_node_utils.ts

const MAX_DART_ARG_RAW = 500

/**
 * Dart string literal 텍스트에서 보간 패턴 정규화.
 * '$var' → ':var', '${expr.prop}' → ':prop' (마지막 prop, 전체 identifiers 수집)
 * 보간 없으면 null 반환 (plain string임).
 */
function normalizeDartStringPattern(raw: string): {
  staticPattern: string
  identifiers: string[]
} | null {
  const stripped = stripQuotes(raw)
  if (!stripped.includes('$')) return null

  const identifiers: string[] = []
  const pattern = stripped
    .replace(/\$\{([^}]+)\}/g, (_, expr) => {
      const parts = expr.trim().split('.').map((p: string) => p.trim()).filter(Boolean)
      identifiers.push(...parts)
      return `:${parts[parts.length - 1] ?? 'val'}`
    })
    .replace(/\$([a-zA-Z_]\w*)/g, (_, name: string) => {
      identifiers.push(name)
      return `:${name}`
    })

  return { staticPattern: pattern, identifiers }
}

/** Dart call arguments 노드에서 CallArgExpression[] 생성 */
function buildDartArgExpressions(args: SNode | null): CallArgExpression[] | null {
  if (!args) return null
  const result: CallArgExpression[] = []
  let index = 0

  for (const c of args.children) {
    if (!c.isNamed) continue
    let valueNode: SNode | null = null
    if (c.type === 'argument') {
      valueNode = findDescendant(c, 'argument_part') ? c : c.children.find((x) => x.isNamed) ?? null
    } else if (c.type === 'named_argument') {
      valueNode = c.children.find((x) => x.isNamed && x.type !== 'label') ?? null
    /* v8 ignore next 4 -- arguments children are wrapped as argument/named_argument by tree-sitter-dart */
    } else if (c.type === 'string_literal') {
      valueNode = c
    } else if (c.isNamed) {
      valueNode = c
    }

    if (!valueNode) { index++; continue }
    const raw = valueNode.text
    if (raw.length > MAX_DART_ARG_RAW) return null

    if (isDartMemberAccessRaw(raw)) {
      result.push({ index, kind: 'member', raw, resolution: 'dynamic' })
    } else if (valueNode.type === 'string_literal') {
      const interpolated = normalizeDartStringPattern(raw)
      if (interpolated) {
        result.push({
          index,
          kind: 'template',
          raw,
          ...interpolated,
          resolution: interpolated.identifiers.length > 0 ? 'partial' : 'static',
        })
      } else {
        result.push({ index, kind: 'string', raw, value: stripQuotes(raw), resolution: 'static' })
      }
    } else if (valueNode.type === 'identifier') {
      result.push({ index, kind: 'identifier', raw, resolution: 'dynamic' })
    } else if (
      valueNode.type === 'method_invocation' ||
      valueNode.type === 'function_expression_invocation' ||
      (valueNode.type === 'argument' && findDescendant(valueNode, 'argument_part'))
    ) {
      result.push({ index, kind: 'call', raw, resolution: 'dynamic' })
    } else if (valueNode.type === 'set_or_map_literal' || valueNode.type === 'map_literal') {
      result.push({ index, kind: 'object', raw, resolution: 'dynamic' })
    } else if (valueNode.type === 'list_literal') {
      result.push({ index, kind: 'array', raw, resolution: 'dynamic' })
    } else {
      result.push({ index, kind: 'unknown', raw, resolution: 'dynamic' })
    }
    index++
  }

  return result.length > 0 ? result : null
}

function isDartMemberAccessRaw(raw: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(raw.trim())
}
