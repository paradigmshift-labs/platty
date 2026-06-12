import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { docDeps, docRelationLinks, documentLinks, documents } from '@/db/schema/build_docs.js'
import { projects, repositories } from '@/db/schema/core.js'
import { docSyncCandidates, docSyncPlans, staticMerkleSnapshots } from '@/db/schema/sync.js'
import * as docSyncApi from '@/pipeline_modules/sync/doc_sync.js'
import {
  advanceDocSyncPlanPhase,
  applyDocSyncPlan,
  createDocSyncPlan,
  listDocSyncCandidates,
  markDocSyncCandidate,
  stageDocSyncOutput,
} from '@/pipeline_modules/sync/doc_sync.js'
import type { DB } from '@/db/client.js'
import { createTestPlattyDb, type TestPlattyDb } from '@/db/testing.js'

let client: TestPlattyDb
let db: DB

beforeEach(() => {
  client = createTestPlattyDb()
  db = client.db
  db.insert(projects).values({ id: 'p1', name: 'Project' }).run()
  db.insert(repositories).values({
    id: 'r1',
    projectId: 'p1',
    name: 'Repo',
    repoPath: '/repo',
    analysisBranch: 'main',
    analysisWorktreePath: '/analysis/repo',
  }).run()
})

afterEach(async () => {
  await client.cleanup()
})

