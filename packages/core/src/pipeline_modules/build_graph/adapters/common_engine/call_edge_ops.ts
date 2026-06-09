// common_engine/call_edge_ops — 파서-무관 "calls/imports edge shape" 결정 엔진 (Cluster B 추출).
// typescript.ts 의 extractCallEdge 클러스터를 EngineNode + LanguageSpec + CallExtractor 로 일반화.
// 동작 byte-identical (golden ①): 분기 순서·각 branch의 target_specifier/target_symbol/chain_path/
// arg_expressions 유무·early-return·emit 순서 모두 원본 보존.
//
// CallEdgeCtx 는 어댑터 내부 struct(ParseContext 에서 푼 필드 묶음)이지 출력 계약이 아니다 —
// FieldOriginCtx / 와 동일한 precedent.
//
// children/namedChildren null guard: native(Phase A)는 null 없음 → no-op. WASM(Phase B)은 null 가능 → 안전.

import type { CodeNodeRaw, CodeEdgeRaw, CallArgExpression } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import type { CallExtractor } from './call_extractor.js'
import type { NormalizedCallee } from './normalized.js'
import { makeEdge } from './edge_ops.js'
import { emitDataCallbackReferenceCalls } from './edge_ops.js'
import { callTargetName } from './node_ops.js'
import {
  extractChainPath,
  getRootObject,
  findChainRootIdentifier,
  isChainRootedAtThis,
  unwrapTransparent,
} from './chain_extractor.js'
import { sameNode } from './shared_utils.js'

// 함수 본문 const alias 추적 결과 (A3). typescript.ts 에서 이동.
export interface FunctionScopeAliasResolution {
  targetSpecifier: string
  destructuredAliasRoot?: string | null
  destructuredAliasProperty?: string | null
}

export interface DestructuredConstAlias {
  root: string
  property: string
}

// 어댑터 ctx 에서 푼 calls-edge 발화 입력 묶음 (출력 계약 아님 — FieldOriginCtx precedent).
export interface CallEdgeCtx {
  repoId: string
  filePath: string
  importSymbolMap: Map<string, string>
  nodes: readonly CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  currentClassKey: string | null
}

