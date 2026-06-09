import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { repositoryStaticAnalysisConfigs } from '@/db/schema/static_analysis_configs.js'
import type {
  ApiBasePathInput,
  ApiClientInput,
  CandidateStaticAnalysisPatternProfile,
  ConfigDiagnostic,
  ConfigPatternEvidence,
  CustomDecoratorInput,
  ConfiguredApiBasePath,
  ConfiguredApiClient,
  ConfiguredCustomDecorator,
  ConfiguredDbClient,
  ConfiguredFunctionWrapper,
  ConfiguredGeneratedClientMapping,
  ConfiguredRepoAffinity,
  ConfiguredRoutingFile,
  ConfiguredSdkAlias,
  DbClientInput,
  FunctionWrapperInput,
  GeneratedClientMappingInput,
  GraphEvidenceSummary,
  RelationConfig,
  RelationConfigInput,
  RepoAffinityInput,
  StaticAnalysisPatternProfile,
  StaticAnalysisPatternProfileInput,
  ResolvedConfigSource,
  RouteConfig,
  RouteConfigInput,
  RoutingFileInput,
  SdkAliasInput,
  ServiceMapConfig,
  ServiceMapConfigInput,
  StaticAnalysisPatternRule,
  StaticAnalysisMode,
} from './types.js'
import { defaultStaticAnalysisPatternProfile } from './default_rules.js'

export type * from './types.js'
export * from './source_attribution.js'

export const DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION = 'static-config-graph-v1'
export const STATIC_ANALYSIS_PATTERN_PROFILE_PHASE = 'build_pattern_profile'
const DEFAULT_CONFIG_VERSION = 'default-static-config-v1'
const APPROVED_CONFIG_META_KEY = 'staticAnalysisApprovedConfig'

export interface StoredApprovedStaticAnalysisConfig {
  version: number
  rules: StaticAnalysisPatternRule[]
  updatedAt: string
}

const KNOWN_DB_CLIENT_FAMILIES = new Set([
  'prisma',
  'typeorm',
  'kysely',
  'drizzle',
  'mongoose',
  'supabase',
  'sqlalchemy',
  'django_orm',
  'spring_data',
  'drift',
  'sqflite',
  'redis',
])

const KNOWN_CLIENT_KINDS = new Set([
  'orm',
  'db_client',
  'baas_client',
  'sql_client',
  'document_db',
])

export interface ComposeStaticAnalysisPatternProfileInput {
  repoId: string
  builtFromCommit: string | null
  language?: string | null
  frameworks?: string[] | null
  mode?: StaticAnalysisMode
  defaultConfig?: StaticAnalysisPatternProfileInput
  repositoryConfig?: StaticAnalysisPatternProfileInput
  userConfig?: StaticAnalysisPatternProfileInput
  userConfigVersion?: string
  approvedConfig?: StaticAnalysisPatternProfileInput
  approvedConfigVersion?: string
  fixtureConfig?: StaticAnalysisPatternProfileInput
  candidateConfig?: CandidateStaticAnalysisPatternProfile
  graphEvidence?: Partial<GraphEvidenceSummary>
  graphSchemaVersion?: string
  generatedAt?: string
}

export class StaticAnalysisUserConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StaticAnalysisUserConfigError'
  }
}