describe('createDocSyncPlan', () => {
  it('creates deterministic technical candidates from old and new Merkle document hashes', () => {
    seedSnapshot('snap:old', {
      routeDocumentSourceHashes: [
        routeHash('route:orders', 'hash:orders:v1'),
        routeHash('route:settings', 'hash:settings:v1'),
        routeHash('route:profile', 'hash:profile:v1'),
      ],
    })
    seedSnapshot('snap:new', {
      routeDocumentSourceHashes: [
        routeHash('route:orders', 'hash:orders:v2'),
        routeHash('route:settings', 'hash:settings:v2'),
        routeHash('route:new', 'hash:new:v1'),
      ],
    })
    seedDocument('doc:orders', routeTarget('route:orders'), 'hash:orders:v1')
    seedDocument('doc:settings', routeTarget('route:settings'), null)
    seedDocument('doc:profile', routeTarget('route:profile'), 'hash:profile:v1')

    const result = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:old', toSnapshotId: 'snap:new' })
    const candidates = listDocSyncCandidates({ db, planId: result.planId }).candidates

    expect(result).toMatchObject({
      status: 'technical_pending',
      counts: {
        unchanged: 0,
        newDocument: 1,
        stale: 1,
        staleCandidate: 1,
        orphan: 1,
      },
    })
    expect(candidates.map((candidate) => ({
      kind: candidate.kind,
      status: candidate.status,
      scopeId: candidate.target.scopeId,
      oldHash: candidate.oldHash,
      newHash: candidate.newHash,
    })).sort(byScopeId)).toEqual([
      { kind: 'new_document', status: 'pending', scopeId: 'route:new', oldHash: null, newHash: 'hash:new:v1' },
      { kind: 'stale', status: 'pending', scopeId: 'route:orders', oldHash: 'hash:orders:v1', newHash: 'hash:orders:v2' },
      { kind: 'orphan_document', status: 'pending', scopeId: 'route:profile', oldHash: 'hash:profile:v1', newHash: null },
      { kind: 'stale_candidate', status: 'pending', scopeId: 'route:settings', oldHash: 'hash:settings:v1', newHash: 'hash:settings:v2' },
    ])
  })

  it('does not expose an LLM-oriented server API', () => {
    expect(Object.keys(docSyncApi).sort()).toEqual([
      'advanceDocSyncPlanPhase',
      'applyDocSyncPlan',
      'createDocSyncPlan',
      'getDocSyncCandidateContext',
      'listDocSyncCandidates',
      'markDocSyncCandidate',
      'stageDocSyncOutput',
    ])
    expect(Object.keys(docSyncApi).join(' ')).not.toMatch(/llm|claude|openai|generate/i)
  })

  it('uses technical document source hashes and filters candidates by repo and document scope', () => {
    seedSnapshot('snap:old', {
      technicalDocumentSourceHashes: [
        routeHash('route:orders', 'hash:orders:v1', 'r1'),
        routeHash('route:billing', 'hash:billing:v1', 'r2'),
        modelHash('r1:Order', 'hash:model:v1', 'r1'),
      ],
    })
    seedSnapshot('snap:new', {
      technicalDocumentSourceHashes: [
        routeHash('route:orders', 'hash:orders:v2', 'r1'),
        routeHash('route:billing', 'hash:billing:v2', 'r2'),
        modelHash('r1:Order', 'hash:model:v2', 'r1'),
      ],
    })
    seedDocument('doc:orders', routeTarget('route:orders', 'r1'), 'hash:orders:v1')
    seedDocument('doc:billing', routeTarget('route:billing', 'r2'), 'hash:billing:v1')
    seedDocument('doc:model', modelTarget('r1:Order', 'r1'), 'hash:model:v1')

    const repoScoped = createDocSyncPlan({
      db,
      projectId: 'p1',
      fromSnapshotId: 'snap:old',
      toSnapshotId: 'snap:new',
      scope: { repoIds: ['r1'] },
    })
    expect(listDocSyncCandidates({ db, planId: repoScoped.planId }).candidates.map((candidate) => candidate.target.scopeId).sort()).toEqual([
      'r1:Order',
      'route:orders',
    ])

    const documentScoped = createDocSyncPlan({
      db,
      projectId: 'p1',
      fromSnapshotId: 'snap:old',
      toSnapshotId: 'snap:new',
      scope: { documentIds: ['doc:model'] },
    })
    expect(listDocSyncCandidates({ db, planId: documentScoped.planId }).candidates).toEqual([
      expect.objectContaining({
        kind: 'stale',
        target: expect.objectContaining({ scope: 'model', scopeId: 'r1:Order' }),
      }),
    ])
  })

  it('classifies backend repo addition as new API plus service-map-impacted screen only', () => {
    seedSnapshot('snap:frontend', {
      technicalDocumentSourceHashes: [
        screenHash('screen:orders', 'hash:screen:orders:v1', 'r-front'),
        screenHash('screen:profile', 'hash:screen:profile:v1', 'r-front'),
      ],
    })
    seedSnapshot('snap:frontend-backend', {
      technicalDocumentSourceHashes: [
        screenHash('screen:orders', 'hash:screen:orders:v2-service-map', 'r-front'),
        screenHash('screen:profile', 'hash:screen:profile:v1', 'r-front'),
        routeHash('api:orders', 'hash:api:orders:v1', 'r-back'),
      ],
    })
    seedDocument('doc:orders-screen', screenTarget('screen:orders', 'r-front'), 'hash:screen:orders:v1')
    seedDocument('doc:profile-screen', screenTarget('screen:profile', 'r-front'), 'hash:screen:profile:v1')

    const result = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:frontend', toSnapshotId: 'snap:frontend-backend' })
    const candidates = listDocSyncCandidates({ db, planId: result.planId }).candidates

    expect(candidates.map((candidate) => ({
      kind: candidate.kind,
      type: candidate.target.type,
      scopeId: candidate.target.scopeId,
      oldHash: candidate.oldHash,
      newHash: candidate.newHash,
    })).sort(byScopeId)).toEqual([
      {
        kind: 'new_document',
        type: 'api_spec',
        scopeId: 'api:orders',
        oldHash: null,
        newHash: 'hash:api:orders:v1',
      },
      {
        kind: 'stale',
        type: 'screen_spec',
        scopeId: 'screen:orders',
        oldHash: 'hash:screen:orders:v1',
        newHash: 'hash:screen:orders:v2-service-map',
      },
    ])
  })
})

