// build_route 도메인 타입.
// JIT 정의 — sub-module 진입할 때마다 필요한 타입 추가.

import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import type { CodeNodeType, EdgeRelation, Framework } from '@/db/schema/enums.js'
import type { GraphIndex } from './graph_index.js'

// ────────────────────────────────────────
// f1: activateAdapters
// ────────────────────────────────────────

/**
 * analyze_repo가 채우는 다운스트림 계약.
 * 출처: specs/analyze_repo/OVERVIEW.md §6
 */
export interface StackInfoForBuildRoute {
  framework: Framework
  routingLibs: string[]                                       // ['react-router-dom@^6'], ['go_router'], []
  customDecorators?: Record<string, CustomDecoratorMapping>   // alias 추적용 (analyze_repo Layer 2)
  apiBasePaths?: string[]
  routingFiles?: string[]
  entrypointFiles?: string[]
}

export interface CustomDecoratorMapping {
  resolvesTo: string                  // 표준 decorator 이름 (e.g. 'Get', 'Post')
  source: string                      // import 출처 ('@my-org/decorators')
}

/**
 * 어댑터 메타 — yaml header (priority + detection).
 * Step 5 yaml 작성 후 yaml→이 구조로 파싱.
 */
export interface AdapterMeta {
  framework: string                                                 // 'nestjs' | 'express' | ...
  priority: number                                                  // 높을수록 우선
  exclusiveWith?: string[]                                          // 다른 framework 이름들
  mvpStatus?: 'mvp' | 'mvp_post'                                    // 'mvp_post' → active=0 + skipped_reason
  detection: {
    manifestFrameworkMatch?: Framework[]                            // StackInfo.framework 매치
    manifestRoutingLibMatch?: string[]                              // routing_libs 중 하나라도 매치 (semver 포함 — 'react-router-dom@^6')
    manifestRoutingLibAbsent?: boolean                              // routing_libs 비어 있을 때만 매치 (Navigator 1.0 fallback)
    importSpecifiers?: string[]                                     // imports edges target_specifier 매칭
    callPatterns?: string[]                                         // calls edges target_symbol 매칭
  }
  minEvidence: 'manifest_only' | 'manifest_AND_imports' | 'any_two'
}

// ────────────────────────────────────────
// f3: select primitives (architecture.md §4.3)
// ────────────────────────────────────────

export type FirstArgKind =
  | 'string_literal'
  | 'object'
  | 'array'
  | 'identifier'
  | 'lambda'

export interface SelectExpr {
  relation?: EdgeRelation
  callee?: {
    symbol?: string | string[]
    chain_path_root_in?: string[]
    method?: string | string[]
  }
  decorated_by?: string | string[]
  enclosing_class_decorated_by?: string
  node_type?: CodeNodeType
  file_glob?: string | string[]
  exclude_glob?: string | string[]
  first_arg?: { kind?: FirstArgKind }
  /** architecture.md §4.3 — code_nodes.isDefaultExport 필터. */
  is_default_export?: boolean
  /**
   * Emergent-DSL evidence gate (only applied when EMERGENT mode is on): keep only edges whose
   * SOURCE FILE imports one of these package specifiers. Lets call rules (express `app.get`)
   * self-gate on the framework import instead of the framework-activation gate.
   */
  requires_import?: string[]
  /**
   * Minimum call arity (only applied when EMERGENT mode is on). Drops a `calls` edge whose recorded
   * literalArgs array is shorter than this — distinguishes a real route `app.get('/x', handler)`
   * (literalArgs `["/x", null]`, len 2) from a settings getter `app.get('env')` (`["env"]`, len 1).
   * Conservative: an edge with null/unparseable literalArgs is KEPT (no false drops).
   */
  min_arg_count?: number
}

export interface SelectCandidate {
  node: CodeNode
  matchedEdges: CodeEdge[]
}

// ────────────────────────────────────────
// Adapter (architecture §4.2 — TS 모듈 형식, 2026-05-08 결정)
// ────────────────────────────────────────

