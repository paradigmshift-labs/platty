// f3 runRuleEngine — 어댑터 룰 평가 + emit (LLM 0회).
// SOT: specs/build_route/specs/f3_run_rule_engine/spec.md
//
// minimal orchestrator (Step 6 진입). 후속 작업:
//   - alias 추적 (rule.select.resolve_alias)
//   - sub_router_mounter prefix 주입
//   - controller_inheritance 후처리
//   - nested 룰 (RR-v6, GoRouter)
//   - suspected_collector (routing_files unmatched)
//   - confidence='low' (alias / cycle 시)

import type { CodeEdge } from '@/db/schema/code_graph.js'
import type { GraphIndex } from './graph_index.js'
import { enrichAuthMetadata } from './auth_rulebooks/index.js'
import type {
  EntryPointDraft,
  EntrypointRule,
  MountResult,
  RunRuleEngineResult,
  SelectCandidate,
  StackInfoForBuildRoute,
  SuspectedNode,
  WalkEntry,
  WalkExpr,
} from './types.js'
import type { LoadedAdapter } from './f2_load_adapters.js'
import { evaluateSelect } from './f3/select_evaluator.js'
import { evaluateExtract } from './f3/extract_evaluator.js'
import { evaluateWalk } from './f3/walk_evaluator.js'
import { normalize, join } from './f3/path_normalizer.js'
import { mountSubRouters } from './f3/sub_router_mounter.js'
import { resolveControllerInheritance } from './f3/controller_inheritance.js'
import { resolveAlias } from './f3/alias_resolver.js'
import { collectUnmatchedRoutingFiles } from './f3/suspected_collector.js'
import { derivePrimitiveAliases } from './f3/primitive_aliases.js'

export interface RunRuleEngineInput {
  adapters: LoadedAdapter[]
  graph: GraphIndex
  repoId: string
  stackInfo?: StackInfoForBuildRoute
}