describe('doc sync candidate decisions', () => {
  it('allows fresh only for stale candidates and requires hard new/stale documents to be staged before apply', () => {
    const planId = seedPlanWithNewStaleAndStaleCandidate()
    const candidates = listDocSyncCandidates({ db, planId }).candidates
    const newCandidate = candidates.find((candidate) => candidate.kind === 'new_document')
    const staleCandidate = candidates.find((candidate) => candidate.kind === 'stale')
    const reviewCandidate = candidates.find((candidate) => candidate.kind === 'stale_candidate')
    if (!newCandidate || !staleCandidate || !reviewCandidate) throw new Error('expected candidates')

    expect(() => markDocSyncCandidate({
      db,
      planId,
      candidateId: staleCandidate.candidateId,
      decision: 'fresh',
      rationale: 'unchanged after review',
    })).toThrow(/fresh.*stale_candidate/i)

    expect(markDocSyncCandidate({
      db,
      planId,
      candidateId: reviewCandidate.candidateId,
      decision: 'fresh',
      rationale: 'source hash changed but contract did not',
    })).toMatchObject({ status: 'resolved' })

    expect(() => advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })).toThrow(/pending technical/i)

    expect(() => stageDocSyncOutput({
      db,
      planId,
      candidateId: staleCandidate.candidateId,
      document: { summary: 'Orders API v2', content: { version: 2 } },
      evidence: { note: 'missing source ids' },
    })).toThrow(/requires source evidence/i)

    stageDocSyncOutput({
      db,
      planId,
      candidateId: staleCandidate.candidateId,
      document: { summary: 'Orders API v2', content: { version: 2 } },
      evidence: { codeNodeIds: ['node:orders'] },
    })

    expect(() => advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })).toThrow(/pending technical/i)

    stageDocSyncOutput({
      db,
      planId,
      candidateId: newCandidate.candidateId,
      document: { summary: 'New API', content: { version: 1 } },
      evidence: { codeNodeIds: ['node:new'] },
    })

    expect(advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })).toMatchObject({
      status: 'ready_to_apply',
    })
  })

  it('rejects fresh decisions for stale candidates without an existing document to restamp', () => {
    seedSnapshot('snap:old', {
      routeDocumentSourceHashes: [routeHash('route:missing', 'hash:missing:v1')],
    })
    seedSnapshot('snap:new', {
      routeDocumentSourceHashes: [routeHash('route:missing', 'hash:missing:v2')],
    })

    const { planId } = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:old', toSnapshotId: 'snap:new' })
    const [candidate] = listDocSyncCandidates({ db, planId }).candidates
    expect(candidate).toMatchObject({ kind: 'stale_candidate', target: expect.objectContaining({ scopeId: 'route:missing' }) })

    expect(() => markDocSyncCandidate({
      db,
      planId,
      candidateId: candidate.candidateId,
      decision: 'fresh',
      rationale: 'cannot accept a missing document as fresh',
    })).toThrow(/requires an existing document/i)
  })

  it('creates business candidates only after technical candidates are resolved', () => {
    seedSnapshot('snap:old', {
      routeDocumentSourceHashes: [routeHash('route:orders', 'hash:orders:v1')],
      businessDocumentSourceHashes: [businessHash('epic:orders', 'hash:business:v1')],
    })
    seedSnapshot('snap:new', {
      routeDocumentSourceHashes: [routeHash('route:orders', 'hash:orders:v2')],
      businessDocumentSourceHashes: [businessHash('epic:orders', 'hash:business:v2')],
    })
    seedDocument('doc:orders', routeTarget('route:orders'), null)
    seedDocument('doc:business', businessTarget('epic:orders'), 'hash:business:v1')

    const { planId } = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:old', toSnapshotId: 'snap:new' })

    expect(listDocSyncCandidates({ db, planId }).candidates).toEqual([
      expect.objectContaining({ phase: 'technical', kind: 'stale_candidate' }),
    ])
    expect(() => advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })).toThrow(/pending technical/i)

    const [candidate] = listDocSyncCandidates({ db, planId }).candidates
    markDocSyncCandidate({
      db,
      planId,
      candidateId: candidate.candidateId,
      decision: 'fresh',
      rationale: 'reviewed as semantically unchanged',
    })

    expect(advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })).toMatchObject({
      status: 'business_pending',
      counts: { newDocument: 0, stale: 1, staleCandidate: 0, orphan: 0 },
    })
    const businessCandidates = listDocSyncCandidates({ db, planId, phase: 'business' }).candidates
    expect(businessCandidates).toEqual([
      expect.objectContaining({
        phase: 'business',
        kind: 'stale',
        target: expect.objectContaining({ scopeId: 'epic:orders' }),
      }),
    ])
    stageDocSyncOutput({
      db,
      planId,
      candidateId: businessCandidates[0]!.candidateId,
      document: { summary: 'Orders design v2', content: { version: 2 } },
      evidence: { linkedDocumentIds: ['doc:orders'] },
    })
    expect(advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })).toMatchObject({
      status: 'ready_to_apply',
    })
  })
})