export function composeStaticAnalysisPatternProfile(
  input: ComposeStaticAnalysisPatternProfileInput,
): StaticAnalysisPatternProfile {
  const diagnostics: ConfigDiagnostic[] = []
  const evidence = normalizeEvidence(input.graphEvidence, input.builtFromCommit)
  const mode = input.mode ?? 'deterministic_with_pattern_profile'
  const routeConfig = emptyRouteConfig()
  const relationConfig = emptyRelationConfig()
  const serviceMapConfig = emptyServiceMapConfig()
  const rules: StaticAnalysisPatternRule[] = []

  const layers: Array<{ source: ResolvedConfigSource; config?: StaticAnalysisPatternProfileInput }> = [
    { source: 'default', config: input.defaultConfig },
    { source: 'repository_metadata', config: input.repositoryConfig },
  ]
  if (mode === 'deterministic_only') {
    if (input.userConfig || input.approvedConfig || input.fixtureConfig) {
      diagnostics.push({
        code: 'custom_config_disabled',
        severity: 'info',
        message: 'Custom static analysis config is ignored in deterministic_only mode.',
      })
    }
  } else {
    layers.push(
      { source: 'user', config: input.userConfig },
      { source: 'approved', config: input.approvedConfig },
      { source: 'fixture', config: input.fixtureConfig },
    )
  }

  for (const layer of layers) {
    if (!layer.config) continue
    for (const rule of layer.config.rules ?? []) {
      if (rule.source === 'agent_candidate') {
        diagnostics.push({
          code: 'agent_candidate_promotion_blocked',
          severity: 'warning',
          message: `Agent candidate rule '${rule.id}' was kept out of active static analysis config.`,
          path: `rules.${rule.id}`,
          source: 'agent_candidate',
        })
        continue
      }
      if (rule.state === 'active') rules.push({ ...rule, source: layer.source })
    }
    mergeRouteLayer(routeConfig, layer.config.routePatterns, layer.source, evidence, diagnostics)
    mergeRelationLayer(relationConfig, layer.config.relationPatterns, layer.source, evidence, diagnostics)
    mergeServiceMapLayer(serviceMapConfig, layer.config.serviceMapHints, layer.source, evidence, diagnostics)
  }

  const candidateConfig = normalizeCandidateConfig(input.candidateConfig)
    ?? collectAgentCandidateRules(input)

  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    builtFromCommit: input.builtFromCommit,
    validity: 'fresh',
    graphSchemaVersion: input.graphSchemaVersion ?? DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION,
    analysisMode: mode,
    language: input.language
      ?? input.repositoryConfig?.language
      ?? input.userConfig?.language
      ?? input.defaultConfig?.language
      ?? 'unknown',
    frameworks: uniqueStrings([
      ...(input.frameworks ?? []),
      ...(input.defaultConfig?.frameworks ?? []),
      ...(input.repositoryConfig?.frameworks ?? []),
      ...(input.userConfig?.frameworks ?? []),
      ...(input.approvedConfig?.frameworks ?? []),
      ...(input.fixtureConfig?.frameworks ?? []),
    ]),
    sources: {
      defaultConfigVersion: DEFAULT_CONFIG_VERSION,
      ...(input.userConfigVersion ? { userCustomConfigVersion: input.userConfigVersion } : {}),
      ...(input.approvedConfigVersion ? { approvedConfigVersion: input.approvedConfigVersion } : {}),
    },
    routePatterns: routeConfig,
    relationPatterns: relationConfig,
    serviceMapHints: serviceMapConfig,
    rules,
    ...(candidateConfig ? { candidateConfig } : {}),
    diagnostics,
  }
}

export function mergeCustomDecorators(
  repositoryDecorators: Record<string, ConfiguredCustomDecorator>,
  customDecorators: Record<string, ConfiguredCustomDecorator>,
  consumedSources?: ResolvedConfigSource[],
): { customDecorators: Record<string, ConfiguredCustomDecorator>; diagnostics: ConfigDiagnostic[] } {
  const diagnostics: ConfigDiagnostic[] = []
  const merged: Record<string, ConfiguredCustomDecorator> = { ...repositoryDecorators }
  for (const decorator of Object.values(repositoryDecorators)) {
    consumedSources?.push(decorator.configSource)
  }

  for (const [name, decorator] of Object.entries(customDecorators)) {
    consumedSources?.push(decorator.configSource)
    const existing = merged[name]
    if (!existing) {
      merged[name] = decorator
      continue
    }
    if (existing.resolvesTo === decorator.resolvesTo) {
      merged[name] = {
        ...existing,
        evidence: mergeEvidence(existing.evidence, decorator.evidence),
      }
      continue
    }
    diagnostics.push({
      code: 'custom_decorator_conflict',
      severity: 'warning',
      message: `Custom decorator '${name}' conflicts with repository metadata and was ignored.`,
      path: `routePatterns.customDecorators.${name}`,
      source: decorator.configSource,
    })
  }

  return { customDecorators: merged, diagnostics }
}

export function mergeRoutingFiles(
  repositoryRoutingFiles: string[],
  configRoutingFiles: Array<RoutingFileInput | ConfiguredRoutingFile>,
): { routingFiles: string[]; diagnostics: ConfigDiagnostic[] } {
  const diagnostics: ConfigDiagnostic[] = []
  const files = new Set(repositoryRoutingFiles.filter(Boolean))

  for (const item of configRoutingFiles) {
    const path = item.path?.trim()
    if (!isSafeRepoRelativePath(path)) {
      diagnostics.push({
        code: 'invalid_routing_file',
        severity: 'warning',
        message: `Routing file '${item.path}' is not a safe repository-relative path.`,
        path: 'routePatterns.routingFiles',
      })
      continue
    }
    files.add(path)
  }
  return { routingFiles: [...files], diagnostics }
}

export function normalizeRepositoryCustomDecorators(
  raw: unknown,
  evidence: ConfigPatternEvidence,
): Record<string, ConfiguredCustomDecorator> {
  const result: Record<string, ConfiguredCustomDecorator> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [name, mapping] of Object.entries(raw)) {
    const normalized = normalizeDecoratorInput(mapping as unknown as CustomDecoratorInput)
    if (!normalized) continue
    result[name] = {
      ...normalized,
      evidence,
      configSource: 'repository_metadata',
    }
  }
  return result
}