export interface AdapterDetection {
  manifestFrameworkMatch?: Framework[]
  manifestRoutingLibMatch?: string[]
  manifestRoutingLibAbsent?: boolean
  importSpecifiers?: string[]
  callPatterns?: string[]
}

export interface AliasResolutionConfig {
  via?: string[]
  standardDecorators: string[]
  aliasDepth?: number
}

export interface NestedExpr {
  parentField: string
  childRuleRef: string
}

export interface EntrypointRule {
  id?: string
  kind: 'api' | 'page' | 'job' | 'event'
  select: SelectExpr
  walk?: WalkExpr
  /** 컬럼명 → ${placeholder} 템플릿. extract_evaluator 가 평가. */
  extract: Record<string, string>
  nested?: NestedExpr
  delegateTo?: 'llm_fallback'
}

export interface Adapter {
  name: string
  version: string
  type: 'A' | 'B' | 'C'
  language: string | string[]
  detection: AdapterDetection
  minEvidence: 'manifest_only' | 'manifest_AND_imports' | 'any_two'
  priority: number
  exclusiveWith?: string[]
  mvpStatus?: 'mvp' | 'mvp_post'
  entrypointRules: EntrypointRule[]
  aliasResolution?: AliasResolutionConfig
  /**
   * true이면 stackInfo.apiBasePaths가 단일값일 때 entry의 fullPath에 prefix 적용 대상이 된다.
   * REST API 프레임워크(NestJS globalPrefix, Express base 등)에서 true 선언.
   * 미지정 시 false (page/job/event 등 prefix 미적용).
   */
  supportsGlobalPrefix?: boolean
}

export type AdapterRegistry = Record<string, Adapter>

// ────────────────────────────────────────
// f3: 출력 (entry_points, suspected) — spec.md §2
// ────────────────────────────────────────

export interface EntryPointDraft {
  framework: string
  kind: 'api' | 'page' | 'job' | 'event'
  httpMethod?: string
  path?: string
  parentPath?: string
  fullPath?: string
  handlerNodeId: string
  metadata: Record<string, unknown>
  detectionSource: string                       // 'rule:nestjs' | 'rule:express' | ...
  confidence: 'high' | 'medium' | 'low'
  detectionEvidence: {
    matchedRuleId: string
    matchedNodeIds: string[]
    matchedEdgeIds: number[]
    aliasChain?: string[]
    cycleDetected?: boolean
  }
}

export interface SuspectedNode {
  nodeId: string
  adapter: string
  reason: 'adapter_delegate' | 'unmatched_routing_file' | 'rule_low_confidence' | 'semantic_navigation_ambiguous'
  contextHint?: 'window' | 'file'
}

export interface RunRuleEngineResult {
  entryPoints: EntryPointDraft[]
  suspected: SuspectedNode[]
  skippedReasons: Record<string, number>
}

// ────────────────────────────────────────
// f4: source analyzers + semantic entries
// ────────────────────────────────────────

export type SemanticNavigationKind =
  | 'bottom_nav'
  | 'tabs'
  | 'segmented_control'
  | 'indexed_stack'
  | 'page_view'
  | 'tab_bar_view'
  | 'index_state_nav'
  | 'key_state_nav'
  | 'navigator_push'
  | 'dialog'
  | 'bottom_sheet'

export type SemanticNavEvidence =
  | 'state_index_selector'
  | 'state_key_selector'
  | 'single_child_by_index'
  | 'single_child_by_key'
  | 'tab_like_control'
  | 'bottom_nav_like_control'
  | 'navigator_push'
  | 'route_builder'
  | 'modal_builder'
  | 'extension_navigation'
  | 'package_navigation'
  | 'label_list'
  | 'component_array'
  | 'conditional_component_render'
  | 'switch_component_render'
  | 'nav_button_updates_selector'
  | 'main_region_render'

export type RouteResolution =
  | 'exact_static'
  | 'table_resolved'
  | 'constructor_inferred'
  | 'dynamic_suspected'
  | 'llm_fallback'

