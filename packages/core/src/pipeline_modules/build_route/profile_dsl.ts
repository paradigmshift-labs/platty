import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import type { StaticAnalysisPatternProfile } from '@/pipeline_modules/shared/static_config/index.js'
import { matchPatternDslRules } from '@/pipeline_modules/shared/static_config/pattern_dsl.js'
import { sourceAttributionFromConfigSource } from '@/pipeline_modules/shared/static_config/source_attribution.js'
import type { EntryPointDraft } from './types.js'

export interface PatternProfileRouteEntriesResult {
  entryPoints: EntryPointDraft[]
  diagnostics: Record<string, number>
}

export function extractPatternProfileRouteEntries(input: {
  repoId: string
  profile: StaticAnalysisPatternProfile | null | undefined
  nodes: CodeNode[]
  edges: CodeEdge[]
}): PatternProfileRouteEntriesResult {
  const profile = input.profile
  if (!profile || profile.validity !== 'fresh' || profile.analysisMode === 'deterministic_only') {
    return { entryPoints: [], diagnostics: { dslRouteEntries: 0 } }
  }

  const facts = matchPatternDslRules({
    rules: (profile.rules ?? []).filter((rule) => rule.target === 'route.entrypoint'),
    edges: input.edges,
  })
  const nodeIds = new Set(input.nodes.map((node) => node.id))
  const entryPoints: EntryPointDraft[] = []
  for (const fact of facts) {
    if (!nodeIds.has(fact.sourceNodeId)) continue
    const method = fact.operation ?? 'GET'
    const configSource = findRuleSource(profile, fact.ruleId)
    entryPoints.push({
      framework: 'pattern_dsl',
      kind: 'api',
      httpMethod: method,
      path: fact.target,
      fullPath: fact.target,
      handlerNodeId: fact.sourceNodeId,
      detectionSource: `dsl:${fact.ruleId}`,
      confidence: 'high',
      metadata: {
        configPatternId: fact.ruleId,
        configSource,
        source: sourceAttributionFromConfigSource(configSource),
        evidence: fact.evidenceEdgeIds.map((id) => `edge:${id}`),
      },
      detectionEvidence: {
        matchedRuleId: fact.ruleId,
        matchedNodeIds: [fact.sourceNodeId],
        matchedEdgeIds: fact.evidenceEdgeIds,
      },
    })
  }

  return {
    entryPoints,
    diagnostics: {
      dslRouteEntries: entryPoints.length,
      dslRouteFacts: facts.length,
    },
  }
}

function findRuleSource(profile: StaticAnalysisPatternProfile, ruleId: string): string | null {
  return profile.rules.find((rule) => rule.id === ruleId)?.source ?? null
}