export function loadFreshStaticAnalysisPatternProfile(args: {
  db: DB
  repoId: string
  currentCommit?: string | null
  graphSchemaVersion?: string
}): StaticAnalysisPatternProfile | null {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
  )).get()
  if (!row || row.validity !== 'fresh') return null
  const config = asStaticAnalysisPatternProfile(asRecord(row.meta)?.staticAnalysisPatternProfile)
  if (!config || config.validity !== 'fresh') return null
  if ((args.graphSchemaVersion ?? DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION) !== config.graphSchemaVersion) return null
  const expectedCommit = args.currentCommit ?? row.builtFromCommit ?? null
  if (config.builtFromCommit !== expectedCommit) return null
  return config
}

export function saveStaticAnalysisPatternProfile(args: {
  db: DB
  repoId: string
  config: StaticAnalysisPatternProfile
}): void {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
  )).get()
  const now = new Date().toISOString()
  const meta = {
    ...(asRecord(row?.meta) ?? {}),
    staticAnalysisPatternProfile: args.config,
  }
  if (row) {
    args.db.update(repositoryPhaseStatus)
      .set({ meta, updatedAt: now })
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, args.repoId),
        eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
      ))
      .run()
    return
  }
  args.db.insert(repositoryPhaseStatus).values({
    repositoryId: args.repoId,
    phase: STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
    builtAt: now,
    builtFromCommit: args.config.builtFromCommit,
    validity: 'fresh',
    meta,
    updatedAt: now,
  }).run()
}

export function composeAndSaveStaticAnalysisPatternProfile(args: {
  db: DB
  repoId: string
  mode?: StaticAnalysisMode
}): StaticAnalysisPatternProfile | null {
  const repo = args.db.select().from(repositories).where(eq(repositories.id, args.repoId)).get()
  if (!repo) return null
  const graphPhase = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, 'build_graph'),
  )).get()
  if (!graphPhase || graphPhase.validity !== 'fresh') return null
  const existingProfile = asStaticAnalysisPatternProfile(asRecord(graphPhase.meta)?.staticAnalysisPatternProfile)
    ?? loadFreshStaticAnalysisPatternProfile({ db: args.db, repoId: args.repoId, currentCommit: graphPhase.builtFromCommit ?? null })

  const nodeRows = args.db.select({
    id: codeNodes.id,
    filePath: codeNodes.filePath,
  }).from(codeNodes).where(eq(codeNodes.repoId, args.repoId)).all()
  const edgeRows = args.db.select({
    id: codeEdges.id,
    relation: codeEdges.relation,
    targetSpecifier: codeEdges.targetSpecifier,
  }).from(codeEdges).where(eq(codeEdges.repoId, args.repoId)).all()
  const userConfig = loadActiveRepositoryStaticAnalysisUserConfig({
    db: args.db,
    repoId: args.repoId,
  })
  const approvedConfig = loadApprovedStaticAnalysisRules({ db: args.db, repoId: args.repoId })

  const config = composeStaticAnalysisPatternProfile({
    repoId: args.repoId,
    builtFromCommit: graphPhase.builtFromCommit ?? null,
    language: repo.language,
    frameworks: repo.framework ? [repo.framework] : [],
    mode: args.mode,
    defaultConfig: defaultStaticAnalysisPatternProfile({
      language: repo.language,
      frameworks: repo.framework ? [repo.framework] : [],
      packages: collectImportedPackageSpecifiers(edgeRows),
    }),
    repositoryConfig: {
      version: 1,
      language: repo.language ?? undefined,
      frameworks: repo.framework ? [repo.framework] : undefined,
      routePatterns: {
        customDecorators: repo.customDecorators as RouteConfigInput['customDecorators'],
        routingFiles: (repo.routingFiles ?? []).map((path) => ({ path, reason: 'repository metadata' })),
      },
      serviceMapHints: {
        apiBasePaths: (repo.apiBasePaths ?? []).map((basePath) => ({ basePath })),
      },
    },
    userConfig: userConfig?.config,
    userConfigVersion: userConfig?.version,
    approvedConfig: approvedConfig
      ? { version: 1, rules: approvedConfig.rules }
      : undefined,
    approvedConfigVersion: approvedConfig ? String(approvedConfig.version) : undefined,
    graphEvidence: {
      nodeIds: nodeRows.slice(0, 50).map((node) => `node:${node.id}`),
      edgeIds: edgeRows.slice(0, 50).map((edge) => `edge:${edge.id}`),
      filePaths: uniqueStrings(nodeRows.map((node) => node.filePath).filter(Boolean)),
    },
    candidateConfig: existingProfile?.candidateConfig,
  })
  saveStaticAnalysisPatternProfile({ db: args.db, repoId: args.repoId, config })
  return config
}

