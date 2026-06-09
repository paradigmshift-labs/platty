/* v8 ignore file -- type-only module */
// build_relations 공유 타입
// SOT: specs/build_relations/architecture.md §4

import type { CodeRelationKind, CodeRelationConfidence } from '@/db/schema/build_relations.js'
import type { CallArgExpression } from '@/pipeline_modules/build_graph/types.js'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import type { DB } from '@/db/client.js'
import type { StaticAnalysisPatternProfile } from '@/pipeline_modules/shared/static_config/index.js'

export type { CodeRelationKind, CodeRelationConfidence, CallArgExpression }

// ── 로컬 타입 별칭 ─────────────────────────────────────────

export type CodeNodeLike = Pick<
  CodeNode,
  'id' | 'repoId' | 'type' | 'name' | 'filePath' | 'lineStart' | 'lineEnd' | 'isTest' | 'parseStatus'
>

export type CodeEdgeLike = Pick<
  CodeEdge,
  | 'id'
  | 'repoId'
  | 'sourceId'
  | 'targetId'
  | 'relation'
  | 'targetSpecifier'
  | 'targetSymbol'
  | 'typeRefSubtype'
  | 'chainPath'
  | 'firstArg'
  | 'literalArgs'
  | 'argExpressions'
  | 'resolveStatus'
  | 'confidence'
  | 'source'
>

export interface EntryPointLike {
  id: string
  repoId: string
  nodeId: string | null
  kind: string
  routePath?: string | null
}

export interface ModelLookup {
  modelName: string
  tableName: string
  orm: string
}

export interface WrapperSummary {
  nodeId: string
  kind: 'api_client' | 'db_client' | 'event_bus' | 'external_service'
  targetPackage?: string | null
  receiver?: string | null
}

export interface FieldOriginSummary {
  fieldName: string
  originKind: 'di' | 'constructor' | 'class_field' | 'alias' | 'unknown'
  typeName?: string | null
  packageName?: string | null
  evidenceNodeIds: string[]
}

// ── F1 입출력 ────────────────────────────────────────────

export interface RunBuildRelationsInput {
  repoId: string
  projectId?: string | null
  parentRunId?: string
  signal?: AbortSignal
  includeTestSources?: boolean
  db: DB
  repoPath?: string | null
}

export interface BuildRelationsInputs {
  repoId: string
  repoPath: string | null
  includeTestSources: boolean
  nodes: CodeNodeLike[]
  edges: CodeEdgeLike[]
  models: ModelLookup[]
  entryPoints?: EntryPointLike[]
  staticAnalysisPatternProfile?: StaticAnalysisPatternProfile | null
}

// ── F2 SemanticIndex ─────────────────────────────────────

export interface SemanticIndex {
  nodesById: Map<string, CodeNodeLike>
  nodesByFile: Map<string, CodeNodeLike[]>
  edgesBySource: Map<string, CodeEdgeLike[]>
  edgesByTarget: Map<string, CodeEdgeLike[]>
  containsParentByChild: Map<string, string>

  importsBySource: Map<string, CodeEdgeLike[]>
  callsBySource: Map<string, CodeEdgeLike[]>
  rendersBySource: Map<string, CodeEdgeLike[]>
  decoratorsBySource: Map<string, CodeEdgeLike[]>
  typeRefsBySource: Map<string, CodeEdgeLike[]>
  extendsBySource: Map<string, CodeEdgeLike[]>
  implementsBySource: Map<string, CodeEdgeLike[]>

  modelTablesByModelLower: Map<string, string>
  wrapperFunctions: Map<string, WrapperSummary>
  classFieldOrigins: Map<string, Map<string, FieldOriginSummary>>
}

// ── F3 RelationCandidate ─────────────────────────────────

export type RelationCandidateKind =
  | 'db_access'
  | 'api_call'
  | 'navigation'
  | 'event'
  | 'schedule_trigger'
  | 'external_link'
  | 'external_service'

export interface RelationCandidate {
  kind: RelationCandidateKind
  sourceNodeId: string
  evidenceNodeIds: string[]
  receiver?: string | null
  targetSymbol?: string | null
  chainPath?: string | null
  firstArg?: string | null
  argExpressions?: CallArgExpression[] | null
  rawTarget?: string | null
  framework?: string | null
  payload: Record<string, unknown>
}

// ── F4 ExtractedRelation ─────────────────────────────────

export interface ExtractedRelation {
  sourceNodeId: string
  kind: CodeRelationKind
  target: string | null
  operation: string | null
  canonicalTarget?: string | null
  payload: Record<string, unknown>
  evidenceNodeIds: string[]
  confidence: CodeRelationConfidence
  unresolvedReason?: string | null
}

export interface SourceFallback {
  resolveConstant(args: {
    filePath: string
    nodeId: string
    identifier: string
    allowedScopes: Array<'route' | 'api' | 'event' | 'external'>
  }): string | null
}

// ── F5 NormalizedCodeRelation ────────────────────────────

export interface NormalizedCodeRelation extends ExtractedRelation {
  canonicalTarget: string | null
  dedupeKey: string
}

// ── F6 BuildRelationsResult ──────────────────────────────

export interface BuildRelationsResult {
  relationsCount: number
  byKind: Record<string, number>
  telemetry?: Record<string, number>
}