export interface SemanticEntryMetadata {
  externalRoute: false
  semanticEntry: true
  parentRoute?: string
  parentPage?: string
  navigationKind: SemanticNavigationKind
  index?: number
  tabKey?: string
  label?: string
  routeResolution?: RouteResolution
  evidence: SemanticNavEvidence[]
}

export interface AnalyzerContext {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: CodeNode[]
  graph: GraphIndex
}

export interface SourceFileContext {
  filePath: string
  source: string
  fileNodeId: string
}

export interface SourceRouteAdapterDetection {
  adapterId: string
  active: boolean
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  reason?: string
}

export interface SourceRouteContext {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: CodeNode[]
  graphEdges: CodeEdge[]
  graph: GraphIndex
  sourceFiles: SourceFileContext[]
  readSource(filePath: string): string | null
}

/**
 * source fallback adapter의 merge 정책.
 * - 'additive': rule engine 결과에 source entry를 추가만 함 (default).
 * - 'supersede_framework': source entry가 있으면 rule engine의 동일 framework entry 전체 제거.
 *   (예: flutter_gorouter source가 더 정확하므로 rule엔진의 flutter_gorouter entry는 신뢰도 낮음)
 * - 'supersede_handler': source entry와 동일 handlerNodeId+key의 rule entry만 제거.
 *   (예: express variable_mount이 정확한 mount prefix를 알 때 rule의 부정확한 entry 대체)
 */
export type SourceFallbackMergePolicy =
  | 'additive'
  | 'supersede_framework'
  | 'supersede_handler'

export interface SourceRouteAdapter {
  id: string
  family: string
  capability: string
  additive: boolean
  detect(ctx: SourceRouteContext): SourceRouteAdapterDetection
  extract(ctx: SourceRouteContext, detection: SourceRouteAdapterDetection): EntryPointDraft[]
  /**
   * 이 어댑터가 emit하는 entry들의 merge 정책.
   * 미지정 시 'additive' (기본값, 대부분의 어댑터).
   * sourceAdapter helper가 자동으로 entry.metadata.mergePolicy에 태깅 → compose가 그걸 읽어 적용.
   */
  mergePolicy?: SourceFallbackMergePolicy
}

export interface SourceRouteAdapterRunResult {
  entryPoints: EntryPointDraft[]
  detections: SourceRouteAdapterDetection[]
  diagnostics: Record<string, number>
}

export interface AnalyzerResult {
  entryPoints: EntryPointDraft[]
  suspected: SuspectedNode[]
  diagnostics: Record<string, number>
}

export interface AnalyzerContextBundle {
  rootFile: SourceFileContext
  relatedFiles: SourceFileContext[]
  relatedNodeIds: string[]
  reason:
    | 'import_export'
    | 're_export'
    | 'route_target'
    | 'server_action'
    | 'loader_action'
    | 'semantic_mapping'
}

export interface BuildRouteAnalyzerAdapter {
  name: string
  kind: 'source_route' | 'semantic_page'
  framework: string
  appliesTo(ctx: AnalyzerContext): boolean
  candidateFiles(ctx: AnalyzerContext): string[]
  analyzeFile(file: SourceFileContext, ctx: AnalyzerContext): AnalyzerResult
}

// ────────────────────────────────────────
// f5: reachability (BFS)
// ────────────────────────────────────────

export interface ReachabilityCaps {
  /** entry_point 1개당 reachable 최대 노드 수 (default 5000). */
  maxNodes?: number
  /** BFS 최대 깊이 (default 10). */
  maxDepth?: number
  /** 한 노드에서 파생되는 최대 outgoing edges (default 50). */
  maxFanOut?: number
}

export interface BundleEntry {
  entryPointId: string
  nodeId: string
  depth: number
  edgePath?: string[]
  truncatedBy?: 'node_count' | 'depth' | 'fan_out'
}

// ────────────────────────────────────────
// f3: walk template (architecture.md §4.3)
// ────────────────────────────────────────

export interface WalkExpr {
  iterate: 'object_property' | 'array_element' | 'map_entries'
  /** object_property 일 때 특정 필드 1개만 추출. 미지정 시 모든 entry. */
  field?: string
}