function collectImportedPackageSpecifiers(
  rows: Array<{ relation: string; targetSpecifier: string | null }>,
): string[] {
  return uniqueStrings(rows
    .filter((row) => row.relation === 'imports')
    .map((row) => row.targetSpecifier)
    .filter((specifier): specifier is string => typeof specifier === 'string' && specifier.length > 0))
}

export function loadActiveRepositoryStaticAnalysisUserConfig(args: {
  db: DB
  repoId: string
}): { config: StaticAnalysisPatternProfileInput; version: string } | null {
  const row = args.db.select()
    .from(repositoryStaticAnalysisConfigs)
    .where(and(
      eq(repositoryStaticAnalysisConfigs.repositoryId, args.repoId),
      eq(repositoryStaticAnalysisConfigs.status, 'active'),
    ))
    .get()
  if (!row) return null
  if (row.schemaVersion !== 1) {
    throw new StaticAnalysisUserConfigError(
      `Unsupported static analysis config schema version ${row.schemaVersion} for repository '${args.repoId}'.`,
    )
  }
  return {
    config: validateStaticAnalysisUserConfig(row.configJson, args.repoId),
    version: String(row.version),
  }
}

/**
 * Persist auto-promoted approved DSL rules for a repository.
 *
 * Approved rules are the active rule layer produced by the DSL discovery loop.
 * They live in the same `repository_phase_status` row that already holds the
 * composed pattern profile (`build_pattern_profile` phase, `meta` JSON), under a
 * dedicated key — no new table/column, so this needs no schema change and the
 * row survives a profile rebuild. The full approved-rule set is replaced on each
 * call (callers pass the merged set) and the version bumps when the set changes.
 */
export function saveApprovedStaticAnalysisRules(args: {
  db: DB
  repoId: string
  rules: StaticAnalysisPatternRule[]
}): StoredApprovedStaticAnalysisConfig {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
  )).get()
  const existing = loadApprovedStaticAnalysisRules({ db: args.db, repoId: args.repoId })
  const rules = dedupeApprovedRules(args.rules)
  const changed = !approvedRulesEqual(existing?.rules ?? [], rules)
  const now = new Date().toISOString()
  const stored: StoredApprovedStaticAnalysisConfig = {
    version: changed ? (existing?.version ?? 0) + 1 : existing?.version ?? 1,
    rules,
    updatedAt: now,
  }
  const meta = {
    ...(asRecord(row?.meta) ?? {}),
    [APPROVED_CONFIG_META_KEY]: stored,
  }
  if (row) {
    args.db.update(repositoryPhaseStatus)
      .set({ meta, updatedAt: now })
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, args.repoId),
        eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
      ))
      .run()
    return stored
  }
  args.db.insert(repositoryPhaseStatus).values({
    repositoryId: args.repoId,
    phase: STATIC_ANALYSIS_PATTERN_PROFILE_PHASE,
    validity: 'fresh',
    meta,
    updatedAt: now,
  }).run()
  return stored
}

export function loadApprovedStaticAnalysisRules(args: {
  db: DB
  repoId: string
}): StoredApprovedStaticAnalysisConfig | null {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, STATIC_ANALYSIS_PATTERN_PROFILE_PHASE),
  )).get()
  const stored = asRecord(asRecord(row?.meta)?.[APPROVED_CONFIG_META_KEY])
  if (!stored || !Array.isArray(stored.rules)) return null
  const rules = (stored.rules as StaticAnalysisPatternRule[]).filter((rule) => rule && typeof rule.id === 'string')
  if (rules.length === 0) return null
  return {
    version: typeof stored.version === 'number' ? stored.version : 1,
    rules,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
  }
}

function dedupeApprovedRules(rules: StaticAnalysisPatternRule[]): StaticAnalysisPatternRule[] {
  const byId = new Map<string, StaticAnalysisPatternRule>()
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string') continue
    byId.set(rule.id, { ...rule, state: 'active', source: 'approved' })
  }
  return [...byId.values()]
}

function approvedRulesEqual(left: StaticAnalysisPatternRule[], right: StaticAnalysisPatternRule[]): boolean {
  if (left.length !== right.length) return false
  const sort = (rules: StaticAnalysisPatternRule[]) =>
    [...rules].sort((a, b) => a.id.localeCompare(b.id)).map((rule) => JSON.stringify(rule))
  const leftSorted = sort(left)
  const rightSorted = sort(right)
  return leftSorted.every((value, index) => value === rightSorted[index])
}

export function createTestOnlyProfileWithCandidateRules(
  profile: StaticAnalysisPatternProfile,
): StaticAnalysisPatternProfile {
  const candidateRules = [
    ...(profile.candidateConfig?.rules ?? []),
    ...(profile.candidateConfig?.ruleEntries ?? []).map((entry) => entry.rule),
  ]
  const uniqueCandidateRules = new Map<string, StaticAnalysisPatternRule>()
  for (const rule of candidateRules) {
    if (rule.state !== 'candidate' || rule.source !== 'agent_candidate') continue
    uniqueCandidateRules.set(rule.id, {
      ...rule,
      state: 'active',
      source: 'fixture',
    })
  }
  return {
    ...profile,
    rules: [
      ...profile.rules,
      ...uniqueCandidateRules.values(),
    ],
    diagnostics: [
      ...profile.diagnostics,
      {
        code: 'test_only_candidate_promotion',
        severity: 'info',
        message: 'Agent candidate DSL rules were promoted in-memory for fixture downstream verification only.',
        source: 'fixture',
      },
    ],
  }
}