export async function runRuleEngine(input: RunRuleEngineInput): Promise<RunRuleEngineResult> {
  const entryPoints: EntryPointDraft[] = []
  const suspected: SuspectedNode[] = []
  const skippedReasons: Record<string, number> = {}

  // 그래프 1회만 사전 처리 — 모든 어댑터에 공통.
  const mount = mountSubRouters(input.graph)
  const inheritance = resolveControllerInheritance(input.graph)
  const graphNodes = input.graph.getAllNodes()
  const graphEdges = input.graph.getAllEdges()

  // 동적 mount → suspected
  for (const sourceId of mount.dynamicMountSources) {
    suspected.push({
      nodeId: sourceId,
      adapter: 'express',
      reason: 'rule_low_confidence',
      contextHint: 'window',
    })
  }

  for (const adapter of input.adapters) {
    const standardSet = new Set(adapter.aliasResolution?.standardDecorators ?? [])
    const aliasMap = new Map<string, string>()
    for (const [wrapper, mapping] of Object.entries(adapter.resolvedAliases)) {
      aliasMap.set(wrapper, mapping.resolvesTo)
    }
    if (standardSet.size > 0) {
      const graphAliases = derivePrimitiveAliases({
        graphNodes,
        graphEdges,
        primitiveSymbols: [...standardSet],
        maxDepth: adapter.aliasResolution?.aliasDepth ?? 3,
      })
      for (const [wrapper, alias] of Object.entries(graphAliases.aliases)) {
        if (!aliasMap.has(wrapper)) aliasMap.set(wrapper, alias.primitive)
      }
    }

    // rule id → rule lookup (nested 처리용)
    const ruleById = new Map<string, EntrypointRule>()
    for (const r of adapter.entrypointRules) {
      if (r.id) ruleById.set(r.id, r)
    }

    for (const rule of adapter.entrypointRules) {
      // delegate_to llm_fallback — f4 위임
      if (rule.delegateTo === 'llm_fallback') {
        bump(skippedReasons, 'delegate_to_llm_fallback')
        continue
      }

      // alias 확장 — decorated_by 에 wrapper 도 포함시켜 select 가 매칭하게
      const ruleForSelect = expandRuleForAlias(rule, standardSet, aliasMap)
      const candidates = evaluateSelect(ruleForSelect.select, input.graph)
      if (candidates.length === 0) {
        bump(skippedReasons, `no_match:${adapter.name}:${rule.id ?? 'anon'}`)
        continue
      }

      for (const candidate of candidates) {
        // walk 룰: matched edge의 literalArgs에서 source 추출 → entries 만큼 draft 생성
        if (rule.walk) {
          const edge = candidate.matchedEdges[0]
          const source = edge ? extractWalkSource(edge, rule.walk) : null
          if (source === null) {
            bump(skippedReasons, `walk_source_missing:${adapter.name}:${rule.id ?? 'anon'}`)
            continue
          }
          // orchestrator가 이미 source를 추출했으므로 walk_evaluator에는 field 제거한 spec 전달
          const walkEntries = evaluateWalk({ iterate: rule.walk.iterate }, source)
          if (walkEntries.length === 0) {
            bump(skippedReasons, `walk_empty:${adapter.name}:${rule.id ?? 'anon'}`)
            continue
          }
          for (const walkEntry of walkEntries) {
            const draft = buildDraft(adapter.name, rule, candidate, mount, input.graph, aliasMap, standardSet, walkEntry)
            if (!draft) {
              bump(skippedReasons, `extract_failed:${adapter.name}:${rule.id ?? 'anon'}`)
              continue
            }
            const aliasInfo = detectAliasMatch(candidate, standardSet, aliasMap)
            if (aliasInfo) {
              draft.confidence = 'low'
              draft.detectionEvidence.aliasChain = aliasInfo.chain
            }
            entryPoints.push(draft)
          }
          continue
        }

        const draft = buildDraft(adapter.name, rule, candidate, mount, input.graph, aliasMap, standardSet)
        if (!draft) {
          bump(skippedReasons, `extract_failed:${adapter.name}:${rule.id ?? 'anon'}`)
          continue
        }

        // alias 로 매칭된 candidate 는 confidence='low' + chain 기록
        const aliasInfo = detectAliasMatch(candidate, standardSet, aliasMap)
        if (aliasInfo) {
          draft.confidence = 'low'
          draft.detectionEvidence.aliasChain = aliasInfo.chain
        }

        entryPoints.push(draft)
      }

      // nested 룰 — child rule 이 같은 어댑터에 정의됐는지 검증 + 기록.
      // 실제 recursive 처리는 framework-specific (build_graph 의 enclosing/renders 추적).
      // MVP: child rule 도 main loop 에서 별 rule 로 평가됨 (parent_path 합성은 추후).
      if (rule.nested) {
        if (!ruleById.has(rule.nested.childRuleRef)) {
          bump(skippedReasons, `nested_child_missing:${adapter.name}:${rule.id ?? 'anon'}`)
        } else {
          bump(skippedReasons, `nested_pass_through:${adapter.name}:${rule.id ?? 'anon'}`)
        }
      }
    }

    // controller inheritance — 자식 class 에 부모 inherited route emit
    for (const rule of adapter.entrypointRules) {
      if (rule.delegateTo === 'llm_fallback') continue
      if (!rule.select.enclosing_class_decorated_by) continue

      // 이미 emit 된 (class, method.name) 페어를 찾아 자식에게도 emit
      for (const [childClassId, inherited] of inheritance.inheritedByClass.entries()) {
        const childClass = input.graph.getNode(childClassId)
        /* v8 ignore next -- inheritedByClass keys are produced from graph class nodes in this pass. */
        if (!childClass) continue
        for (const inh of inherited) {
          const decoratorEdges = filterDecoratorEdgesForRule(inh.decoratorEdges, rule)
          if (decoratorEdges.length === 0) continue

          // 자식 class 의 inherited method 를 가상 candidate 로 만들어 처리
          const virtualCandidate: SelectCandidate = {
            node: inh.method,
            matchedEdges: decoratorEdges,
          }
          const draft = buildDraft(adapter.name, rule, virtualCandidate, mount, input.graph, aliasMap, standardSet)
          /* v8 ignore next -- inherited candidates come from concrete graph method nodes with a default handler id. */
          if (!draft) continue
          // metadata 에 inherited_from 표시
          draft.metadata.inheritedFrom = inh.inheritedFrom.id
          draft.metadata.inheritedToClass = childClassId
          entryPoints.push(draft)
        }
      }
    }
  }

  // suspected: routing_files 매칭 0건 file 수집
  if (input.stackInfo?.routingFiles && input.stackInfo.routingFiles.length > 0) {
    const emittedSet = new Set(entryPoints.map((ep) => ep.handlerNodeId))
    for (const adapter of input.adapters) {
      const unmatched = collectUnmatchedRoutingFiles({
        routingFiles: input.stackInfo.routingFiles,
        emittedHandlerNodeIds: emittedSet,
        graph: input.graph,
        adapter: adapter.name,
      })
      // dedup with already-collected suspected
      const existing = new Set(suspected.map((s) => s.nodeId))
      for (const s of unmatched) {
        if (!existing.has(s.nodeId)) suspected.push(s)
      }
    }
  }

  // delegate_to llm_fallback: 룰 자체가 위임 — entrypoint 후보 노드를 suspected 로 추가
  for (const adapter of input.adapters) {
    for (const rule of adapter.entrypointRules) {
      if (rule.delegateTo !== 'llm_fallback') continue
      const candidates = evaluateSelect(rule.select, input.graph)
      for (const c of candidates) {
        suspected.push({
          nodeId: c.node.id,
          adapter: adapter.name,
          reason: 'adapter_delegate',
          contextHint: 'window',
        })
      }
    }
  }

  // f3.5: endpoint authorization enrichment — fill metadata.auth from framework auth annotations
  // (decorates edges build_graph already emits). Orthogonal to route structure; no-op when absent.
  const finalEntryPoints = dedupeEntryPoints(entryPoints, input.graph)
  for (const ep of finalEntryPoints) enrichAuthMetadata(ep, input.graph)

  return {
    entryPoints: finalEntryPoints,
    suspected,
    skippedReasons,
  }
}

