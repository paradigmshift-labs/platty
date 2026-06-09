import { describe, expect, it } from 'vitest'
import { SELF_IMPROVE_EXPERIMENTAL_STAGES, resolveSelfImproveStages } from '../../../src/fixture_corpus/self_improve/index.js'

describe('self-improve stage order', () => {
  it('keeps build_pattern_profile in the canonical repo/unit stage order', () => {
    const expected = [
      'analyze_repo',
      'build_graph',
      'build_pattern_profile',
      'build_models',
      'build_route',
      'build_relations',
      'build_docs',
    ]

    expect(resolveSelfImproveStages('repo')).toEqual(expected)
    expect(resolveSelfImproveStages('unit')).toEqual(expected)
  })

  it('adds build_service_map only for service fixtures and keeps experimental stages explicit', () => {
    expect(resolveSelfImproveStages('service')).toEqual([
      'analyze_repo',
      'build_graph',
      'build_pattern_profile',
      'build_models',
      'build_route',
      'build_relations',
      'build_service_map',
      'build_docs',
    ])
    expect(SELF_IMPROVE_EXPERIMENTAL_STAGES).toEqual(['static_analysis_dsl_discovery'])
  })
})
