import type {
  BuildRelationsInputs,
  CallArgExpression,
  CodeEdgeLike,
  RelationCandidate,
  SemanticIndex,
} from '../types.js'
import type {
  ConfigPatternEvidence,
  ConfiguredApiClient,
  ConfiguredDbClient,
  StaticAnalysisPatternProfile,
} from '@/pipeline_modules/shared/static_config/index.js'
import { matchPatternDslRules } from '@/pipeline_modules/shared/static_config/pattern_dsl.js'
import { sourceAttributionFromConfigSource } from '@/pipeline_modules/shared/static_config/source_attribution.js'

const INTERNAL_PATH_RE = /^\/[^/]/

export function extractPatternProfileRelationCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  const config = inputs.staticAnalysisPatternProfile
  if (!isConsumableConfig(config)) return []

  const candidates: RelationCandidate[] = []
  candidates.push(...matchGenericRules(config, inputs.edges))
  for (const node of inputs.nodes) {
    for (const callEdge of index.callsBySource.get(node.id) ?? []) {
      candidates.push(...matchDbClients(config, callEdge, node.id))
      candidates.push(...matchApiClients(config, callEdge, node.id))
    }
  }
  return candidates
}

function matchGenericRules(
  config: StaticAnalysisPatternProfile,
  edges: CodeEdgeLike[],
): RelationCandidate[] {
  return matchPatternDslRules({
    rules: (config.rules ?? []).filter((rule) => rule.target.startsWith('relation.')),
    edges,
  }).flatMap((fact): RelationCandidate[] => {
    const edgeId = fact.evidenceEdgeIds[0]
    const edge = edges.find((item) => item.id === edgeId)
    if (!edge) return []
    const configSource = findRuleSource(config, fact.ruleId)
    if (fact.factKind === 'relation.db_access') {
      return [{
        kind: 'db_access',
        sourceNodeId: fact.sourceNodeId,
        evidenceNodeIds: [`edge:${edge.id}`],
        receiver: edge.chainPath,
        targetSymbol: edge.targetSymbol,
        chainPath: edge.chainPath,
        firstArg: edge.firstArg,
        argExpressions: edge.argExpressions as CallArgExpression[] | null | undefined,
        payload: {
          orm: inferDbOrmFromRuleId(fact.ruleId),
          method: fact.operation ?? edge.targetSymbol ?? 'execute',
          modelName: fact.target,
          adapter: 'pattern_dsl',
          configPatternId: fact.ruleId,
          configSource,
          source: sourceAttributionFromConfigSource(configSource),
        },
      }]
    }
    if (fact.factKind === 'relation.api_call') {
      return [{
        kind: 'api_call',
        sourceNodeId: fact.sourceNodeId,
        evidenceNodeIds: [`edge:${edge.id}`],
        receiver: edge.chainPath,
        targetSymbol: edge.targetSymbol,
        chainPath: edge.chainPath,
        firstArg: fact.target,
        rawTarget: fact.target,
        argExpressions: edge.argExpressions as CallArgExpression[] | null | undefined,
        payload: {
          method: fact.operation ?? edge.targetSymbol ?? 'GET',
          protocol: 'rest',
          adapter: 'pattern_dsl',
          configPatternId: fact.ruleId,
          configSource,
          source: sourceAttributionFromConfigSource(configSource),
        },
      }]
    }
    return []
  })
}

function inferDbOrmFromRuleId(ruleId: string): string {
  const match = /^db\.([^.]+)/.exec(ruleId)
  return match?.[1] ?? 'custom:pattern_dsl'
}