/**
 * decorated_by 에 alias wrapper 추가 — select 가 매칭하도록.
 * standardSet 으로 풀리는 모든 wrapper 가 후보.
 */
function expandRuleForAlias(
  rule: EntrypointRule,
  standardSet: Set<string>,
  aliasMap: Map<string, string>,
): EntrypointRule {
  if (!rule.select.decorated_by) return rule
  if (aliasMap.size === 0) return rule

  const original = new Set(toArray(rule.select.decorated_by))
  const expanded = new Set(original)
  for (const wrapper of aliasMap.keys()) {
    if (expanded.has(wrapper)) continue
    const r = resolveAlias(wrapper, aliasMap, standardSet)
    if (r.resolved !== null && original.has(r.resolved)) {
      expanded.add(wrapper)
    }
  }
  if (expanded.size === original.size) return rule
  return {
    ...rule,
    select: { ...rule.select, decorated_by: [...expanded] },
  }
}

/**
 * candidate 가 alias 로 매칭됐는지 검사. 매칭이면 chain 반환.
 */
function detectAliasMatch(
  candidate: SelectCandidate,
  standardSet: Set<string>,
  aliasMap: Map<string, string>,
): { chain: string[] } | null {
  if (aliasMap.size === 0) return null
  const decorEdges = candidate.matchedEdges.filter((edge) => edge.relation === 'decorates')
  for (const edge of decorEdges) {
    /* v8 ignore next -- select/decorator filters only pass decorator edges with target symbols. */
    if (!edge.targetSymbol) continue
    if (standardSet.has(edge.targetSymbol)) continue // 이미 standard
    if (!aliasMap.has(edge.targetSymbol)) continue
    const r = resolveAlias(edge.targetSymbol, aliasMap, standardSet)
    if (r.resolved !== null) return { chain: r.chain }
  }
  return null
}

function toArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v]
}

function filterDecoratorEdgesForRule(
  edges: SelectCandidate['matchedEdges'],
  rule: EntrypointRule,
): SelectCandidate['matchedEdges'] {
  if (!rule.select.decorated_by) return edges
  const decorators = new Set(toArray(rule.select.decorated_by))
  return edges.filter((edge) => edge.targetSymbol !== null && decorators.has(edge.targetSymbol))
}

function dedupeEntryPoints(
  entryPoints: EntryPointDraft[],
  graph: GraphIndex,
): EntryPointDraft[] {
  const out: EntryPointDraft[] = []
  for (const ep of entryPoints) {
    const key = [
      ep.framework,
      ep.kind,
      ep.httpMethod ?? '',
      ep.fullPath ?? ep.path ?? '',
    ].join('\0')

    const idx = out.findIndex((existing) => {
      const existingKey = [
        existing.framework,
        existing.kind,
        existing.httpMethod ?? '',
        existing.fullPath ?? existing.path ?? '',
      ].join('\0')
      if (existingKey !== key) return false
      // 상속 entry는 별개 (메타로 구분) — 같은 handlerNodeId여도 inheritedToClass가 다르면 보존
      if (existing.metadata?.inheritedToClass !== ep.metadata?.inheritedToClass) return false
      // Case 1: 동일 handlerNodeId → 정확한 중복 (B3 fix — 같은 source에서 여러 edge가 같은 entry 생성)
      if (existing.handlerNodeId === ep.handlerNodeId) return true
      // Case 2: file fallback overlap → 다른 handler이지만 file 노드 fallback과 겹침
      return isFileFallbackPair(existing, ep, graph)
    })

    if (idx < 0) {
      out.push(ep)
      continue
    }

    if (shouldPrefer(ep, out[idx], graph)) {
      out[idx] = ep
    }
  }
  return out
}

function shouldPrefer(candidate: EntryPointDraft, current: EntryPointDraft, graph: GraphIndex): boolean {
  const candidateNode = graph.getNode(candidate.handlerNodeId)
  const currentNode = graph.getNode(current.handlerNodeId)
  if (currentNode?.type === 'file' && candidateNode?.type !== 'file') return true
  /* v8 ignore next -- V8 splits the compound confidence predicate beyond the behavior-level duplicate tests. */
  if (current.confidence !== 'high' && candidate.confidence === 'high') return true
  return false
}

function isFileFallbackPair(a: EntryPointDraft, b: EntryPointDraft, graph: GraphIndex): boolean {
  const aNode = graph.getNode(a.handlerNodeId)
  const bNode = graph.getNode(b.handlerNodeId)
  return aNode?.type === 'file' || bNode?.type === 'file'
}

/**
 * walk 룰의 source 추출 — matched edge의 literalArgs JSON 파싱 후 walk.field에 해당하는 named arg 값 반환.
 *
 * dart.ts/typescript.ts의 literalArgs 형식: [positional..., {named_args}]
 * jvm.ts의 decorator literalArgs 형식: { positional: [], named: { key: value } }
 * walk.field 명시 시: 마지막 원소(named args 객체)에서 field 키의 값을 source로 반환
 * walk.field 미지정 시: parsed 결과 그대로 반환 (array_element 등에 사용)
 */
function extractWalkSource(edge: CodeEdge, walk: WalkExpr): unknown {
  if (!edge.literalArgs) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(edge.literalArgs)
  } catch {
    return null
  }

  if (walk.field !== undefined) {
    const named = extractNamedArgs(parsed)
    if (!named) return null
    if (!(walk.field in named)) return null
    return named[walk.field]
  }

  return parsed
}

