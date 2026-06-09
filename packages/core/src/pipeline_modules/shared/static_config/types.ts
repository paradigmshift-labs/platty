import type { CustomDecoratorMapping } from '@/pipeline_modules/build_route/types.js'

export type StaticAnalysisMode =
  | 'deterministic_only'
  | 'deterministic_with_pattern_profile'
  | 'llm_assisted'

export type ConfigValidity = 'fresh' | 'stale' | 'orphaned'

export type ConfigDiagnosticSeverity = 'info' | 'warning' | 'error'

export type ResolvedConfigSource =
  | 'default'
  | 'repository_metadata'
  | 'user'
  | 'approved'
  | 'fixture'
  | 'agent_candidate'

export type SourceAttributionClass =
  | 'adapter'
  | 'default_config'
  | 'repository_metadata'
  | 'user_config'
  | 'fixture_config'
  | 'source_fallback'
  | 'route_llm_fallback'
  | 'approved_config'
  | 'agent_search_proposal'

export interface ConfigDiagnostic {
  code: string
  severity: ConfigDiagnosticSeverity
  message: string
  path?: string
  source?: ResolvedConfigSource
}

export interface ConfigPatternEvidence {
  confidence: 'high' | 'medium' | 'low'
  source: 'deterministic' | 'llm_candidate' | 'manual'
  evidenceNodeIds: string[]
  filePaths: string[]
  builtFromCommit: string | null
  reason: string
}

export interface ConfigPatternInput {
  evidence?: never
}

export interface ConfiguredPattern {
  evidence: ConfigPatternEvidence
  configSource: ResolvedConfigSource
}

export interface ConfiguredCustomDecorator extends CustomDecoratorMapping, ConfiguredPattern {}

export interface CustomDecoratorInput extends ConfigPatternInput {
  resolvesTo?: string
  expands_to?: string[]
  source?: string
  file?: string
}

export interface ConfiguredRoutingFile extends ConfiguredPattern {
  path: string
  reason: string
}

export interface RoutingFileInput extends ConfigPatternInput {
  path: string
  reason?: string
}

export interface RouteConfigInput {
  customDecorators?: Record<string, CustomDecoratorInput>
  routingFiles?: RoutingFileInput[]
}

export interface RouteConfig {
  customDecorators: Record<string, ConfiguredCustomDecorator>
  routingFiles: ConfiguredRoutingFile[]
}

export interface DbClientInput extends ConfigPatternInput {
  receiver: string
  orm: string
  clientKind?: string
  ownerType?: string
  importSource?: string
}

export interface ConfiguredDbClient extends Omit<DbClientInput, 'evidence'>, ConfiguredPattern {}

export interface ApiClientInput extends ConfigPatternInput {
  receiver: string
  protocol: 'rest' | 'graphql' | 'trpc' | 'orpc'
  basePath?: string
  methods: Record<string, string>
}

export interface ConfiguredApiClient extends Omit<ApiClientInput, 'evidence'>, ConfiguredPattern {}

export interface FunctionWrapperInput extends ConfigPatternInput {
  functionName: string
  relationKind: 'api_call' | 'external_link'
  targetArgIndex: number
  methodArgIndex?: number
  defaultMethod?: string
  basePath?: string
}

export interface ConfiguredFunctionWrapper extends Omit<FunctionWrapperInput, 'evidence'>, ConfiguredPattern {}

export interface SdkAliasInput extends ConfigPatternInput {
  localName: string
  packageName: string
  service?: string
}

export interface ConfiguredSdkAlias extends Omit<SdkAliasInput, 'evidence'>, ConfiguredPattern {}

export interface RelationConfigInput {
  dbClients?: DbClientInput[]
  apiClients?: ApiClientInput[]
  functionWrappers?: FunctionWrapperInput[]
  sdkAliases?: SdkAliasInput[]
}

export interface RelationConfig {
  dbClients: ConfiguredDbClient[]
  apiClients: ConfiguredApiClient[]
  functionWrappers: ConfiguredFunctionWrapper[]
  sdkAliases: ConfiguredSdkAlias[]
}

export interface ApiBasePathInput extends ConfigPatternInput {
  repoId?: string
  basePath: string
}

export interface ConfiguredApiBasePath extends Omit<ApiBasePathInput, 'evidence'>, ConfiguredPattern {}

export interface GeneratedClientMappingInput extends ConfigPatternInput {
  clientFunction: string
  canonicalTarget: string
  sourceRepoAffinity?: string
}