describe('applyDocSyncPlan', () => {
  it('updates only document state and provenance from staged outputs', () => {
    seedSnapshot('snap:old', {
      routeDocumentSourceHashes: [routeHash('route:orders', 'hash:orders:v1')],
    })
    seedSnapshot('snap:new', {
      routeDocumentSourceHashes: [routeHash('route:orders', 'hash:orders:v2')],
    })
    seedDocument('doc:orders', routeTarget('route:orders'), 'hash:orders:v1')
    seedDocument('doc:business', businessTarget('epic:orders'), 'hash:business:v1')

    const { planId } = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:old', toSnapshotId: 'snap:new' })
    const [candidate] = listDocSyncCandidates({ db, planId }).candidates
    const staged = stageDocSyncOutput({
      db,
      planId,
      candidateId: candidate.candidateId,
      document: {
        summary: 'Orders API v2',
        content: { version: 2 },
        rawOutput: 'generated by skill',
        docDeps: [{ codeNodeId: 'node:orders', depType: 'entrypoint' }],
        docRelationLinks: [{
          repoId: 'r1',
          sourceNodeId: 'node:orders',
          kind: 'db_access',
          target: 'Order',
          operation: 'findMany',
          canonicalTarget: 'Order',
          payloadJson: { model: 'Order' },
          evidenceNodeIdsJson: ['node:orders'],
          confidence: 'high',
        }],
        documentLinks: [{ toDocumentId: 'doc:business', linkType: 'supports' }],
      },
      evidence: { codeNodeIds: ['node:orders'] },
    })

    expect(staged).toMatchObject({ status: 'staged', contentHash: expect.any(String) })
    advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })

    const result = applyDocSyncPlan({ db, planId })

    expect(result).toEqual({ planId, status: 'applied', appliedDocuments: 1 })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders')).get()).toMatchObject({
      status: 'passed',
      summary: 'Orders API v2',
      content: { version: 2 },
      rawLlmOutput: 'generated by skill',
      staticSnapshotId: 'snap:new',
      documentSourceHash: 'hash:orders:v2',
      contentHash: staged.contentHash,
      validity: 'fresh',
      updatedBy: 'llm',
    })
    expect(db.select().from(docDeps).where(eq(docDeps.documentId, 'doc:orders')).all()).toEqual([
      expect.objectContaining({ codeNodeId: 'node:orders', depType: 'entrypoint' }),
    ])
    expect(db.select().from(docRelationLinks).where(eq(docRelationLinks.documentId, 'doc:orders')).all()).toEqual([
      expect.objectContaining({ repoId: 'r1', kind: 'db_access', canonicalTarget: 'Order' }),
    ])
    expect(db.select().from(documentLinks).where(eq(documentLinks.fromDocumentId, 'doc:orders')).all()).toEqual([
      expect.objectContaining({ toDocumentId: 'doc:business', linkType: 'supports' }),
    ])
    expect(db.select().from(staticMerkleSnapshots).all()).toHaveLength(2)
    expect(db.select().from(docSyncPlans).where(eq(docSyncPlans.id, planId)).get()).toMatchObject({
      status: 'applied',
    })
    expect(() => stageDocSyncOutput({
      db,
      planId,
      candidateId: candidate.candidateId,
      document: { summary: 'Orders API v3', content: { version: 3 } },
      evidence: { codeNodeIds: ['node:orders'] },
    })).toThrow(/no longer mutable/i)
    expect(() => markDocSyncCandidate({
      db,
      planId,
      candidateId: candidate.candidateId,
      decision: 'skip',
      rationale: 'late mutation',
    })).toThrow(/no longer mutable/i)
  })

  it('restamps fresh stale candidates so accepted source changes are not reflagged as review candidates', () => {
    seedSnapshot('snap:old', {
      routeDocumentSourceHashes: [routeHash('route:settings', 'hash:settings:v1')],
    })
    seedSnapshot('snap:new', {
      routeDocumentSourceHashes: [routeHash('route:settings', 'hash:settings:v2')],
    })
    seedDocument('doc:settings', routeTarget('route:settings'), null)

    const { planId } = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:old', toSnapshotId: 'snap:new' })
    const [candidate] = listDocSyncCandidates({ db, planId }).candidates
    expect(candidate).toMatchObject({ kind: 'stale_candidate', oldHash: 'hash:settings:v1', newHash: 'hash:settings:v2' })

    markDocSyncCandidate({
      db,
      planId,
      candidateId: candidate.candidateId,
      decision: 'fresh',
      rationale: 'source changed, but existing document still describes the contract',
    })
    advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })

    expect(applyDocSyncPlan({ db, planId })).toEqual({ planId, status: 'applied', appliedDocuments: 0 })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:settings')).get()).toMatchObject({
      status: 'passed',
      summary: 'doc:settings summary',
      content: { version: 1 },
      contentHash: 'doc:settings:content',
      documentSourceHash: 'hash:settings:v2',
      staticSnapshotId: 'snap:new',
      validity: 'fresh',
    })

    seedSnapshot('snap:later', {
      routeDocumentSourceHashes: [routeHash('route:settings', 'hash:settings:v3')],
    })
    const nextPlan = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:new', toSnapshotId: 'snap:later' })

    expect(listDocSyncCandidates({ db, planId: nextPlan.planId }).candidates).toEqual([
      expect.objectContaining({ kind: 'stale', oldHash: 'hash:settings:v2', newHash: 'hash:settings:v3' }),
    ])
  })

  it('marks orphaned documents as deleted so downstream indexes skip removed routes', () => {
    seedSnapshot('snap:old', {
      routeDocumentSourceHashes: [routeHash('route:profile', 'hash:profile:v1')],
    })
    seedSnapshot('snap:new', {
      routeDocumentSourceHashes: [],
    })
    seedDocument('doc:profile', routeTarget('route:profile'), 'hash:profile:v1')

    const { planId } = createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:old', toSnapshotId: 'snap:new' })
    const [candidate] = listDocSyncCandidates({ db, planId }).candidates
    expect(candidate).toMatchObject({ kind: 'orphan_document', oldHash: 'hash:profile:v1', newHash: null })

    markDocSyncCandidate({
      db,
      planId,
      candidateId: candidate.candidateId,
      decision: 'orphan',
      rationale: 'route no longer exists in the latest snapshot',
    })
    advanceDocSyncPlanPhase({ db, planId, nextPhase: 'business' })

    expect(applyDocSyncPlan({ db, planId })).toEqual({ planId, status: 'applied', appliedDocuments: 0 })
    expect(db.select().from(documents).where(eq(documents.id, 'doc:profile')).get()).toMatchObject({
      status: 'deleted',
      validity: 'orphaned',
    })
  })
})

