// common_engine/walk_engine — 공유 walk-skeleton (Angle B 잠긴 설계).
// stateful 머신(노드 emit + dedup + nested-executable synthetic 노드 + contains/inverse-calls edge)을
// 언어 무관하게 소유한다. 언어별 grammar 순회는 hooks(recurseCalls/leadingComment 등)로 주입.
// 첫 수렴 조각: collectNestedExecutableNode (TS·Dart 의 콜백/중첩함수 노드 생성을 통합 대상).

import type { CodeNodeRaw, CodeEdgeRaw } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import type { CallExtractor } from './call_extractor.js'
import { makeEdge, walkIdentifiersForDependsOn } from './edge_ops.js'
import { addNode } from './node_factory_ops.js'
import { nestedExecutableName, isAsyncNode, isNestedExecutableNode, fileNodeId } from './node_ops.js'
import { extractFunctionSignature } from './signature_ops.js'
import { extractCallEdge, emitNormalizedCallEdge } from './call_edge_ops.js'
import type { NormalizedCallee } from './normalized.js'
import { unwrapCallFunction } from './chain_extractor.js'
import { sameSpan } from './shared_utils.js'
import { nestedExecutableRole } from './nested_executable_role_ops.js'
import { extractBrowserLocationAssignmentEdge } from './browser_location_ops.js'

/** nested-executable visited-dedup 키 = `{startIndex}:{endIndex}`. */
export function syntaxRangeKey(node: EngineNode): string {
  return `${node.startIndex}:${node.endIndex}`
}

// 어댑터 ParseContext 에서 푼 walk-engine 상태 묶음 (출력 계약 아님 — FieldOriginCtx/CallEdgeCtx precedent).
export interface WalkEngineCtx {
  repoId: string
  filePath: string
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  sourceLines: string[]
  visitedNestedExecutableRanges: Set<string>
  // call-walk 용 (extractCallEdge 의 CallEdgeCtx 충족 + arg depends_on 필터)
  importSymbolMap: Map<string, string>
  currentClassKey: string | null
}


// 언어별 grammar 의존 동작 주입 (grammar 순회 재귀 + leading-comment 추출).
// <N>으로 호출측 노드 타입(native SyntaxNode / WASM Node)을 투명 보존 → 어댑터에 cast 누출 없음.
export interface NestedExecHooks<N extends EngineNode> {
  recurseCalls: (body: N, sourceId: string, nonCallSourceId: string) => void
  leadingComment: (node: N) => string | null
  /** is_async 도출 override (Dart: node.text 의 async 마커). 미지정 → isAsyncNode(node, spec). */
  isAsync?: (node: N) => boolean
  /** is_test/test_type override (Dart: ctx.isTest 추적). 미지정 → {is_test:false, test_type:null}. */
  nodeMeta?: () => { is_test: boolean; test_type: CodeNodeRaw['test_type'] }
}

/** callback: `callback@{row+1}`, nested_function: declaredName(없으면 'nestedFunction'). */
function nestedExecutableLocalName(originKind: string, declaredName: string | null, node: EngineNode): string {
  return originKind === 'nested_function'
    ? (declaredName ?? 'nestedFunction')
    : `callback@${node.startPosition.row + 1}`
}

/** 결정론적 nested-executable 노드 id: `{parentId}:{identity}:{row+1}:{col+1}` (1-indexed). */
function nestedExecutableNodeId(
  parentSourceId: string,
  originKind: string,
  role: string,
  declaredName: string | null,
  node: EngineNode,
): string {
  const row = node.startPosition.row + 1
  const column = node.startPosition.column + 1
  const identity = originKind === 'nested_function'
    ? `${role}:${declaredName ?? 'anonymous'}`
    : role
  return `${parentSourceId}:${identity}:${row}:${column}`
}

/**
 * nested executable(콜백/중첩함수) 를 synthetic `function` 노드로 만들고:
 *  - parent→child `contains` edge (dedup, resolve_status='resolved')
 *  - child→parent 역방향 `calls` edge (build_docs 도달성; target_symbol=parent bare symbol)
 *  - body 를 hooks.recurseCalls 로 재귀 (sourceId = 이 노드 id)
 * typescript.ts collectNestedExecutableNode 에서 verbatim 이동 (id 포맷·dedup·emit 불변).
 */