function mergeRouteLayer(
  target: RouteConfig,
  input: Partial<RouteConfigInput> | undefined,
  source: ResolvedConfigSource,
  evidence: ConfigPatternEvidence,
  diagnostics: ConfigDiagnostic[],
): void {
  for (const [name, raw] of Object.entries(input?.customDecorators ?? {})) {
    const normalized = normalizeDecoratorInput(raw)
    if (!normalized) continue
    const decorator: ConfiguredCustomDecorator = { ...normalized, evidence, configSource: source }
    const merged = mergeCustomDecorators(target.customDecorators, { [name]: decorator })
    Object.assign(target.customDecorators, merged.customDecorators)
    diagnostics.push(...merged.diagnostics)
  }
  for (const item of input?.routingFiles ?? []) {
    const merged = mergeRoutingFiles(target.routingFiles.map((file) => file.path), [item])
    diagnostics.push(...merged.diagnostics)
    target.routingFiles = merged.routingFiles.map((path) => {
      const existing = target.routingFiles.find((file) => file.path === path)
      return existing ?? { path, reason: item.reason ?? 'configured routing file', evidence, configSource: source }
    })
  }
}

function mergeRelationLayer(
  target: RelationConfig,
  input: Partial<RelationConfigInput> | undefined,
  source: ResolvedConfigSource,
  evidence: ConfigPatternEvidence,
  diagnostics: ConfigDiagnostic[],
): void {
  for (const item of input?.dbClients ?? []) {
    if (!isKnownOrCustomFamily(item.orm) || (item.clientKind && !isKnownOrCustomClientKind(item.clientKind))) {
      diagnostics.push({
        code: 'unknown_db_client_family',
        severity: 'warning',
        message: `DB client family '${item.orm}' is not known. Use custom:<id> or add a validator rule before active consumption.`,
        path: 'relationPatterns.dbClients',
        source,
      })
      continue
    }
    target.dbClients.push({ ...item, evidence, configSource: source })
  }
  for (const item of input?.apiClients ?? []) {
    if (!item.receiver || Object.keys(item.methods ?? {}).length === 0) continue
    target.apiClients.push({ ...item, evidence, configSource: source })
  }
  for (const item of input?.functionWrappers ?? []) {
    target.functionWrappers.push({ ...item, evidence, configSource: source })
  }
  for (const item of input?.sdkAliases ?? []) {
    target.sdkAliases.push({ ...item, evidence, configSource: source })
  }
}

function mergeServiceMapLayer(
  target: ServiceMapConfig,
  input: Partial<ServiceMapConfigInput> | undefined,
  source: ResolvedConfigSource,
  evidence: ConfigPatternEvidence,
  diagnostics: ConfigDiagnostic[],
): void {
  for (const item of input?.apiBasePaths ?? []) {
    const normalized = normalizeApiBasePath(item, evidence, source, diagnostics)
    if (normalized) target.apiBasePaths.push(normalized)
  }
  target.generatedClientMappings.push(...(input?.generatedClientMappings ?? []).map((item) => ({
    ...item,
    evidence,
    configSource: source,
  } satisfies ConfiguredGeneratedClientMapping)))
  target.repoAffinity.push(...(input?.repoAffinity ?? []).map((item) => ({
    ...item,
    evidence,
    configSource: source,
  } satisfies ConfiguredRepoAffinity)))
}

function normalizeDecoratorInput(raw: CustomDecoratorInputLike | null | undefined): Pick<ConfiguredCustomDecorator, 'resolvesTo' | 'source'> | null {
  if (!raw || typeof raw !== 'object') return null
  const resolvesTo = typeof raw.resolvesTo === 'string'
    ? raw.resolvesTo
    : Array.isArray(raw.expands_to) && typeof raw.expands_to[0] === 'string'
      ? raw.expands_to[0]
      : null
  if (!resolvesTo) return null
  const source = typeof raw.source === 'string'
    ? raw.source
    : typeof raw.file === 'string'
      ? raw.file
      : 'configured'
  return { resolvesTo, source }
}

type CustomDecoratorInputLike = CustomDecoratorInput | {
  resolvesTo?: unknown
  expands_to?: unknown
  source?: unknown
  file?: unknown
}