function seedPlanWithNewStaleAndStaleCandidate(): string {
  seedSnapshot('snap:old', {
    routeDocumentSourceHashes: [
      routeHash('route:orders', 'hash:orders:v1'),
      routeHash('route:settings', 'hash:settings:v1'),
    ],
  })
  seedSnapshot('snap:new', {
    routeDocumentSourceHashes: [
      routeHash('route:orders', 'hash:orders:v2'),
      routeHash('route:settings', 'hash:settings:v2'),
      routeHash('route:new', 'hash:new:v1'),
    ],
  })
  seedDocument('doc:orders', routeTarget('route:orders'), 'hash:orders:v1')
  seedDocument('doc:settings', routeTarget('route:settings'), null)
  return createDocSyncPlan({ db, projectId: 'p1', fromSnapshotId: 'snap:old', toSnapshotId: 'snap:new' }).planId
}

function seedSnapshot(id: string, hashSet: Record<string, unknown>): void {
  db.insert(staticMerkleSnapshots).values({
    id,
    projectId: 'p1',
    snapshotKind: 'project',
    rootHash: `${id}:root`,
    repoCommitPinsJson: [{ repoId: 'r1', analysisBranch: 'main', sourceCommit: `${id}:commit`, analysisWorktreePath: '/analysis/repo' }],
    hashSetJson: hashSet,
    reasonInputsJson: {
      byKey: {
        'route:orders': { changedNodes: ['node:orders'] },
        'route:settings': { changedNodes: ['node:settings'] },
        'route:new': { changedNodes: ['node:new'] },
        'epic:orders': { sourceDocumentChanges: ['route:orders'] },
      },
    },
    createdByRunId: `run:${id}`,
  }).run()
}