function extractNamedArgs(parsed: unknown): Record<string, unknown> | null {
  if (Array.isArray(parsed)) {
    const lastArg = parsed[parsed.length - 1]
    if (lastArg === null || typeof lastArg !== 'object' || Array.isArray(lastArg)) return null
    return lastArg as Record<string, unknown>
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const named = (parsed as { named?: unknown }).named
    if (named && typeof named === 'object' && !Array.isArray(named)) return named as Record<string, unknown>
  }
  return null
}

function buildDraft(
  framework: string,
  rule: EntrypointRule,
  candidate: SelectCandidate,
  mount?: MountResult,
  graph?: GraphIndex,
  aliasMap?: Map<string, string>,
  standardSet?: Set<string>,
  walkEntry?: WalkEntry,
): EntryPointDraft | null {
  const draft: EntryPointDraft = {
    framework,
    kind: rule.kind,
    handlerNodeId: candidate.node.id, // default — extract 가 덮어쓸 수 있음
    metadata: {},
    detectionSource: `rule:${framework}`,
    confidence: 'high',
    detectionEvidence: {
      matchedRuleId: rule.id ?? 'anonymous',
      matchedNodeIds: [candidate.node.id],
      matchedEdgeIds: candidate.matchedEdges.map((edge) => edge.id),
    },
  }

  // extract 평가
  const ctx = { candidate, aliasMap, standardSet, walkEntry }
  const resolved: Record<string, string> = {}
  for (const [key, template] of Object.entries(rule.extract)) {
    const value = evaluateExtract(template, ctx, { graph })
    if (value === null) {
      // 미지원 placeholder — 핵심 필드면 fail, 아니면 무시
      if (key === 'handler_node_id') return null
      continue
    }
    resolved[key] = value
  }

  // 필드 매핑 (camelCase 변환)
  if (resolved.handler_node_id) draft.handlerNodeId = resolved.handler_node_id
  if (resolved.path) draft.path = rule.kind === 'event' ? resolved.path : normalize(resolved.path)
  if (resolved.parent_path) draft.parentPath = normalize(resolved.parent_path)
  if (resolved.http_method) draft.httpMethod = resolved.http_method.toUpperCase()

  // mount prefix — Express sub-router 안 calls 라면 prefix prepend
  if (mount && draft.path) {
    for (const edge of candidate.matchedEdges) {
      const prefix = mount.prefixByCallEdgeId.get(edge.id)
      if (prefix !== undefined) {
        draft.path = join(prefix, draft.path)
        const evidence = mount.evidenceByCallEdgeId.get(edge.id)
        if (evidence) {
          draft.detectionEvidence.matchedNodeIds = [
            ...draft.detectionEvidence.matchedNodeIds,
            ...evidence.nodeIds,
          ].filter((id, index, all) => all.indexOf(id) === index)
          draft.detectionEvidence.matchedEdgeIds = [
            ...draft.detectionEvidence.matchedEdgeIds,
            ...evidence.edgeIds,
          ].filter((id, index, all) => all.indexOf(id) === index)
        }
        break
      }
    }
  }

  // full_path 합성
  if (resolved.full_path) {
    draft.fullPath = rule.kind === 'event' ? resolved.full_path : normalize(resolved.full_path)
  } else if (draft.path !== undefined) {
    draft.fullPath = draft.parentPath ? join(draft.parentPath, draft.path) : draft.path
  } else if (draft.parentPath) {
    // path 미설정(null firstArg) + parentPath 있으면 parent 만 fullPath
    draft.fullPath = normalize(draft.parentPath)
  } else if (rule.kind === 'api') {
    // Frameworks such as NestJS represent root handlers as @Controller() + @Get().
    draft.path = '/'
    draft.fullPath = '/'
  }

  // handler_node_id 누락 — emit 불가
  if (!draft.handlerNodeId) return null

  return draft
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}