function normalizeApiBasePath(
  input: ApiBasePathInput,
  evidence: ConfigPatternEvidence,
  source: ResolvedConfigSource,
  diagnostics: ConfigDiagnostic[],
): ConfiguredApiBasePath | null {
  const basePath = input.basePath.trim()
  if (!basePath.startsWith('/')) {
    diagnostics.push({
      code: 'invalid_api_base_path',
      severity: 'warning',
      message: `API base path '${input.basePath}' must start with '/'.`,
      path: 'serviceMapHints.apiBasePaths',
      source,
    })
    return null
  }
  return { ...input, basePath, evidence, configSource: source }
}

function emptyRouteConfig(): RouteConfig {
  return { customDecorators: {}, routingFiles: [] }
}

function emptyRelationConfig(): RelationConfig {
  return { dbClients: [], apiClients: [], functionWrappers: [], sdkAliases: [] }
}

function emptyServiceMapConfig(): ServiceMapConfig {
  return { apiBasePaths: [], generatedClientMappings: [], repoAffinity: [] }
}

function normalizeEvidence(
  input: Partial<GraphEvidenceSummary> | undefined,
  builtFromCommit: string | null,
): ConfigPatternEvidence {
  return {
    confidence: 'high',
    source: 'manual',
    evidenceNodeIds: [
      ...(input?.edgeIds ?? []),
      ...(input?.nodeIds ?? []),
    ],
    filePaths: uniqueStrings(input?.filePaths ?? []),
    builtFromCommit,
    reason: 'Static analysis config validated against graph evidence.',
  }
}

function normalizeCandidateConfig(
  candidate: CandidateStaticAnalysisPatternProfile | undefined,
): CandidateStaticAnalysisPatternProfile | undefined {
  if (!candidate) return undefined
  const hasAgentAuthoredRules = [
    ...(candidate.rules ?? []),
    ...(candidate.ruleEntries ?? []).map((entry) => entry.rule),
  ].some((rule) => rule.source === 'agent_candidate')
  return {
    ...candidate,
    rules: candidate.rules?.map((rule) => ({
      ...rule,
      state: 'candidate',
      source: 'agent_candidate',
    })),
    ruleEntries: candidate.ruleEntries?.map((entry) => ({
      ...entry,
      rule: {
        ...entry.rule,
        state: 'candidate',
        source: 'agent_candidate',
      },
      status: entry.status === 'approved' ? 'candidate' : entry.status,
    })),
    status: candidate.status === 'approved' && hasAgentAuthoredRules
      ? 'candidate_only'
      : candidate.status,
    routePatterns: candidate.routePatterns,
    relationPatterns: candidate.relationPatterns,
    serviceMapHints: candidate.serviceMapHints,
  }
}

function collectAgentCandidateRules(
  input: ComposeStaticAnalysisPatternProfileInput,
): CandidateStaticAnalysisPatternProfile | undefined {
  const rules = [
    ...(input.defaultConfig?.rules ?? []),
    ...(input.repositoryConfig?.rules ?? []),
    ...(input.userConfig?.rules ?? []),
    ...(input.approvedConfig?.rules ?? []),
    ...(input.fixtureConfig?.rules ?? []),
  ].filter((rule) => rule.source === 'agent_candidate')

  if (rules.length === 0) return undefined

  return {
    source: 'agent',
    proposedAt: input.generatedAt ?? new Date().toISOString(),
    reason: 'Agent candidate rules are stored as candidate-only metadata until approval.',
    status: 'candidate_only',
    rules: rules.map((rule) => ({
      ...rule,
      state: 'candidate',
      source: 'agent_candidate',
    })),
    ruleEntries: rules.map((rule) => ({
      rule: {
        ...rule,
        state: 'candidate',
        source: 'agent_candidate',
      },
      support: {
        count: 0,
        sampleEdgeIds: [],
        sampleNodeIds: [],
        filePaths: [],
      },
      confidence: 'low',
      rationale: 'Agent candidate rule was supplied through config input and forced to candidate-only metadata.',
      discoveredFromCommit: input.builtFromCommit,
      discoveredFromGraphSchemaVersion: input.graphSchemaVersion ?? DEFAULT_STATIC_CONFIG_GRAPH_SCHEMA_VERSION,
      status: 'candidate',
    })),
  }
}

function mergeEvidence(left: ConfigPatternEvidence, right: ConfigPatternEvidence): ConfigPatternEvidence {
  return {
    ...left,
    evidenceNodeIds: uniqueStrings([...left.evidenceNodeIds, ...right.evidenceNodeIds]),
    filePaths: uniqueStrings([...left.filePaths, ...right.filePaths]),
    reason: `${left.reason}; ${right.reason}`,
  }
}

function isKnownOrCustomFamily(value: string): boolean {
  return KNOWN_DB_CLIENT_FAMILIES.has(value) || value.startsWith('custom:')
}

function isKnownOrCustomClientKind(value: string): boolean {
  return KNOWN_CLIENT_KINDS.has(value) || value.startsWith('custom:')
}

