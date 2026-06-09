import { describe, expect, it } from 'vitest'
import {
  discoverFixtureCorpus,
  getFixtureCorpusSummary,
  loadFixture,
  loadFixtureExpected,
  loadFixtureSource,
} from '../../src/fixture_corpus/index.js'

describe('fixture corpus loading', () => {
  it('discovers the target representative corpus without importing the source real-project corpus', () => {
    const corpus = discoverFixtureCorpus()
    const ids = corpus.entries.map((entry) => entry.id)
    const summary = getFixtureCorpusSummary(corpus)

    expect(ids).toContain('repo/orm-e2e/prisma-examples-express')
    expect(ids).toContain('unit/ast-extract/nextjs')
    expect(ids).not.toContain('schema-diversity/prisma/relations-basic')
    expect(summary.total).toBeGreaterThanOrEqual(2)
    expect(summary.bySourceGroup.repo).toBeGreaterThanOrEqual(1)
    expect(summary.pipelineStageExpected.build_pattern_profile).toBeGreaterThanOrEqual(1)
  })

  it('loads repo fixture metadata and direct source files from the target corpus layout', () => {
    const entry = loadFixture('repo/orm-e2e/prisma-examples-express')

    expect(entry).toMatchObject({
      id: 'repo/orm-e2e/prisma-examples-express',
      sourceGroup: 'repo',
      framework: 'prisma',
      language: 'prisma',
      layout: {
        scope: 'repo',
        suite: 'orm-e2e',
      },
      stageExpected: {
        build_models: 'present',
      },
    })

    const schema = loadFixtureSource('repo/orm-e2e/prisma-examples-express', 'schema.prisma')
    expect(schema).toContain('model User')
  })

  it('loads unit fixture metadata and returns null when an expected oracle is not present', () => {
    const entry = loadFixture('unit/ast-extract/nextjs')

    expect(entry).toMatchObject({
      id: 'unit/ast-extract/nextjs',
      sourceGroup: 'unit',
      layout: {
        scope: 'unit',
        suite: 'ast-extract',
      },
      stageExpected: {
        analyze_repo: 'present',
        build_graph: 'present',
        build_pattern_profile: 'present',
      },
    })

    expect(loadFixtureExpected('unit/ast-extract/nextjs', 'build_graph')).toBeNull()
    expect(loadFixture('missing/fixture')).toBeNull()
  })
})