export function collectNestedExecutableNode<N extends EngineNode>(
  node: N,
  ctx: WalkEngineCtx,
  parentSourceId: string,
  nonCallSourceId: string,
  role: string,
  spec: LanguageSpec,
  hooks: NestedExecHooks<N>,
): string {
  ctx.visitedNestedExecutableRanges.add(syntaxRangeKey(node))
  const originKind = node.type === spec.functionDeclarationType ? 'nested_function' : 'callback'
  const nameNode = node.childForFieldName(spec.nameField)
  const declaredName = nameNode?.text ?? null
  const localName = nestedExecutableLocalName(originKind, declaredName, node)
  const parentName = ctx.nodes.find((candidate) => candidate.id === parentSourceId)?.name
  const name = nestedExecutableName(parentName, localName)
  const id = nestedExecutableNodeId(parentSourceId, originKind, role, declaredName, node)
  const executableNode: CodeNodeRaw = {
    id,
    repo_id: ctx.repoId,
    type: 'function',
    file_path: ctx.filePath,
    name,
    line_start: node.startPosition.row + 1,
    line_end: node.endPosition.row + 1,
    signature: extractFunctionSignature(node, spec),
    parent_node_id: parentSourceId,
    origin_kind: originKind,
    role,
    exported: false,
    parse_status: 'ok',
    is_test: hooks.nodeMeta ? hooks.nodeMeta().is_test : false,
    test_type: hooks.nodeMeta ? hooks.nodeMeta().test_type : null,
    is_async: hooks.isAsync ? hooks.isAsync(node) : isAsyncNode(node, spec),
    jsdoc: null,
    leading_comment: hooks.leadingComment(node),
  }
  addNode(ctx.nodes, executableNode, ctx.sourceLines)

  if (!ctx.edges.some((edge) =>
    edge.relation === 'contains' &&
    edge.source_id === parentSourceId &&
    edge.target_id === id
  )) {
    ctx.edges.push(makeEdge(ctx.repoId, {
      source_id: parentSourceId,
      target_id: id,
      relation: 'contains',
      target_specifier: null,
      target_symbol: localName,
      resolve_status: 'resolved',
      first_arg: null,
      literal_args: null,
    }))
  }

  // Inverse-of-contains `calls` edge: callback → parent function (build_docs 도달성).
  // target_symbol = parent 의 마지막 `.` 세그먼트 (resolved calls edge 규칙과 동일).
  const parentNameForSymbol = ctx.nodes.find((candidate) => candidate.id === parentSourceId)?.name ?? null
  const parentSymbol = parentNameForSymbol !== null ? parentNameForSymbol.split('.').at(-1) ?? parentNameForSymbol : null
  if (!ctx.edges.some((edge) =>
    edge.relation === 'calls' &&
    edge.source_id === id &&
    edge.target_id === parentSourceId
  )) {
    ctx.edges.push(makeEdge(ctx.repoId, {
      source_id: id,
      target_id: parentSourceId,
      relation: 'calls',
      target_specifier: null,
      target_symbol: parentSymbol,
      resolve_status: 'resolved',
      first_arg: null,
      literal_args: null,
    }))
  }

  const body = (node.childForFieldName(spec.bodyField) ?? node.namedChildren[node.namedChildren.length - 1]) as N | null
  if (body) hooks.recurseCalls(body, id, nonCallSourceId)
  return id  // C3: Dart 등 외부 소비자가 callbackId 를 받아 추가 처리(emitBodyIdentifierDependsOn)할 수 있게.
}

// ── 재귀 call/nested-executable walk (walk-engine S5: collectCallExpressionsRecursive 수렴) ──
// 엔진이 nested-exec/call/dynamic-import/assignment/new 분기 + arg depends_on + 재귀를 소유.
// 언어-문법 전용 노드(JSX render / misparse 복구)는 hooks.handleSpecialNode 로 위임.
// owned-executable 단락·visited-range dedup·nonCallSourceId 스레딩 모두 원본 보존.

/**
 * LanguageHooks — codegraph-unification 의 단일 통일 인터페이스 (P1).
 * SOT: specs/build_graph/codegraph-unification-plan.md §2.
 *
 * 한 언어의 grammar-divergent 동작을 모두 여기로 모은다. 모든 슬롯은 엔진이 소유한 stateful 머신
 * (id/dedup/contains+inverse-calls/resolve_status/payload) 위에 얇게 얹히는 "정규화 훅"이다.
 * 출력 계약(CodeNodeRaw/CodeEdgeRaw) 아님 — 내부 어댑터 타입(seam-map §4).
 *
 * 슬롯 채움 일정: call-walk 4종은 SHIPPED. normalizeCallee 는 JVM(Java+Kotlin)이 구현(→ emitNormalizedCallEdge live);
 *   단 JVM 은 자체 scanJavaCalls/scanKotlinCalls 에서 emitNormalizedCallEdge 를 직접 호출(walker 경유 안 함).
 *   walker-mediated normalizeCallee 분기(아래 B2 seam)는 "호출이 discrete call 노드인 언어"용 미래 seam(현재 무호출).
 *   Dart 는 호출이 flat selector 체인이라 normalizeCallee 를 쓰지 않는다(scanCallsEdges per-language, 구조적 경계).
 *   nested-exec/role·normalized-shape 슬롯은 형식만 선언(현재 엔진은 per-call/기존 ops 경로로 동일 동작 →
 *   미지정 시 byte-identical). declaration-walk(P3)·precision(P6) 슬롯은 해당 Phase 에서 추가한다.
 */
