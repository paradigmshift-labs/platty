export const FIXTURE_STATIC_PIPELINE_STAGES = [
  'analyze_repo',
  'build_graph',
  'build_pattern_profile',
  'static_analysis_dsl_discovery',
  'build_models',
  'build_route',
  'build_relations',
  'build_docs',
  'build_service_map',
] as const

export const FIXTURE_LLM_PIPELINE_STAGES = [
  ...FIXTURE_STATIC_PIPELINE_STAGES,
  'build_docs_sql',
  'build_epics',
  'build_business_docs',
] as const

export type PipelineMode = 'static' | 'llm' | 'fixture'
export type FixtureStageHandler = () => Promise<void> | void

export interface RunStaticFixtureStagesInput {
  mode: PipelineMode
  stages?: readonly string[]
  handlers: Record<string, FixtureStageHandler | undefined>
}

export interface RunStaticFixtureStagesResult {
  status: 'pass' | 'fail'
  stages: string[]
  failures: Array<{ stageId: string; message: string }>
}

export function resolveStagesForMode(mode: PipelineMode, fixtureStages: readonly string[] = []): string[] {
  switch (mode) {
    case 'static':
      return [...FIXTURE_STATIC_PIPELINE_STAGES]
    case 'llm':
      return [...FIXTURE_LLM_PIPELINE_STAGES]
    case 'fixture':
      return [...fixtureStages]
  }
}

export async function runStaticFixtureStages(input: RunStaticFixtureStagesInput): Promise<RunStaticFixtureStagesResult> {
  const stages = resolveStagesForMode(input.mode, input.stages)
  const failures: Array<{ stageId: string; message: string }> = []

  for (const stageId of stages) {
    const handler = input.handlers[stageId]
    if (!handler) {
      failures.push({ stageId, message: `missing fixture stage handler: ${stageId}` })
      continue
    }
    try {
      await handler()
    } catch (error) {
      failures.push({ stageId, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    stages,
    failures,
  }
}