function isSafeRepoRelativePath(value: string | undefined): value is string {
  if (!value) return false
  return !value.startsWith('/') &&
    !value.split(/[\\/]+/).includes('..') &&
    !/^[A-Za-z]:/.test(value)
}

function validateStaticAnalysisUserConfig(
  value: unknown,
  repoId: string,
): StaticAnalysisPatternProfileInput {
  const config = asRecord(value)
  if (!config || config.version !== 1) {
    throw new StaticAnalysisUserConfigError(
      `Invalid static analysis user config for repository '${repoId}': version must be 1.`,
    )
  }
  if (config.language !== undefined && typeof config.language !== 'string') {
    throw invalidUserConfig(repoId, 'language must be a string when present')
  }
  if (config.frameworks !== undefined && !isStringArray(config.frameworks)) {
    throw invalidUserConfig(repoId, 'frameworks must be a string array when present')
  }
  if (config.rules !== undefined && !Array.isArray(config.rules)) {
    throw invalidUserConfig(repoId, 'rules must be an array when present')
  }
  validateUserRules(config.rules, repoId)
  if (config.routePatterns !== undefined && !asRecord(config.routePatterns)) {
    throw invalidUserConfig(repoId, 'routePatterns must be an object when present')
  }
  validateUserRoutePatterns(config.routePatterns, repoId)
  if (config.relationPatterns !== undefined && !asRecord(config.relationPatterns)) {
    throw invalidUserConfig(repoId, 'relationPatterns must be an object when present')
  }
  validateUserRelationPatterns(config.relationPatterns, repoId)
  if (config.serviceMapHints !== undefined && !asRecord(config.serviceMapHints)) {
    throw invalidUserConfig(repoId, 'serviceMapHints must be an object when present')
  }
  validateUserServiceMapHints(config.serviceMapHints, repoId)
  return config as unknown as StaticAnalysisPatternProfileInput
}

function validateUserRules(value: unknown, repoId: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw invalidUserConfig(repoId, 'rules must be an array when present')
  for (const [index, rawRule] of value.entries()) {
    const rule = asRecord(rawRule)
    if (!rule) throw invalidUserConfig(repoId, `rules[${index}] must be an object`)
    if (typeof rule.id !== 'string' || !rule.id) throw invalidUserConfig(repoId, `rules[${index}].id must be a string`)
    if (rule.state !== 'active' && rule.state !== 'candidate' && rule.state !== 'disabled') {
      throw invalidUserConfig(repoId, `rules[${index}].state is invalid`)
    }
    if (typeof rule.source !== 'string') throw invalidUserConfig(repoId, `rules[${index}].source must be a string`)
    if (typeof rule.target !== 'string') throw invalidUserConfig(repoId, `rules[${index}].target must be a string`)
    if (!asRecord(rule.match)) throw invalidUserConfig(repoId, `rules[${index}].match must be an object`)
    if (!asRecord(rule.emit)) throw invalidUserConfig(repoId, `rules[${index}].emit must be an object`)
  }
}

function validateUserRoutePatterns(value: unknown, repoId: string): void {
  if (value === undefined) return
  const routePatterns = asRecord(value)
  if (!routePatterns) throw invalidUserConfig(repoId, 'routePatterns must be an object when present')
  const customDecorators = routePatterns.customDecorators
  if (customDecorators !== undefined) {
    const decorators = asRecord(customDecorators)
    if (!decorators) throw invalidUserConfig(repoId, 'routePatterns.customDecorators must be an object')
    for (const [name, rawDecorator] of Object.entries(decorators)) {
      const decorator = asRecord(rawDecorator)
      if (!decorator) throw invalidUserConfig(repoId, `routePatterns.customDecorators.${name} must be an object`)
      const hasResolvesTo = typeof decorator.resolvesTo === 'string'
      const hasExpandsTo = isStringArray(decorator.expands_to)
      if (!hasResolvesTo && !hasExpandsTo) {
        throw invalidUserConfig(repoId, `routePatterns.customDecorators.${name} must define resolvesTo or expands_to`)
      }
    }
  }
  const routingFiles = routePatterns.routingFiles
  if (routingFiles !== undefined) {
    if (!Array.isArray(routingFiles)) throw invalidUserConfig(repoId, 'routePatterns.routingFiles must be an array')
    for (const [index, rawFile] of routingFiles.entries()) {
      const file = asRecord(rawFile)
      if (!file || typeof file.path !== 'string') {
        throw invalidUserConfig(repoId, `routePatterns.routingFiles[${index}].path must be a string`)
      }
    }
  }
}

