import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import type { RelationRuleAuthor } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'
import {
  knownRelationPackages, toPersistedRelationRules, runLiveRelationDiscovery,
} from '@/pipeline_modules/build_relations/rule_authoring/live_runner.js'
import { loadPromotedRelationRules } from '@/pipeline_modules/build_relations/rule_authoring/persistence.js'

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r', name: p.id, lineStart: 1, lineEnd: 99, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return {
    id: edgeId++, repoId: 'r', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p,
  } as CodeEdgeLike
}
function repoWithNewVendor() {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const fn = node({ id: 'r:a.ts:f', type: 'function', filePath: 'a.ts' })
  const imp = edge({ sourceId: file.id, relation: 'imports', targetSpecifier: 'newvendor' })
  const capture = edge({ sourceId: fn.id, relation: 'calls', targetSymbol: 'capture', chainPath: 'nv' })
  const inputs: BuildRelationsInputs = { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file, fn], edges: [imp, capture], models: [] }
  return { inputs, index: buildSemanticIndex(inputs), captureId: capture.id }
}
const stubAuthor = (captureId: number): RelationRuleAuthor => async (gap) =>
  gap.packageSpecifier === 'newvendor'
    ? {
        kind: 'external_service',
        candidate: {
          id: 'rel.external_service.newvendor', label: 'newvendor', packages: ['newvendor'], methods: ['capture'],
          resolve: { resourceByMethod: { capture: 'events' }, operationByMethod: { capture: 'capture_event' } },
          anchorFixture: 'auto/newvendor', anchorEvidenceEdgeIds: [captureId],
          anchorExpectedCanonical: ['external_service:newvendor:events'], support: { matched: 1, examples: ['capture'] },
        },
      }
    : null

describe('build_relations live_runner', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    db.insert(projects).values({ id: 'p', name: 'p' }).run()
    db.insert(repositories).values({ id: 'r', projectId: 'p', name: 'r', repoPath: '/mock' }).run()
  })

  it('knownRelationPackages excludes hard-coded engine packages', () => {
    expect(knownRelationPackages(db, 'r')).toContain('@prisma/client')
    expect(knownRelationPackages(db, 'r')).toContain('axios')
  })

  it('toPersistedRelationRules maps the 3 tagged kinds to emit-rule shapes', () => {
    const out = toPersistedRelationRules([
      { kind: 'db_access', candidate: { id: 'x', ormLabel: 'neo', clientPackages: ['@neo/db'], operationByMethod: { insert: 'insert' }, anchorFixture: 'a', anchorEvidenceEdgeIds: [], support: { matched: 0, examples: [] } } },
      { kind: 'api_call', candidate: { id: 'y', clientLabel: 'h', clientPackages: ['@h/c'], methodBySymbol: { get: 'GET' }, anchorFixture: 'a', anchorEvidenceEdgeIds: [], support: { matched: 0, examples: [] } } },
    ] as never)
    expect(out.dbAccess[0].ormLabel).toBe('neo')
    expect(out.apiCall[0].clientLabel).toBe('h')
  })

  it('ACTIVATION: runs the loop (stub author) and PERSISTS the external_service promotion', async () => {
    const r = repoWithNewVendor()
    const result = await runLiveRelationDiscovery({ db, repoId: 'r', inputs: r.inputs, index: r.index, author: stubAuthor(r.captureId), classifier: async () => ({ kind: 'vendor_service', reason: 'test' }) })
    expect(result.promoted.map((a) => a.candidate.id)).toEqual(['rel.external_service.newvendor'])
    expect(loadPromotedRelationRules({ db, repoId: 'r' })?.externalService.map((x) => x.label)).toEqual(['newvendor'])
  })
})