const DESTRUCTURED_KEY_QUOTE_RE = /^['"`]|['"`]$/g

// ── B2 seam: 정규화 callee → calls edge (grammar-divergent 언어용; extractCallEdge 와 동일 출력 규약) ──
// Dart selector 체인 등이 NormalizedCallee 로 정규화돼 들어오면 동일한 target_specifier/symbol/chain_path
// 규칙으로 calls edge 발화. (TS 는 normalizeCallee 미구현 → 이 경로 미사용.)
function normalizedChainPath(callee: NormalizedCallee): string | null {
  if (callee.memberChain.length > 1) return callee.memberChain.slice(0, -1).join('.')
  return callee.rootIdentifier
}

export function emitNormalizedCallEdge(
  callee: NormalizedCallee,
  argsNode: EngineNode | null,
  ctx: CallEdgeCtx,
  sourceId: string,
  spec: LanguageSpec,
  callExtractor: CallExtractor,
): void {
  const { firstArg, literalArgs, argExpressions } = callExtractor.extractCallArgs(argsNode)
  let targetSpecifier: string | null = null
  let chainPath: string | null = null
  switch (callee.shape) {
    case 'identifier':
    case 'new':
      targetSpecifier = ctx.importSymbolMap.get(callee.symbol) ?? null
      break
    case 'member':
      targetSpecifier = callee.rootIdentifier ? (ctx.importSymbolMap.get(callee.rootIdentifier) ?? null) : null
      chainPath = normalizedChainPath(callee)
      break
    case 'this_member':
      targetSpecifier = callee.calleeText
      chainPath = normalizedChainPath(callee) ?? 'this'
      break
    case 'super_member':
      targetSpecifier = `super.${callee.symbol}`
      chainPath = 'super'
      break
    case 'subscript':
      // 컴퓨티드/this-rooted 호출은 enclosing-class 경로(언어 hook 책임) — 여기선 기본 발화만.
      chainPath = normalizedChainPath(callee)
      break
  }
  ctx.edges.push(makeEdge(ctx.repoId, {
    source_id: sourceId,
    target_id: null,
    relation: 'calls',
    target_specifier: targetSpecifier,
    target_symbol: callee.symbol,
    resolve_status: 'pending',
    first_arg: firstArg,
    literal_args: literalArgs,
    arg_expressions: argExpressions,
    chain_path: chainPath,
  }))
  emitDataCallbackReferenceCalls(callee.symbol, argExpressions, ctx.repoId, ctx.importSymbolMap, sourceId, ctx.edges)
}

// 'class' 는 grammar 노드타입이 아니라 Platty CodeNodeRaw 의 graph node-type (전 언어 공통).
// 따라서 언어별 LanguageSpec 이 아니라 엔진 상수로 둔다 (enclosing-class call edge 판정).
const CLASS_GRAPH_NODE_TYPE: CodeNodeRaw['type'] = 'class'

/**
 * extractCallEdge — call/new 의 callee(fn) 모양에 따라 calls edge 발화.
 * 분기 순서: identifier → member_expression(this / member-of-this / identifier-rooted /
 *   super / call|new chain-root / fallback-identifier) → subscript|call(enclosing-class this).
 * 마지막에 emitDataCallbackReferenceCalls 1회.
 */
export function extractCallEdge(
  fnRaw: EngineNode,
  argsNode: EngineNode | null,
  ctx: CallEdgeCtx,
  sourceId: string,
  spec: LanguageSpec,
  callExtractor: CallExtractor,
): void {
  // callee value-identity 래퍼 strip: `getDb(tx).user.update!()`, `(foo)()` 등.
  // await 은 보존(includeAwait=false) — `(await x)()` 는 awaited value 호출이라 의미가 다름.
  const fn = unwrapTransparent(fnRaw, spec, false)
  const { firstArg, literalArgs, argExpressions } = callExtractor.extractCallArgs(argsNode)
  const calleeName = callTargetName(fn, spec)

  if (fn.type === spec.identifierType) {
    // A3 — top-level importSymbolMap 미적중 시 함수 본문 alias로 fallback
    const aliasResolution = resolveFunctionScopeAlias(fn.text, fn, ctx, spec)
    const specifier = ctx.importSymbolMap.get(fn.text)
      ?? aliasResolution?.targetSpecifier
      ?? null
    const registryKey = findObjectPropertyKeyForExpression(fn, ctx, spec, callExtractor)
    ctx.edges.push(makeEdge(ctx.repoId, {
      source_id: sourceId, target_id: null, relation: 'calls',
      target_specifier: specifier, target_symbol: fn.text,
      resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
      arg_expressions: argExpressions,
      chain_path: registryKey,  // E6 — root call (chain 없음) or object registry property key
      destructured_alias_root: aliasResolution?.destructuredAliasRoot ?? null,
      destructured_alias_property: aliasResolution?.destructuredAliasProperty ?? null,
    }))
  } else if (fn.type === spec.memberType) {
    const rawObj = fn.childForFieldName(spec.objectField)
    // receiver chain root의 value-identity 래퍼 strip: `(getClient()).user`, `client!.user`,
    // `(await getClient()).user` → 분기 dispatch가 inner(call/new/identifier)를 보게 한다.
    const obj = rawObj ? unwrapTransparent(rawObj, spec) : null
    const prop = fn.childForFieldName(spec.propertyField)
    if (!prop) return
    const propName = prop.text
    const chainPath = extractChainPath(rawObj)  // chain_path는 원본 소스 텍스트 보존(래퍼 포함)

    if (obj?.type === spec.thisType) {
      ctx.edges.push(makeEdge(ctx.repoId, {
        source_id: sourceId, target_id: null, relation: 'calls',
        target_specifier: fn.text, target_symbol: propName,
        resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
        arg_expressions: argExpressions,
        chain_path: chainPath,  // 'this'
      }))
    } else if (obj?.type === spec.memberType) {
      const rootObj = getRootObject(obj, spec)
      if (rootObj?.type === spec.thisType) {
        ctx.edges.push(makeEdge(ctx.repoId, {
          source_id: sourceId, target_id: null, relation: 'calls',
          target_specifier: fn.text, target_symbol: propName,
          resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
          arg_expressions: argExpressions,
          chain_path: chainPath,  // 'this.svc'
        }))
      } else if (rootObj?.type === spec.identifierType) {
        // E6 — multi-level chain (예: prisma.order.findMany)
        // A2-3 — chain root unknown이어도 edge 발화
        // A3 — importSymbolMap 미적중 시 함수 본문 alias로 fallback
        const aliasResolution = resolveFunctionScopeAlias(rootObj.text, fn, ctx, spec)
        const rootSpecifier = ctx.importSymbolMap.get(rootObj.text)
          ?? aliasResolution?.targetSpecifier
          ?? null
        ctx.edges.push(makeEdge(ctx.repoId, {
          source_id: sourceId, target_id: null, relation: 'calls',
          target_specifier: rootSpecifier, target_symbol: propName,
          resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
          arg_expressions: argExpressions,
          chain_path: chainPath,  // 'prisma.order'
          destructured_alias_root: aliasResolution?.destructuredAliasRoot ?? null,
          destructured_alias_property: aliasResolution?.destructuredAliasProperty ?? null,
        }))
      } else if (rootObj?.type === spec.callType || rootObj?.type === spec.newType) {
        // BS-10 variant — member chain whose deepest receiver is a call/new expression
        // (getPrismaDB(tx).user.update(), buildClient().svc.get()). The identifier branch
        // above only fires when the chain bottoms out at a bare identifier; a wrapper/factory
        // call at the root falls here. Walk to the chain-root identifier and emit with its
        // import-bound specifier (or null → P13 whitelist). this/super-rooted chains return
        // null from findChainRootIdentifier → no emit (preserves prior behavior).
        const rootIdent = findChainRootIdentifier(obj, spec)
        if (rootIdent) {
          const rootSpecifier = ctx.importSymbolMap.get(rootIdent.text) ?? null
          ctx.edges.push(makeEdge(ctx.repoId, {
            source_id: sourceId, target_id: null, relation: 'calls',
            target_specifier: rootSpecifier, target_symbol: propName,
            resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
            arg_expressions: argExpressions,
            chain_path: chainPath,  // 'getPrismaDB(tx).user'
          }))
        }
      }
    } else if (obj?.type === spec.superType) {
      ctx.edges.push(makeEdge(ctx.repoId, {
        source_id: sourceId, target_id: null, relation: 'calls',
        target_specifier: `${spec.superType}.${propName}`, target_symbol: propName,
        resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
        arg_expressions: argExpressions,
        chain_path: chainPath,  // 'super'
      }))
    } else if (obj?.type === spec.callType || obj?.type === spec.newType) {
      // BS-10 — chain method 호출 (db.select().from(...), new Hono().get(...) 등)
      // chain root까지 탐색해 import-bound이면 specifier 채워서, 아니면 specifier=null로 edge 발화 (P13 화이트리스트가 받음).
      const rootIdent = findChainRootIdentifier(obj, spec)
      if (rootIdent) {
        const rootSpecifier = ctx.importSymbolMap.get(rootIdent.text) ?? null
        ctx.edges.push(makeEdge(ctx.repoId, {
          source_id: sourceId, target_id: null, relation: 'calls',
          target_specifier: rootSpecifier, target_symbol: propName,
          resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
          arg_expressions: argExpressions,
          chain_path: chainPath,  // 'db.select()' 같은 형태 그대로 (call_expression 텍스트)
        }))
      } else {
        // root가 this인 chain (this.qb.where().andWhere() 같은 경우)
        const isThisRooted = isChainRootedAtThis(obj, spec)
        if (isThisRooted) {
          ctx.edges.push(makeEdge(ctx.repoId, {
            source_id: sourceId, target_id: null, relation: 'calls',
            target_specifier: fn.text, target_symbol: propName,
            resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
            arg_expressions: argExpressions,
            chain_path: chainPath,
          }))
        } else if (obj.type === spec.callType && obj.childForFieldName(spec.functionField)?.type === spec.importExpressionType) {
          // TS-2: dynamic import chain — `import('./x').then(...)` — chain method 발화 (specifier=null, P13 화이트리스트가 받음)
          ctx.edges.push(makeEdge(ctx.repoId, {
            source_id: sourceId, target_id: null, relation: 'calls',
            target_specifier: null, target_symbol: propName,
            resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
            chain_path: chainPath,
          }))
        }
      }
    } else if (obj) {
      const rootObj = getRootObject(obj, spec)
      if (rootObj?.type === spec.identifierType) {
        // A2-3 — chain root가 import-bound 아니어도 calls edge 발화 (callback param, 함수 본문 변수 등)
        // A3 — importSymbolMap 미적중 시 함수 본문 alias로 fallback
        const aliasResolution = resolveFunctionScopeAlias(rootObj.text, fn, ctx, spec)
        const rootSpecifier = ctx.importSymbolMap.get(rootObj.text)
          ?? aliasResolution?.targetSpecifier
          ?? null
        ctx.edges.push(makeEdge(ctx.repoId, {
          source_id: sourceId, target_id: null, relation: 'calls',
          // E6: target_symbol을 마지막 property만 (chain_path가 prefix 보존)
          target_specifier: rootSpecifier, target_symbol: propName,
          resolve_status: 'pending', first_arg: firstArg, literal_args: literalArgs,
          arg_expressions: argExpressions,
          chain_path: chainPath,  // 'axios', 'prisma.order', 't', ...
          destructured_alias_root: aliasResolution?.destructuredAliasRoot ?? null,
          destructured_alias_property: aliasResolution?.destructuredAliasProperty ?? null,
        }))
      }
    }
  } else if (fn.type === spec.subscriptType || fn.type === spec.callType) {
    // Callee whose receiver chain roots at `this` but the member/identifier branches
    // don't cover — a computed member call (`this.logger[level](msg)`) or invoking a
    // function returned by a this-method (`this.href(req)()`). A language service
    // resolves the `this` receiver to the enclosing class; build_graph mirrors that.
    emitEnclosingClassCallEdge(fn, ctx, sourceId, firstArg, literalArgs, argExpressions, spec)
  }

  emitDataCallbackReferenceCalls(calleeName, argExpressions, ctx.repoId, ctx.importSymbolMap, sourceId, ctx.edges)
}

/** 표현식 노드가 객체 리터럴의 value면 그 pair key 를 정규화해 반환 (registry-style key, E6). */
export function findObjectPropertyKeyForExpression(
  node: EngineNode,
  ctx: CallEdgeCtx,
  spec: LanguageSpec,
  callExtractor: CallExtractor,
): string | null {
  let cur: EngineNode | null = node
  let depth = 0
  while (cur && depth < 4) {
    const parent: EngineNode | null = cur.parent
    if (!parent) return null
    // WASM-safe 노드 동일성 (web-tree-sitter는 accessor마다 새 wrapper → === 깨짐). span+type 비교.
    if (parent.type === spec.pairType && sameNode(parent.childForFieldName(spec.valueField), cur)) {
      const key = parent.childForFieldName(spec.keyField)
      if (!key) return null
      return callExtractor.normalizeObjectPropertyKey(key.text)
    }
    cur = parent
    depth++
  }
  return null
}

/**
 * Phase A3 — 함수 본문 const alias 추적.
 * callNode 에서 ascend 하며 statement_block scope 마다 `const ${ident} = X` (또는
 * `const { ...ident... } = root`) 를 찾고, specifier 를 해석한다. 가장 안쪽 우선(shadowing).
 */
export function resolveFunctionScopeAlias(
  ident: string,
  callNode: EngineNode,
  ctx: CallEdgeCtx,
  spec: LanguageSpec,
): FunctionScopeAliasResolution | null {
  let cur: EngineNode | null = callNode.parent
  while (cur) {
    if (cur.type === spec.statementBlockType) {
      const initializer = findConstInitializer(cur, ident, spec)
      if (initializer) {
        const targetSpecifier = resolveInitializerSpecifier(initializer, ctx, spec)
        return targetSpecifier ? { targetSpecifier } : null
      }
      const destructuredAlias = findDestructuredConstAlias(cur, ident, spec)
      if (destructuredAlias) {
        const targetSpecifier = ctx.importSymbolMap.get(destructuredAlias.root)
        return targetSpecifier
          ? {
              targetSpecifier,
              destructuredAliasRoot: destructuredAlias.root,
              destructuredAliasProperty: destructuredAlias.property,
            }
          : null
      }
    }
    cur = cur.parent
  }
  return null
}

/** statement_block 안에서 `const ${ident} = value` 의 value 노드 반환 (destructure skip). */
export function findConstInitializer(
  block: EngineNode,
  ident: string,
  spec: LanguageSpec,
): EngineNode | null {
  for (const child of block.children) {
    if (!child) continue
    if (!spec.constDeclTypes.includes(child.type)) continue
    for (const decl of child.children) {
      if (!decl) continue
      if (decl.type !== spec.declaratorType) continue
      const name = decl.childForFieldName(spec.nameField)
      if (!name || name.type !== spec.identifierType) continue  // destructure(object/array pattern) skip
      if (name.text !== ident) continue
      return decl.childForFieldName(spec.valueField) ?? null
    }
  }
  return null
}

/** statement_block 안에서 `const { ...ident... } = root` (object_pattern destructure of identifier) 탐색. */
export function findDestructuredConstAlias(
  block: EngineNode,
  ident: string,
  spec: LanguageSpec,
): DestructuredConstAlias | null {
  for (const child of block.children) {
    if (!child) continue
    if (!spec.constDeclTypes.includes(child.type)) continue
    if (child.text.startsWith('let ') || child.text.startsWith('var ')) continue
    for (const decl of child.children) {
      if (!decl) continue
      if (decl.type !== spec.declaratorType) continue
      const name = decl.childForFieldName(spec.nameField)
      const value = decl.childForFieldName(spec.valueField)
      if (!name || name.type !== spec.objectPatternType || value?.type !== spec.identifierType) continue
      const property = findDestructuredPropertyForBinding(name, ident, spec)
      if (property) return { root: value.text, property }
    }
  }
  return null
}

/** object_pattern 안에서 binding ident 의 source property key 반환. */
export function findDestructuredPropertyForBinding(
  pattern: EngineNode,
  ident: string,
  spec: LanguageSpec,
): string | null {
  for (const child of pattern.children) {
    if (!child) continue
    if (child.type === spec.identifierType || child.type === spec.shorthandPropertyPatternType) {
      if (child.text === ident) return child.text
    } else if (child.type === spec.pairPatternType) {
      const key = child.childForFieldName(spec.keyField)
      const value = child.childForFieldName(spec.valueField)
      if (value?.type === spec.identifierType && value.text === ident) return normalizeDestructuredKey(key)
    }
  }
  return null
}

/** pair_pattern key 텍스트에서 앞/뒤 따옴표 1개씩 제거. */
export function normalizeDestructuredKey(key: EngineNode | null): string | null {
  return key?.text.replace(DESTRUCTURED_KEY_QUOTE_RE, '') ?? null
}

/** const initializer(identifier / call / new / member)에서 import-bound specifier 해석. */
export function resolveInitializerSpecifier(
  initializer: EngineNode,
  ctx: CallEdgeCtx,
  spec: LanguageSpec,
): string | null {
  if (initializer.type === spec.identifierType) {
    return ctx.importSymbolMap.get(initializer.text) ?? null
  }
  if (initializer.type === spec.callType) {
    const fn = initializer.childForFieldName(spec.functionField)
    if (!fn) return null
    if (fn.type === spec.identifierType) return ctx.importSymbolMap.get(fn.text) ?? null
    if (fn.type === spec.memberType) {
      const root = findChainRootIdentifier(fn, spec)
      if (root?.type === spec.identifierType) return ctx.importSymbolMap.get(root.text) ?? null
    }
    return null
  }
  if (initializer.type === spec.newType) {
    const ctor = initializer.childForFieldName(spec.constructorField)
    if (ctor?.type === spec.identifierType) return ctx.importSymbolMap.get(ctor.text) ?? null
    return null
  }
  if (initializer.type === spec.memberType) {
    const root = findChainRootIdentifier(initializer, spec)
    if (root?.type === spec.identifierType) return ctx.importSymbolMap.get(root.text) ?? null
    return null
  }
  return null
}

/**
 * A callee whose receiver chain bottoms out at `this`, walking through
 * call/member/subscript links (`this.href(req)()`, `this.logger[level]()`).
 * Returns false for identifier/super roots (handled by other branches).
 */
export function isCalleeRootedAtThis(node: EngineNode | null, spec: LanguageSpec): boolean {
  let cur: EngineNode | null = node
  let depth = 0
  while (cur && depth < 20) {
    if (cur.type === spec.thisType) return true
    if (cur.type === spec.identifierType || cur.type === spec.superType) return false
    if (cur.type === spec.callType) {
      cur = cur.childForFieldName(spec.functionField)
    } else if (cur.type === spec.newType) {
      cur = cur.childForFieldName(spec.constructorField)
    } else if (cur.type === spec.memberType || cur.type === spec.subscriptType) {
      cur = cur.childForFieldName(spec.objectField)
    } else if (cur.type === spec.parenthesizedExpressionType) {
      cur = cur.namedChildren[0] ?? null
    } else {
      return false
    }
    depth++
  }
  return false
}

// Emit a `calls` edge from the current call site to the enclosing class node, for a
// `this`-rooted callee the identifier/member branches leave unhandled. Resolved at
// parse time because the owning class is lexically known. No-op outside a class body.
export function emitEnclosingClassCallEdge(
  fn: EngineNode,
  ctx: CallEdgeCtx,
  sourceId: string,
  firstArg: string | null,
  literalArgs: string | null,
  argExpressions: CallArgExpression[] | null,
  spec: LanguageSpec,
): void {
  if (!isCalleeRootedAtThis(fn, spec)) return
  const classKey = ctx.currentClassKey
  if (!classKey) return
  const classNode = ctx.nodes.find((candidate) => candidate.id === classKey && candidate.type === CLASS_GRAPH_NODE_TYPE)
  if (!classNode) return
  ctx.edges.push(makeEdge(ctx.repoId, {
    source_id: sourceId,
    target_id: classNode.id,
    relation: 'calls',
    target_specifier: null,
    target_symbol: classNode.name,
    resolve_status: 'resolved',
    first_arg: firstArg,
    literal_args: literalArgs,
    arg_expressions: argExpressions,
    chain_path: null,
  }))
}