function validateUserRelationPatterns(value: unknown, repoId: string): void {
  if (value === undefined) return
  const relationPatterns = asRecord(value)
  if (!relationPatterns) throw invalidUserConfig(repoId, 'relationPatterns must be an object when present')
  validateUserDbClients(relationPatterns.dbClients, repoId)
  validateUserApiClients(relationPatterns.apiClients, repoId)
  validateUserFunctionWrappers(relationPatterns.functionWrappers, repoId)
  validateUserSdkAliases(relationPatterns.sdkAliases, repoId)
}

function validateUserDbClients(value: unknown, repoId: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw invalidUserConfig(repoId, 'relationPatterns.dbClients must be an array')
  for (const [index, rawClient] of value.entries()) {
    const client = asRecord(rawClient)
    if (!client) throw invalidUserConfig(repoId, `relationPatterns.dbClients[${index}] must be an object`)
    if (typeof client.receiver !== 'string') throw invalidUserConfig(repoId, `relationPatterns.dbClients[${index}].receiver must be a string`)
    if (typeof client.orm !== 'string') throw invalidUserConfig(repoId, `relationPatterns.dbClients[${index}].orm must be a string`)
  }
}

function validateUserApiClients(value: unknown, repoId: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw invalidUserConfig(repoId, 'relationPatterns.apiClients must be an array')
  for (const [index, rawClient] of value.entries()) {
    const client = asRecord(rawClient)
    if (!client) throw invalidUserConfig(repoId, `relationPatterns.apiClients[${index}] must be an object`)
    if (typeof client.receiver !== 'string') throw invalidUserConfig(repoId, `relationPatterns.apiClients[${index}].receiver must be a string`)
    if (client.protocol !== 'rest' && client.protocol !== 'graphql' && client.protocol !== 'trpc' && client.protocol !== 'orpc') {
      throw invalidUserConfig(repoId, `relationPatterns.apiClients[${index}].protocol is invalid`)
    }
    const methods = asRecord(client.methods)
    if (!methods || !Object.values(methods).every((method) => typeof method === 'string')) {
      throw invalidUserConfig(repoId, `relationPatterns.apiClients[${index}].methods must be an object of strings`)
    }
  }
}

function validateUserFunctionWrappers(value: unknown, repoId: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw invalidUserConfig(repoId, 'relationPatterns.functionWrappers must be an array')
  for (const [index, rawWrapper] of value.entries()) {
    const wrapper = asRecord(rawWrapper)
    if (!wrapper) throw invalidUserConfig(repoId, `relationPatterns.functionWrappers[${index}] must be an object`)
    if (typeof wrapper.functionName !== 'string') throw invalidUserConfig(repoId, `relationPatterns.functionWrappers[${index}].functionName must be a string`)
    if (wrapper.relationKind !== 'api_call' && wrapper.relationKind !== 'external_link') {
      throw invalidUserConfig(repoId, `relationPatterns.functionWrappers[${index}].relationKind is invalid`)
    }
    if (typeof wrapper.targetArgIndex !== 'number') throw invalidUserConfig(repoId, `relationPatterns.functionWrappers[${index}].targetArgIndex must be a number`)
  }
}

function validateUserSdkAliases(value: unknown, repoId: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw invalidUserConfig(repoId, 'relationPatterns.sdkAliases must be an array')
  for (const [index, rawAlias] of value.entries()) {
    const alias = asRecord(rawAlias)
    if (!alias) throw invalidUserConfig(repoId, `relationPatterns.sdkAliases[${index}] must be an object`)
    if (typeof alias.localName !== 'string') throw invalidUserConfig(repoId, `relationPatterns.sdkAliases[${index}].localName must be a string`)
    if (typeof alias.packageName !== 'string') throw invalidUserConfig(repoId, `relationPatterns.sdkAliases[${index}].packageName must be a string`)
  }
}

function validateUserServiceMapHints(value: unknown, repoId: string): void {
  if (value === undefined) return
  const hints = asRecord(value)
  if (!hints) throw invalidUserConfig(repoId, 'serviceMapHints must be an object when present')
  if (hints.apiBasePaths !== undefined) {
    if (!Array.isArray(hints.apiBasePaths)) throw invalidUserConfig(repoId, 'serviceMapHints.apiBasePaths must be an array')
    for (const [index, rawBasePath] of hints.apiBasePaths.entries()) {
      const basePath = asRecord(rawBasePath)
      if (!basePath || typeof basePath.basePath !== 'string') {
        throw invalidUserConfig(repoId, `serviceMapHints.apiBasePaths[${index}].basePath must be a string`)
      }
    }
  }
}

function invalidUserConfig(repoId: string, reason: string): StaticAnalysisUserConfigError {
  return new StaticAnalysisUserConfigError(
    `Invalid static analysis user config for repository '${repoId}': ${reason}.`,
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function asStaticAnalysisPatternProfile(value: unknown): StaticAnalysisPatternProfile | null {
  const record = asRecord(value)
  if (!record || record.version !== 1) return null
  return record as unknown as StaticAnalysisPatternProfile
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
