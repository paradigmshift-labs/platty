import { describe, expect, it } from 'vitest'
import {
  FIXTURE_LLM_PIPELINE_STAGES,
  FIXTURE_STATIC_PIPELINE_STAGES,
  resolveStagesForMode,
  runStaticFixtureStages,
} from '../../../src/fixture_corpus/index.js'

describe('fixture corpus static stage runner', () => {
  it('keeps build_pattern_profile in the static pipeline order before model and relation stages', () => {
    expect(FIXTURE_STATIC_PIPELINE_STAGES).toEqual([
      'analyze_repo',
      'build_graph',
      'build_pattern_profile',
      'static_analysis_dsl_discovery',
      'build_models',
      'build_route',
      'build_relations',
      'build_docs',
      'build_service_map',
    ])
  })

  it('resolves fixture, static, and llm stage modes', () => {
    expect(resolveStagesForMode('fixture', ['build_models'])).toEqual(['build_models'])
    expect(resolveStagesForMode('static', ['build_models'])).toEqual([...FIXTURE_STATIC_PIPELINE_STAGES])
    expect(resolveStagesForMode('llm', [])).toEqual(FIXTURE_LLM_PIPELINE_STAGES)
  })

  it('runs injected stage handlers in resolved static order without invoking live LLM commands', async () => {
    const seen: string[] = []
    const result = await runStaticFixtureStages({
      mode: 'fixture',
      stages: ['build_graph', 'build_pattern_profile'],
      handlers: {
        build_graph: async () => {
          seen.push('build_graph')
        },
        build_pattern_profile: async () => {
          seen.push('build_pattern_profile')
        },
      },
    })

    expect(seen).toEqual(['build_graph', 'build_pattern_profile'])
    expect(result).toEqual({
      status: 'pass',
      stages: ['build_graph', 'build_pattern_profile'],
      failures: [],
    })
  })
})