export interface LanguageHooks<N extends EngineNode> {
  // ── call-walk (SHIPPED) ──
  /** 선행 주석 추출 (source-line 기반, 언어별). */
  leadingComment: (node: N) => string | null
  /** 함수-래퍼 호출의 콜백 인자 소유 판정 (예: catchAsync(fn) — 언어/프레임워크별). */
  findOwnedExecutableNode: (node: N) => N | null
  /**
   * 엔진이 일반 처리하지 않는 노드(JSX 등)·문법 quirk(misparse) 위임.
   * 반환 true = 완전 처리(엔진이 자식 재귀 안 함), false = 엔진이 자식 재귀.
   * 내부에서 재귀가 필요하면 어댑터의 collectCallExpressionsRecursive(=이 함수 위임) 를 호출.
   */
  handleSpecialNode: (node: N, sourceId: string, nonCallSourceId: string, owned: N | null) => boolean
  /**
   * call/new callee 를 정규화 shape 로 변환 (호출이 discrete call 노드인 grammar 용 walker-mediated seam).
   * 반환 non-null → 엔진이 emitNormalizedCallEdge 로 발화. null/미구현 → 기본 경로(extractCallEdge).
   * TS 는 미구현(undefined) → 항상 기본 경로. JVM 은 walker 를 안 거치고 자체 scanner 에서 직접 발화 →
   * 현재 이 walker 분기는 무호출(latent seam). byte-identical.
   */
  normalizeCallee?: (node: N, spec: LanguageSpec) => NormalizedCallee | null

  // ── nested-exec / role (NestedExecHooks 에서 형식화; 현재 엔진은 per-call 로 동일 동작) ──
  /** is_async override (Dart: node.text async 마커). 미지정 → isAsyncNode(node, spec). */
  isAsync?: (node: N) => boolean
  /** is_test/test_type override (Dart: ctx.isTest 추적). 미지정 → {is_test:false, test_type:null}. */
  nodeMeta?: () => { is_test: boolean; test_type: CodeNodeRaw['test_type'] }
  // 미사용 phantom 슬롯(computeCallbackRole/extractDecorator/extractImport/extractClassHeritage/
  //   classifyFieldOrigin)은 제거 — 아무 어댑터도 set 안 하고 엔진도 안 읽었다(TS-scoped 감사).
  //   실제 2번째 walk-소비자(Dart S6 / JVM P5)가 붙을 때 올바른 shape로 추가한다.
  //   declaration-walk 훅은 declaration_walker.ts DeclarationHooks 로 분리돼 있다.
}

/**
 * @deprecated codegraph-unification P1: WalkHooks 는 LanguageHooks 로 통일되었다.
 * 기존 호출부 호환을 위한 별칭 — 신규 코드는 LanguageHooks 를 쓴다.
 */
export type WalkHooks<N extends EngineNode> = LanguageHooks<N>

function bodyOfExecutable<N extends EngineNode>(node: N, spec: LanguageSpec): N | null {
  return (node.childForFieldName(spec.bodyField) ?? node.namedChildren[node.namedChildren.length - 1]) as N | null
}

/**
 * 재귀 walk: node 를 순회하며 calls/imports/renders/depends_on edge + nested-executable 노드를 발화.
 * typescript.ts collectCallExpressionsRecursive 에서 수렴 — 분기 순서/emit/dedup 모두 verbatim.
 */
