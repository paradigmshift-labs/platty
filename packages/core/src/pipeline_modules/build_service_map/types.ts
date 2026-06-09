import type { DB } from '@/db/client.js'
import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import type {
  ServiceMapNodeType,
  ServiceMapEdgeKind,
  ServiceMapEdgeSource,
  EdgeEvidence,
} from '@/db/schema/build_service_map.js'

export type { ServiceMapNodeType, ServiceMapEdgeKind, ServiceMapEdgeSource, EdgeEvidence }

export type RelationFactKind =
  | 'db_access'
  | 'navigation'
  | 'external_link'
  | 'external_service'
  | 'api_call'
  | 'event_publish'
  | 'event_listen'
  | 'schedule_trigger'

// ────────────────────────────────────────
// 최상위 입출력
// ────────────────────────────────────────

export interface BuildServiceMapOptions {
  includeLowConfidence?: boolean
  failOnValidationWarning?: boolean
  /**
   * F2 (document-based relation facts) 활성화 여부. 기본 false.
   *
   * MVP: build_docs가 LLM relation_facts를 생성하지 않으므로 false가 정답.
   * 추후 build_docs 프롬프트에서 relation_facts 생성을 허용하면 true로 전환.
   * false일 때 F2는 호출되지 않고 빈 DocumentFactIndex로 대체된다.
   */
  includeDocumentFacts?: boolean
}

export interface RunBuildServiceMapInput {
  db: DB
  repoId?: string
  projectId?: string
  parentRunId?: string
  signal?: AbortSignal
  opts?: BuildServiceMapOptions
}

export interface RunBuildServiceMapResult {
  runId: string
  insertedEdges: number
  skippedLowConfidence: number
  unresolvedFacts: number
  warnings: ServiceMapWarning[]
}

// ────────────────────────────────────────
// F1 출력: ServiceMapInputIndex
// ────────────────────────────────────────

export interface EntryPointForServiceMap {
  id: string
  repoId: string
  framework: string
  kind: 'api' | 'page' | 'job' | 'event'
  httpMethod: string | null
  path: string | null
  fullPath: string | null
  handlerNodeId: string
  metadata: Record<string, unknown> | null
  confidence: 'high' | 'medium' | 'low'
  filePath: string | null
  name: string | null
}

export interface CodeRelationForServiceMap {
  id: string
  repoId: string
  sourceNodeId: string
  kind: RelationFactKind
  target: string | null
  operation: string | null
  canonicalTarget: string | null
  payload: Record<string, unknown>
  evidenceNodeIds: string[]
  confidence: 'high' | 'medium' | 'low'
  unresolvedReason: string | null
}

export interface DocumentForServiceMap {
  id: string
  projectId: string
  type: string
  scope: string
  scopeId: string | null
  status: string
  content: Record<string, unknown> | null
}

export interface ServiceMapInputIndex {
  repoId: string | null
  projectId: string
  repoIds: string[]
  apiTargetRepoHints: ApiTargetRepoHint[]
  entryPoints: EntryPointForServiceMap[]
  codeBundles: Array<{ entryPointId: string; nodeId: string; depth: number }>
  graphNodes: Array<Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name' | 'lineStart' | 'lineEnd' | 'parentNodeId' | 'originKind' | 'role'>>
  graphEdges: Array<Pick<CodeEdge, 'sourceId' | 'targetId' | 'relation' | 'targetSymbol' | 'targetSpecifier' | 'chainPath'>>
  codeRelations: CodeRelationForServiceMap[]
  documents: DocumentForServiceMap[]
  docDeps: Array<{ documentId: string; codeNodeId: string; depType: string }>
}

export interface ApiTargetRepoHint {
  sourceRepoId: string
  method: string
  path: string
  targetRepoId: string
}

// ────────────────────────────────────────
// 내부 fact 타입
// ────────────────────────────────────────

export interface AnchoredRelationFact {
  factId: string
  sourceEntryPointId: string
  kind: RelationFactKind
  target: string | null
  operation: string | null
  canonicalTarget: string | null
  payload: Record<string, unknown>
  confidence: 'high' | 'medium' | 'low'
  source: 'deterministic' | 'doc_llm'
  relationId?: string
  documentId?: string
  evidenceNodeIds: string[]
  unresolvedReason?: string | null
  metadata?: ServiceMapFactDebugMetadata
}

export interface ResolvedRelationFact extends Omit<AnchoredRelationFact, 'source' | 'canonicalTarget'> {
  canonicalTarget: string
  source: 'deterministic' | 'suffix_match' | 'doc_llm'
  suffixMatch?: {
    rawSuffix: string
    baseUrlEnv?: string
    proximityScore?: number
  }
}

export interface ServiceMapNode {
  type: ServiceMapNodeType
  id: string
  label: string | null
  repoId?: string | null
}

export interface MatchedServiceMapFact extends ResolvedRelationFact {
  sourceNode: ServiceMapNode
  targetNode: ServiceMapNode
  edgeKind: ServiceMapEdgeKind
}

export interface DraftServiceMapEdge {
  id: string
  projectId: string
  repoId: string
  sourceRepoId: string
  targetRepoId?: string | null
  sourceNode: ServiceMapNode
  targetNode: ServiceMapNode
  kind: ServiceMapEdgeKind
  canonicalTarget: string
  confidence: 'high' | 'medium' | 'low'
  source: ServiceMapEdgeSource
  evidence: EdgeEvidence
  unresolvedReason?: string | null
}

export type MergedServiceMapEdge = DraftServiceMapEdge

// ────────────────────────────────────────
// Index/result 타입
// ────────────────────────────────────────

export interface ServiceMapFactDebugMetadata {
  sourceNodeOriginKind?: string | null
  sourceNodeRole?: string | null
  parentNodeId?: string | null
  anchorFailureReason?: string
}

export interface UnresolvedServiceMapFact {
  factId: string
  kind: RelationFactKind
  sourceEntryPointId?: string
  relationId?: string
  documentId?: string
  reason: string
  metadata?: ServiceMapFactDebugMetadata
}

export interface ServiceMapWarning {
  code: string
  message: string
  factId?: string
  relationId?: string
  documentId?: string
  category?: 'product_gap' | 'non_product_db_fact'
  severity?: 'info' | 'warning'
  metadata?: UnresolvedServiceMapFact['metadata']
}

export interface DocumentFactIndex {
  anchoredFacts: AnchoredRelationFact[]
  mergeEvidenceFacts: AnchoredRelationFact[]
  unresolvedFacts: UnresolvedServiceMapFact[]
  warnings: ServiceMapWarning[]
}

export interface DeterministicFactIndex {
  anchoredFacts: AnchoredRelationFact[]
  scheduleMarkers: AnchoredRelationFact[]
  orphanFacts: UnresolvedServiceMapFact[]
}

export interface ResolvedFactSet {
  facts: ResolvedRelationFact[]
  unresolvedFacts: UnresolvedServiceMapFact[]
  skippedMarkers: AnchoredRelationFact[]
}

export interface ServiceMapValidation {
  warnings: ServiceMapWarning[]
  shouldFail: boolean
}

export interface PersistServiceMapResult {
  insertedEdges: number
  skippedLowConfidence: number
}
