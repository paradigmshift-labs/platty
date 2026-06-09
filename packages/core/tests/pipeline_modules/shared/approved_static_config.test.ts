import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import {
  composeAndSaveStaticAnalysisPatternProfile,
  loadApprovedStaticAnalysisRules,
  saveApprovedStaticAnalysisRules,
} from '@/pipeline_modules/shared/static_config/index.js'
import { matchPatternDslRules } from '@/pipeline_modules/shared/static_config/pattern_dsl.js'
import type { StaticAnalysisPatternRule } from '@/pipeline_modules/shared/static_config/types.js'

function approvedRouteRule(): StaticAnalysisPatternRule {
  return {
    id: 'approved.route.app_route',
    state: 'active',
    source: 'approved',
    target: 'route.entrypoint',
    match: { relation: 'renders', targetSymbolIn: ['AppRoute'], literalArgKey: 'path' },
    emit: { targetFrom: 'literalArg:path', operationValue: 'GET' },
  }
}

function seedGraph() {
  const db = createTestDb()
  db.insert(projects).values({ id: 'project-1', name: 'Project 1' }).run()
  db.insert(repositories).values({
    id: 'repo-1',
    projectId: 'project-1',
    name: 'repo',
    repoPath: '/repo',
    language: 'typescript',
    framework: 'react',
  }).run()
  db.insert(repositoryPhaseStatus).values({
    repositoryId: 'repo-1',
    phase: 'build_graph',
    builtFromCommit: 'abc123',
    validity: 'fresh',
    meta: {},
  }).run()
  db.insert(codeNodes).values({
    id: 'repo-1:src/routes.tsx:Routes',
    repoId: 'repo-1',
    type: 'function',
    filePath: 'src/routes.tsx',
    name: 'Routes',
  }).run()
  db.insert(codeEdges).values([{
    id: 7,
    repoId: 'repo-1',
    sourceId: 'repo-1:src/routes.tsx:Routes',
    relation: 'renders',
    targetSymbol: 'AppRoute',
    literalArgs: '[{"path":"/admin/users"}]',
    resolveStatus: 'resolved',
  }]).run()
  composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })
  return db
}

describe('approved static analysis rule storage', () => {
  it('round-trips approved rules through repository_phase_status meta without a schema change', () => {
    const db = seedGraph()

    saveApprovedStaticAnalysisRules({ db, repoId: 'repo-1', rules: [approvedRouteRule()] })

    const loaded = loadApprovedStaticAnalysisRules({ db, repoId: 'repo-1' })
    expect(loaded?.rules).toEqual([approvedRouteRule()])
    expect(loaded?.version).toBe(1)
  })

  it('deduplicates and bumps the version when approved rules are appended', () => {
    const db = seedGraph()
    saveApprovedStaticAnalysisRules({ db, repoId: 'repo-1', rules: [approvedRouteRule()] })

    const second: StaticAnalysisPatternRule = { ...approvedRouteRule(), id: 'approved.route.other' }
    saveApprovedStaticAnalysisRules({ db, repoId: 'repo-1', rules: [approvedRouteRule(), second] })

    const loaded = loadApprovedStaticAnalysisRules({ db, repoId: 'repo-1' })
    expect(loaded?.rules.map((rule) => rule.id).sort()).toEqual(['approved.route.app_route', 'approved.route.other'])
    expect(loaded?.version).toBe(2)
  })

  it('feeds stored approved rules into the recomposed profile as active approved rules', () => {
    const db = seedGraph()
    saveApprovedStaticAnalysisRules({ db, repoId: 'repo-1', rules: [approvedRouteRule()] })

    const profile = composeAndSaveStaticAnalysisPatternProfile({ db, repoId: 'repo-1' })

    expect(profile?.rules).toContainEqual(expect.objectContaining({
      id: 'approved.route.app_route',
      state: 'active',
      source: 'approved',
    }))
    expect(profile?.sources.approvedConfigVersion).toBe('1')

    const facts = matchPatternDslRules({
      rules: profile?.rules ?? [],
      edges: [{
        id: 7,
        sourceId: 'repo-1:src/routes.tsx:Routes',
        relation: 'renders',
        targetSymbol: 'AppRoute',
        literalArgs: '[{"path":"/admin/users"}]',
      } as never],
    })
    expect(facts).toContainEqual(expect.objectContaining({
      ruleId: 'approved.route.app_route',
      factKind: 'route.entrypoint',
      target: '/admin/users',
    }))
  })

  it('returns null when no approved rules are stored', () => {
    const db = seedGraph()
    expect(loadApprovedStaticAnalysisRules({ db, repoId: 'repo-1' })).toBeNull()
  })
})
