import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '../src/db/testing.js'
import { runStaticPipelineForRepository, STATIC_PIPELINE_STAGES } from '../src/static_pipeline.js'

describe('static_pipeline', () => {
  it('keeps build_pattern_profile between build_graph and build_models', () => {
    expect(STATIC_PIPELINE_STAGES).toEqual([
      'analyze_repo',
      'build_graph',
      'build_pattern_profile',
      'build_models',
      'build_route',
      'build_relations',
      'build_service_map',
    ])
  })

  it('runs repository stages in static pipeline order with injected stages', async () => {
    const client = createTestPlattyDb()
    const calls: string[] = []

    await runStaticPipelineForRepository({
      db: client.db,
      repoId: 'repo-1',
      stages: Object.fromEntries(
        STATIC_PIPELINE_STAGES.map((stage) => [stage, async () => {
          calls.push(stage)
        }]),
      ),
    })

    expect(calls).toEqual(STATIC_PIPELINE_STAGES)
    client.close()
  })
})
