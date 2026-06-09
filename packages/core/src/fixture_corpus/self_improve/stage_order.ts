import type { CorpusStageId, FixtureExecutionScope } from '../registry.js'

export const SELF_IMPROVE_REPO_STAGES = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'build_models',
  'build_route',
  'build_relations',
  'build_docs',
] as const satisfies readonly CorpusStageId[]

export const SELF_IMPROVE_SERVICE_STAGES = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'build_models',
  'build_route',
  'build_relations',
  'build_service_map',
  'build_docs',
] as const satisfies readonly CorpusStageId[]

export const SELF_IMPROVE_EXPERIMENTAL_STAGES = [
  'static_analysis_dsl_discovery',
] as const satisfies readonly CorpusStageId[]

export function resolveSelfImproveStages(scope: FixtureExecutionScope): CorpusStageId[] {
  switch (scope) {
    case 'repo':
    case 'unit':
      return [...SELF_IMPROVE_REPO_STAGES]
    case 'service':
      return [...SELF_IMPROVE_SERVICE_STAGES]
  }
}

export function stagesWithDependencies(stage: CorpusStageId): CorpusStageId[] {
  const order: CorpusStageId[] = [
    'analyze_repo',
    'build_graph',
    'build_pattern_profile',
    'build_models',
    'build_route',
    'build_relations',
    'build_service_map',
    'build_docs',
    'build_docs_sql',
    'build_epics',
    'build_business_docs',
  ]
  const index = order.indexOf(stage)
  if (index === -1) return [stage]
  return order.slice(0, index + 1)
}