export interface WalkEntry {
  key: string
  value: unknown
}

// ────────────────────────────────────────
// f3: extract template (architecture.md §4.3)
// ────────────────────────────────────────

export interface ExtractContext {
  candidate: SelectCandidate
  /** ${parent_path} 치환 — nested 룰 합성 시 부모로부터 전달. */
  parentPath?: string
  /** ${path} 치환 — 외부에서 결정된 path 변수. */
  path?: string
  /**
   * graph 주입 — ${enclosing_class.X.first_arg} 등 그래프 탐색이 필요한
   * placeholder 해석 시 사용. 없으면 그래프 탐색 placeholder 는 null 반환.
   */
  graph?: import('./graph_index.js').GraphIndex
  /**
   * aliasMap 주입 — ${decorator_name} 해석 시 alias 추적에 사용.
   * wrapper → resolvesTo 매핑 (analyze_repo Layer 2 + 어댑터 aliasResolution 머지).
   * 없으면 raw targetSymbol 반환 (fallback).
   */
  aliasMap?: ReadonlyMap<string, string>
  /**
   * standardSet 주입 — aliasMap 과 함께 resolveAlias 호출 시 사용.
   * 없으면 aliasMap fallback 처리.
   */
  standardSet?: ReadonlySet<string>
  /**
   * walk 룰 평가 시 현재 WalkEntry 주입.
   * ${entry.key}, ${entry.value} placeholder 해석에 사용.
   * 없으면 entry.* placeholder는 null 반환.
   */
  walkEntry?: WalkEntry
}

// ────────────────────────────────────────
// f3: sub-router mounting (architecture.md §4.3 — Express)
// ────────────────────────────────────────

export interface MountResult {
  /** sub-router 이름 → 누적 mount prefix. */
  mountMap: Map<string, string>
  /** call edge id → 적용할 prefix (chainPath root가 mounted router). */
  prefixByCallEdgeId: Map<number, string>
  /** call edge id → prefix를 제공한 mount/register evidence. */
  evidenceByCallEdgeId: Map<number, { nodeIds: string[]; edgeIds: number[] }>
  /** 정적 추적 실패한 mount edge의 source node ids (suspected 후보). */
  dynamicMountSources: string[]
}

// ────────────────────────────────────────
// f3: controller inheritance (architecture.md §4.3, spec §5.4)
// ────────────────────────────────────────

export interface InheritedMethod {
  /** 부모에 정의된 method 노드. */
  method: CodeNode
  /** 어느 부모로부터 상속됐는지. */
  inheritedFrom: CodeNode
  /** 그 method 의 decorates edges (라우트 정보 포함). */
  decoratorEdges: CodeEdge[]
}

export interface InheritanceResult {
  /** child class id → 상속받은 method 들. */
  inheritedByClass: Map<string, InheritedMethod[]>
}

// ────────────────────────────────────────
// f3: alias resolution (architecture.md §4.5)
// ────────────────────────────────────────

export interface AliasResolveOptions {
  /** wrapper N단까지 추적 (default 3, spec §4.3 alias_depth). */
  depth?: number
}

export interface AliasResolveResult {
  /** 표준 decorator 이름 (성공 시), null (실패 시). */
  resolved: string | null
  /** 추적 경로 (방문한 symbol 순서). */
  chain: string[]
  cycleDetected: boolean
  failedReason?: 'cycle' | 'external' | 'depth_exceeded'
}

/**
 * 활성화 결과 — DB framework_detections 와 거의 1:1.
 */
export interface FrameworkDetectionResult {
  framework: string
  detectedVia: 'manifest' | 'imports' | 'pattern'
  evidence: Record<string, unknown>
  active: boolean
  skippedReason?:
    | 'manifest_version_mismatch'
    | 'exclusive_with'
    | 'min_evidence_failed'
    | 'mvp_post'
    | 'framework_other'
    | 'no_router_lib'
  priority: number
  exclusiveWith: string[]
}