function seedDocument(
  id: string,
  target: { track: string; type: string; scope: string; scopeId: string },
  documentSourceHash: string | null,
): void {
  db.insert(documents).values({
    id,
    projectId: 'p1',
    type: target.type,
    track: target.track,
    scope: target.scope,
    scopeId: target.scopeId,
    status: 'active',
    validity: 'fresh',
    summary: `${id} summary`,
    content: { version: 1 },
    rawLlmOutput: '',
    contentHash: `${id}:content`,
    documentSourceHash,
    staticSnapshotId: 'snap:old',
    updatedBy: 'system',
  }).run()
}

function routeHash(scopeId: string, hash: string, repoId = 'r1') {
  return { key: scopeId, hash, target: routeTarget(scopeId, repoId) }
}

function screenHash(scopeId: string, hash: string, repoId = 'r1') {
  return { key: `screen:${scopeId}`, hash, target: screenTarget(scopeId, repoId) }
}

function modelHash(scopeId: string, hash: string, repoId: string) {
  return { key: `model:${scopeId}`, hash, target: modelTarget(scopeId, repoId) }
}

function businessHash(scopeId: string, hash: string) {
  return { key: scopeId, hash, target: businessTarget(scopeId) }
}

function routeTarget(scopeId: string, repoId = 'r1') {
  return { track: 'technical', type: 'api_spec', scope: 'route', scopeId, repoId }
}

function screenTarget(scopeId: string, repoId = 'r1') {
  return { track: 'technical', type: 'screen_spec', scope: 'screen', scopeId, repoId }
}

function modelTarget(scopeId: string, repoId = 'r1') {
  return { track: 'technical', type: 'data_dictionary', scope: 'model', scopeId, repoId }
}

function businessTarget(scopeId: string) {
  return { track: 'business', type: 'design', scope: 'epic', scopeId }
}

function byScopeId(
  a: { scopeId: string | null },
  b: { scopeId: string | null },
): number {
  return String(a.scopeId).localeCompare(String(b.scopeId))
}