export function walkCallsAndNestedExecutables<N extends EngineNode>(
  node: N,
  ctx: WalkEngineCtx,
  sourceId: string,
  nonCallSourceId: string,
  ownedExecutableNode: N | null,
  spec: LanguageSpec,
  callExtractor: CallExtractor,
  hooks: LanguageHooks<N>,
): void {
  const recurse = (child: N, sid: string, ncsid: string, owned: N | null): void =>
    walkCallsAndNestedExecutables(child, ctx, sid, ncsid, owned, spec, callExtractor, hooks)
  const emitArgDependsOn = (argsNode: EngineNode, sid: string): void =>
    walkIdentifiersForDependsOn(argsNode, ctx.repoId, ctx.importSymbolMap, spec, sid, new Set<string>(), ctx.edges)

  if (isNestedExecutableNode(node, spec)) {
    const key = syntaxRangeKey(node)
    if (ctx.visitedNestedExecutableRanges.has(key)) return
    if (ownedExecutableNode && sameSpan(node, ownedExecutableNode)) {
      ctx.visitedNestedExecutableRanges.add(key)
      const body = bodyOfExecutable(node, spec)
      if (body) recurse(body, sourceId, nonCallSourceId, ownedExecutableNode)
      return
    }
    const role = nestedExecutableRole(node, spec, callExtractor)
    if (!role) {
      ctx.visitedNestedExecutableRanges.add(key)
      const body = bodyOfExecutable(node, spec)
      if (body) recurse(body, sourceId, nonCallSourceId, ownedExecutableNode)
      return
    }
    collectNestedExecutableNode(node, ctx, sourceId, nonCallSourceId, role, spec, {
      recurseCalls: (body, sid, ncsid) => recurse(body, sid, ncsid, null),
      leadingComment: hooks.leadingComment,
    })
    return
  }

  if (node.type === spec.callType) {
    const fn = node.childForFieldName(spec.functionField)
    const argsNode = node.childForFieldName(spec.argumentsField)
    // dynamic import (`import('...')`) — fn 이 import 키워드
    if (fn?.type === spec.importExpressionType) {
      if (argsNode) {
        const stringChild = argsNode.children.find((c) => c?.type === spec.stringType)
        if (stringChild) {
          const raw = stringChild.text
          const specifier = raw.startsWith("'") || raw.startsWith('"') ? raw.slice(1, -1) : raw
          ctx.edges.push(makeEdge(ctx.repoId, {
            source_id: fileNodeId(ctx.repoId, ctx.filePath),
            target_id: null,
            relation: 'imports',
            target_specifier: specifier,
            target_symbol: null,
            resolve_status: 'pending',
            first_arg: null,
            literal_args: null,
          }))
        }
        for (const arg of argsNode.children) {
          if (arg) recurse(arg as N, sourceId, nonCallSourceId, ownedExecutableNode)
        }
      }
      return
    }
    if (fn) {
      const fnForEdge = unwrapCallFunction(fn, spec)
      // B2 seam: 언어가 normalizeCallee 를 주면(discrete-call-node 언어) 정규화 발화, 아니면(TS/현재) 기본 경로 → byte-identical.
      const normalized = hooks.normalizeCallee?.(fnForEdge as N, spec) ?? null
      if (normalized) {
        emitNormalizedCallEdge(normalized, argsNode, ctx, sourceId, spec, callExtractor)
      } else {
        extractCallEdge(fnForEdge, argsNode, ctx, sourceId, spec, callExtractor)
      }
      if (fnForEdge.type === spec.memberType) {
        const obj = fnForEdge.childForFieldName(spec.objectField)
        if (obj) recurse(obj as N, sourceId, nonCallSourceId, ownedExecutableNode)
      } else if (fnForEdge.type === spec.callType) {
        // chain call: Cron(expr)(target,...) — 내부 call_expression 도 walk
        recurse(fnForEdge as N, sourceId, nonCallSourceId, ownedExecutableNode)
      } else if (fnForEdge.type === spec.parenthesizedExpressionType) {
        // IIFE: (async () => {...})() — call target 자체가 함수 리터럴이면 body 도 walk
        recurse(fnForEdge as N, sourceId, nonCallSourceId, ownedExecutableNode)
      }
    }
    if (argsNode) {
      emitArgDependsOn(argsNode, nonCallSourceId)
      for (const arg of argsNode.children) {
        if (arg) recurse(arg as N, sourceId, nonCallSourceId, ownedExecutableNode)
      }
    }
  } else if (node.type === spec.assignmentExpressionType) {
    extractBrowserLocationAssignmentEdge(node, spec, ctx.repoId, sourceId, ctx.edges)
    for (const child of node.children) {
      if (child) recurse(child as N, sourceId, nonCallSourceId, ownedExecutableNode)
    }
  } else if (node.type === spec.newType) {
    const ctor = node.childForFieldName(spec.constructorField)
    const argsNode = node.childForFieldName(spec.argumentsField)
    if (ctor) extractCallEdge(ctor, argsNode, ctx, sourceId, spec, callExtractor)
    if (argsNode) {
      emitArgDependsOn(argsNode, nonCallSourceId)
      for (const arg of argsNode.children) {
        if (arg) recurse(arg as N, sourceId, nonCallSourceId, ownedExecutableNode)
      }
    }
  } else {
    // 언어-문법 전용(JSX render / misparse 복구) 위임 — true 면 자식 재귀 안 함.
    if (hooks.handleSpecialNode(node, sourceId, nonCallSourceId, ownedExecutableNode)) return
    for (const child of node.children) {
      if (child) recurse(child as N, sourceId, nonCallSourceId, ownedExecutableNode)
    }
  }
}