export interface ConfiguredGeneratedClientMapping extends Omit<GeneratedClientMappingInput, 'evidence'>, ConfiguredPattern {}

export interface RepoAffinityInput extends ConfigPatternInput {
  sourcePattern: string
  targetRepoId: string
  targetPathPrefix?: string
}

export interface ConfiguredRepoAffinity extends Omit<RepoAffinityInput, 'evidence'>, ConfiguredPattern {}

export interface ServiceMapConfigInput {
  apiBasePaths?: ApiBasePathInput[]
  generatedClientMappings?: GeneratedClientMappingInput[]
  repoAffinity?: RepoAffinityInput[]
}

export interface ServiceMapConfig {
  apiBasePaths: ConfiguredApiBasePath[]
  generatedClientMappings: ConfiguredGeneratedClientMapping[]
  repoAffinity: ConfiguredRepoAffinity[]
}

export type StaticAnalysisPatternRuleState = 'active' | 'candidate' | 'disabled'

export type StaticAnalysisPatternRuleTarget =
  | 'route.entrypoint'
  | 'relation.db_access'
  | 'relation.api_call'
  | 'relation.navigation'
  | 'relation.external_link'
  | 'relation.event'
  | 'relation.schedule_trigger'
  | 'service_map.hint'

export interface StaticAnalysisPatternRuleMatch {
  relation: string
  targetSymbolIn?: string[]
  chainPathEquals?: string
  chainPathPrefix?: string
  chainPathPattern?: string
  importsContain?: { packageName: string }
  decoratorName?: string
  literalArgKey?: string
  fileGlob?: string
}

export type StaticAnalysisPatternValueSource =
  | 'firstArg'
  | 'targetSymbol'
  | `literalArg:${string}`
  | `chainPathSegment:${string}`
  | `chainPathCallArg:${string}`

export interface StaticAnalysisPatternRuleEmit {
  targetFrom: StaticAnalysisPatternValueSource
  operationFrom?: StaticAnalysisPatternValueSource
  operationValue?: string
}

export interface StaticAnalysisPatternRule {
  id: string
  state: StaticAnalysisPatternRuleState
  source: ResolvedConfigSource
  target: StaticAnalysisPatternRuleTarget
  match: StaticAnalysisPatternRuleMatch
  emit: StaticAnalysisPatternRuleEmit
}

export interface CandidateRuleSupport {
  count: number
  sampleEdgeIds: number[]
  sampleNodeIds: string[]
  filePaths: string[]
}

export interface CandidateRuleEntry {
  rule: StaticAnalysisPatternRule
  support: CandidateRuleSupport
  confidence: 'high' | 'medium' | 'low'
  rationale: string
  discoveredFromCommit: string | null
  discoveredFromGraphSchemaVersion: string
  status: 'candidate' | 'approved' | 'rejected' | 'stale'
  rejectionCode?: string
}

export interface StaticAnalysisPatternProfileInput {
  version: 1
  language?: string
  frameworks?: string[]
  rules?: StaticAnalysisPatternRule[]
  routePatterns?: Partial<RouteConfigInput>
  relationPatterns?: Partial<RelationConfigInput>
  serviceMapHints?: Partial<ServiceMapConfigInput>
}

export interface CandidateStaticAnalysisPatternProfile {
  source: 'agent' | 'llm' | 'diagnostic'
  proposedAt: string
  rules?: StaticAnalysisPatternRule[]
  ruleEntries?: CandidateRuleEntry[]
  routePatterns?: Partial<RouteConfigInput>
  relationPatterns?: Partial<RelationConfigInput>
  serviceMapHints?: Partial<ServiceMapConfigInput>
  reason: string
  status: 'candidate_only' | 'approved' | 'rejected'
}

export interface StaticAnalysisPatternProfile {
  version: 1
  generatedAt: string
  builtFromCommit: string | null
  validity: ConfigValidity
  graphSchemaVersion: string
  analysisMode: StaticAnalysisMode
  language: string
  frameworks: string[]
  sources: {
    defaultConfigVersion: string
    userCustomConfigVersion?: string
    approvedConfigVersion?: string
  }
  routePatterns: RouteConfig
  relationPatterns: RelationConfig
  serviceMapHints: ServiceMapConfig
  rules: StaticAnalysisPatternRule[]
  candidateConfig?: CandidateStaticAnalysisPatternProfile
  diagnostics: ConfigDiagnostic[]
}

export interface GraphEvidenceSummary {
  nodeIds: string[]
  edgeIds: string[]
  filePaths: string[]
}