function matchDbClients(
  config: StaticAnalysisPatternProfile,
  callEdge: CodeEdgeLike,
  sourceNodeId: string,
): RelationCandidate[] {
  if (!callEdge.chainPath || !callEdge.targetSymbol) return []
  const candidates: RelationCandidate[] = []
  for (const dbClient of config.relationPatterns.dbClients) {
    if (!isHighConfidence(dbClient.evidence)) continue
    if (!chainMatchesReceiver(callEdge.chainPath, dbClient.receiver)) continue
    candidates.push({
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${callEdge.id}`],
      receiver: dbClient.receiver,
      targetSymbol: callEdge.targetSymbol,
      chainPath: callEdge.chainPath,
      firstArg: callEdge.firstArg,
      argExpressions: callEdge.argExpressions as CallArgExpression[] | null | undefined,
      payload: {
        orm: dbClient.orm,
        method: callEdge.targetSymbol,
        adapter: 'profile_dsl_db_client',
        configPatternId: `profile-dsl:db:${dbClient.receiver}`,
        configSource: dbClient.configSource,
        source: sourceAttributionFromConfigSource(dbClient.configSource),
        configEvidenceRef: toConfigEvidenceRef(dbClient.evidence, config),
        ...(dbClient.ownerType ? { ownerType: dbClient.ownerType } : {}),
        ...(dbClient.clientKind ? { clientKind: dbClient.clientKind } : {}),
      },
    })
  }
  return candidates
}

function matchApiClients(
  config: StaticAnalysisPatternProfile,
  callEdge: CodeEdgeLike,
  sourceNodeId: string,
): RelationCandidate[] {
  if (!callEdge.chainPath || !callEdge.targetSymbol) return []
  const candidates: RelationCandidate[] = []
  for (const apiClient of config.relationPatterns.apiClients) {
    if (!isHighConfidence(apiClient.evidence)) continue
    if (!chainMatchesReceiver(callEdge.chainPath, apiClient.receiver)) continue
    const method = apiClient.methods[callEdge.targetSymbol]
    if (!method) continue
    const rawTarget = normalizeApiTarget(callEdge.firstArg, apiClient)
    if (!rawTarget) continue
    candidates.push({
      kind: 'api_call',
      sourceNodeId,
      evidenceNodeIds: [`edge:${callEdge.id}`],
      receiver: apiClient.receiver,
      targetSymbol: callEdge.targetSymbol,
      chainPath: callEdge.chainPath,
      firstArg: rawTarget,
      rawTarget,
      argExpressions: callEdge.argExpressions as CallArgExpression[] | null | undefined,
      payload: {
        method,
        protocol: apiClient.protocol,
        adapter: 'profile_dsl_api_client',
        configPatternId: `profile-dsl:api:${apiClient.receiver}`,
        configSource: apiClient.configSource,
        source: sourceAttributionFromConfigSource(apiClient.configSource),
        configEvidenceRef: toConfigEvidenceRef(apiClient.evidence, config),
        ...(apiClient.basePath ? { baseURL: apiClient.basePath } : {}),
      },
    })
  }
  return candidates
}

function findRuleSource(config: StaticAnalysisPatternProfile, ruleId: string): string | null {
  return config.rules.find((rule) => rule.id === ruleId)?.source ?? null
}

function isConsumableConfig(config: StaticAnalysisPatternProfile | null | undefined): config is StaticAnalysisPatternProfile {
  return Boolean(config && config.validity === 'fresh' && config.analysisMode !== 'deterministic_only')
}

function isHighConfidence(evidence: ConfigPatternEvidence): boolean {
  return evidence.confidence === 'high' && evidence.source !== 'llm_candidate'
}

function chainMatchesReceiver(chainPath: string, receiver: string): boolean {
  return chainPath === receiver || chainPath.startsWith(`${receiver}.`)
}

function normalizeApiTarget(firstArg: string | null | undefined, apiClient: ConfiguredApiClient): string | null {
  if (!firstArg) return null
  const path = firstArg.startsWith('/') ? firstArg : `/${firstArg}`
  if (!INTERNAL_PATH_RE.test(path)) return null
  if (!apiClient.basePath) return path
  const base = apiClient.basePath.replace(/\/+$/, '')
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}/${path.replace(/^\/+/, '')}`
}

function toConfigEvidenceRef(evidence: ConfigPatternEvidence, config: StaticAnalysisPatternProfile): {
  evidenceNodeIds: string[]
  builtFromCommit: string | null
  graphSchemaVersion: string
} {
  return {
    evidenceNodeIds: evidence.evidenceNodeIds,
    builtFromCommit: evidence.builtFromCommit,
    graphSchemaVersion: config.graphSchemaVersion,
  }
}
