import { and, count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { sql } from 'drizzle-orm'
import {
  documentItemDocumentLinks,
  documentItemModelLinks,
  documentItems,
  documentLinks,
  documentProposals,
  documentVersions,
  documents,
} from '../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import { models } from '../../../src/db/schema/build_models.js'
import { epics, projects, repositories } from '../../../src/db/schema/core.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
} from '../../../src/db/schema/build_business_docs_generation.js'
import { startBusinessDocsGeneration } from '../../../src/pipeline_modules/build_business_docs_cli/start.js'
import { getBusinessDocsContextBundle, leaseBusinessDocsTasks } from '../../../src/pipeline_modules/build_business_docs_cli/lease.js'
import { submitBusinessDocsTask } from '../../../src/pipeline_modules/build_business_docs_cli/submit.js'
import type {
  BusinessDocsLeasedTask,
  BusinessDocsSubmittedDocument,
  BusinessDocsSubmitResult,
} from '../../../src/pipeline_modules/build_business_docs_cli/types.js'

const projectId = 'project:platty'
const now = '2026-06-04T00:00:00.000Z'
const later = '2026-06-04T00:10:00.000Z'
const syncSourceHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs_cli submit / validate / persist', () => {
  it('rejects task/project/run/lease/attempt submit conflicts without writes', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task)

    expect(submitBusinessDocsTask(db, {
      projectId: 'project:other',
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_TASK_NOT_FOUND' })

    db.update(businessDocGenerationRuns)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(businessDocGenerationRuns.id, runId))
      .run()
    expect(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_RUN_NOT_SUBMITTABLE' })

    db.update(businessDocGenerationRuns)
      .set({ status: 'running', updatedAt: now })
      .where(eq(businessDocGenerationRuns.id, runId))
      .run()
    expect(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: 'wrong',
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_LEASE_CONFLICT' })

    expect(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo + 1,
      document,
      now: fixedNow,
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_ATTEMPT_CONFLICT' })

    expect(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: () => new Date('2026-06-04T01:00:00.000Z'),
    })).toMatchObject({ ok: false, code: 'BUSINESS_DOCS_LEASE_CONFLICT' })

    expect(countSubmittedTasks(db)).toBe(0)
    expect(countBusinessDocuments(db)).toBe(0)
  })

  it('requests repair for schema and evidence validation errors and upserts validation context', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const invalid = {
      ...validDocumentFor(db, task),
      summary: '',
      evidenceIds: ['invented:evidence'],
    }

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: invalid,
      now: fixedNow,
      makeId: makeSequentialIds('submit'),
    }))

    expect(result).toMatchObject({
      task: {
        id: task.id,
        status: 'repair_requested',
        attemptNo: 1,
      },
      submit: {
        validationErrorCount: expect.any(Number),
      },
      repair: {
        validationPageToken: 'validation_errors',
        nextAttemptNo: 1,
      },
      nextAction: {
        type: 'repair_task',
      },
    })
    expect(result.submit.validationErrorCount).toBeGreaterThanOrEqual(2)

    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(stored).toMatchObject({
      status: 'repair_requested',
      attemptNo: 1,
      contextHandle: task.contextHandle,
      savedDocumentId: null,
    })
    expect(stored?.submittedJson).toMatchObject({
      schemaVersion: 'business-docs-submit.v1',
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: 0,
    })
    expect(stored?.validationErrors?.map((error) => error.code)).toEqual(expect.arrayContaining([
      'SCHEMA_INVALID',
      'UNKNOWN_EVIDENCE_ID',
    ]))

    const bundle = db.select().from(businessDocContextBundles)
      .where(eq(businessDocContextBundles.contextHandle, task.contextHandle))
      .get()
    expect(bundle?.manifestJson.pageTokens).toContain('validation_errors')
    const validationPage = db.select().from(businessDocContextPages)
      .where(and(
        eq(businessDocContextPages.contextHandle, task.contextHandle),
        eq(businessDocContextPages.pageToken, 'validation_errors'),
      ))
      .get()
    expect(validationPage?.contentJson).toMatchObject({
      taskId: task.id,
      attemptNo: 0,
    })
    expect(db.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, runId))
      .get()?.status).toBe('repair_requested')
  })

  it('marks a task failed after validation errors exceed max repair attempts', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const firstLease = leaseOne(db, runId, 'business_rules')
    const invalid = {
      ...validDocumentFor(db, firstLease),
      evidenceIds: ['invented:evidence'],
    }

    const first = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: firstLease.id,
      leaseToken: firstLease.leaseToken,
      attemptNo: firstLease.attemptNo,
      document: invalid,
      now: fixedNow,
      makeId: makeSequentialIds('first'),
    }))
    expect(first.task.status).toBe('repair_requested')

    const repairLease = leaseOne(db, runId, 'business_rules')
    const second = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: repairLease.id,
      leaseToken: repairLease.leaseToken,
      attemptNo: repairLease.attemptNo,
      document: {
        ...validDocumentFor(db, repairLease),
        evidenceIds: ['invented:again'],
      },
      now: () => new Date(later),
      makeId: makeSequentialIds('second'),
    }))

    expect(second).toMatchObject({
      task: {
        status: 'failed',
        attemptNo: 2,
      },
      repair: {
        nextAttemptNo: null,
      },
      nextAction: {
        type: 'stop_failed',
      },
    })
    expect(db.select().from(businessDocGenerationRuns)
      .where(eq(businessDocGenerationRuns.id, runId))
      .get()?.status).toBe('failed')
  })

  it('allows a repair attempt to resubmit identical invalid content with the new lease token', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const firstLease = leaseOne(db, runId, 'business_rules')
    const invalid = {
      ...validDocumentFor(db, firstLease),
      evidenceIds: ['invented:evidence'],
    }

    const first = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: firstLease.id,
      leaseToken: firstLease.leaseToken,
      attemptNo: firstLease.attemptNo,
      document: invalid,
      now: fixedNow,
      makeId: makeSequentialIds('first-identical-invalid'),
    }))
    expect(first.task.status).toBe('repair_requested')

    const repairLease = leaseOne(db, runId, 'business_rules')
    const second = submitBusinessDocsTask(db, {
      projectId,
      taskId: repairLease.id,
      leaseToken: repairLease.leaseToken,
      attemptNo: repairLease.attemptNo,
      document: invalid,
      now: () => new Date(later),
      makeId: makeSequentialIds('second-identical-invalid'),
    })

    expect(second).toMatchObject({
      ok: true,
      data: {
        task: {
          status: 'failed',
          attemptNo: 2,
        },
      },
    })
  })

  it('saves a valid source-first business document with document items', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      items: [
        item('rule:payment', 1),
        item('rule:fulfillment', 2),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('save'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'saved',
      },
      document: {
        operation: 'create',
        proposalId: null,
      },
      downstream: {
        contextPagesUpserted: expect.any(Number),
      },
      nextAction: {
        type: 'lease_more',
      },
    })
    expect(result.document.savedDocumentId).toEqual(expect.any(String))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(saved).toMatchObject({
      projectId,
      type: 'br',
      track: 'business',
      scope: 'epic',
      scopeId: 'epic:orders',
      status: 'active',
      validity: 'fresh',
      sourceRunId: runId,
      sourceCommit: 'unknown',
      updatedBy: 'llm',
    })
    expect(saved?.content).toMatchObject({
      schemaVersion: 'business-doc.v1',
      summary: document.summary,
    })
    expect(saved?.contentHash).toEqual(result.submit.contentHash)

    const items = db.select().from(documentItems)
      .where(eq(documentItems.documentId, String(result.document.savedDocumentId)))
      .all()
    expect(items.map((row) => row.stableKey).sort()).toEqual(['rule:fulfillment', 'rule:payment'])
    expect(items.every((row) => row.status === 'active')).toBe(true)
  })

  it('materializes item source document links from submitted evidence ids', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = validDocumentFor(db, task, {
      items: [
        item('rule:payment', 1, {
          evidenceIds: sourceEvidenceIds.slice(0, 1),
        }),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('item-links'),
    }))

    const links = db.select().from(documentItemDocumentLinks).all()
    expect(result.task.status).toBe('saved')
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toDocumentId: 'doc:orders-api',
        linkType: 'source_document',
        role: 'primary',
      }),
    ]))
  })

  it('derives business rules content from submitted items when the core rules array is omitted', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = validDocumentFor(db, task, {
      content: {
        evidence_gaps: [],
      },
      items: [
        item('rule:payment', 1, {
          evidenceIds: sourceEvidenceIds.slice(0, 1),
        }),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('derived-br-core'),
    }))

    expect(result.task.status).toBe('saved')
    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(saved?.content).toMatchObject({
      content: {
        evidence_gaps: [],
        rules: [
          expect.objectContaining({
            id: 'rule:payment',
            statement: 'the system shall enforce the business rule',
            pattern: 'event_driven',
            source_refs: ['doc:orders-api'],
            status: 'confirmed',
          }),
        ],
      },
    })
  })

  it('derives business rules content from submitted items when canonical rules are placeholders', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = validDocumentFor(db, task, {
      content: {
        evidence_gaps: ['source evidence is partial'],
        rules: [{}],
      },
      evidenceIds: sourceEvidenceIds.slice(0, 1),
      items: [
        item('rule:payment-placeholder', 1, {
          evidenceIds: sourceEvidenceIds.slice(0, 1),
        }),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('br-placeholder'),
    }))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(result.task.status).toBe('saved')
    expect(saved?.content).toMatchObject({
      content: {
        rules: [
          expect.objectContaining({
            id: 'rule:payment-placeholder',
            statement: 'the system shall enforce the business rule',
          }),
        ],
      },
    })
  })

  it('persists glossary registry fields from canonical terms and indexes aliases and signals', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:design:orders',
      type: 'design',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:design',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:dd:orders',
      type: 'data_dictionary',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:dd',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:br:orders',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:br',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:ucl:orders',
      type: 'ucl',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:ucl',
    })
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'epic_glossary')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = {
      ...validDocumentFor(db, task),
      documentType: 'glossary',
      title: 'Orders Glossary',
      summary: 'Glossary for order terms.',
      content: {
        type: 'glossary',
        glossary_scope: 'epic',
        terms: [{
          term: '쇼핑일기',
          canonical_term: 'shopping diary',
          definition: 'A user-authored diary created from a purchased item.',
          type: 'domain',
          aliases: ['구매일기', 'purchase diary'],
          synonyms: ['shopping diary'],
          candidate_aliases: ['diary with review'],
          antonyms: [],
          contrast_terms: ['상품 리뷰'],
          related_terms: ['상품 리뷰'],
          signals: ['orderGoodStockId', '반려', '리워드'],
          epic_ids: ['epic:orders'],
          source_doc_ids: ['doc:orders-api'],
          ambiguity: { status: 'none', candidates: [] },
        }],
      },
      items: [{
        itemType: 'term',
        stableKey: 'term:shopping-diary',
        title: '쇼핑일기',
        summary: 'A user-authored diary created from a purchased item.',
        content: {
          term: '쇼핑일기',
          definition: 'A user-authored diary created from a purchased item.',
          termType: 'domain',
          source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'Defines the term.' }],
        },
        evidenceIds: sourceEvidenceIds.slice(0, 1),
      }],
    } satisfies BusinessDocsSubmittedDocument

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('submit'),
    }))

    expect(result.task.status).toBe('saved')
    expect(result.document.savedDocumentId).toBeTruthy()
    const savedDocumentId = String(result.document.savedDocumentId)
    const rows = db.select().from(documentItems)
      .where(eq(documentItems.documentId, savedDocumentId))
      .all()

    expect(rows).toHaveLength(1)
    expect(rows[0].content).toMatchObject({
      canonical_term: 'shopping diary',
      aliases: ['구매일기', 'purchase diary'],
      synonyms: ['shopping diary'],
      candidate_aliases: ['diary with review'],
      signals: ['orderGoodStockId', '반려', '리워드'],
      ambiguity: { status: 'none', candidates: [] },
    })

    const aliasFtsHit = db.all(sql`
      SELECT item_id
      FROM document_items_fts
      WHERE document_items_fts MATCH ${'"purchase diary"'}
    `) as Array<{ item_id: string }>
    expect(aliasFtsHit.length).toBeGreaterThanOrEqual(1)

    const signalFtsHit = db.all(sql`
      SELECT item_id
      FROM document_items_fts
      WHERE document_items_fts MATCH ${'orderGoodStockId'}
    `) as Array<{ item_id: string }>
    expect(signalFtsHit.length).toBeGreaterThanOrEqual(1)
  })

  it('derives glossary terms from submitted items when canonical terms are placeholders', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:design:orders',
      type: 'design',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:design',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:dd:orders',
      type: 'data_dictionary',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:dd',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:br:orders',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:br',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:ucl:orders',
      type: 'ucl',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:ucl',
    })
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'epic_glossary')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = {
      ...validDocumentFor(db, task),
      documentType: 'glossary',
      title: 'Orders Glossary',
      summary: 'Glossary for order terms.',
      content: {
        evidence_gaps: ['source evidence is partial'],
        terms: [{}],
      },
      items: [{
        itemType: 'term',
        stableKey: 'term:shopping-diary',
        title: '쇼핑일기',
        summary: 'A user-authored diary created from a purchased item.',
        content: {
          term: '쇼핑일기',
          canonical_term: '쇼핑일기',
          definition: 'A user-authored diary created from a purchased item.',
          termType: 'domain',
          source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'Defines the term.' }],
          aliases: ['구매일기'],
          synonyms: ['shopping diary'],
          candidate_aliases: ['diary with review'],
          antonyms: [],
          contrast_terms: ['상품 리뷰'],
          related_terms: ['상품 리뷰'],
          signals: ['orderGoodStockId'],
          ambiguity: { status: 'none', candidates: [] },
        },
        evidenceIds: sourceEvidenceIds.slice(0, 1),
      }],
    } satisfies BusinessDocsSubmittedDocument

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('glossary-placeholder'),
    }))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(result.task.status).toBe('saved')
    expect(saved?.content).toMatchObject({
      content: {
        terms: [
          expect.objectContaining({
            term: '쇼핑일기',
            canonical_term: '쇼핑일기',
            definition: 'A user-authored diary created from a purchased item.',
          }),
        ],
      },
    })
  })

  it('ignores unusable glossary content terms instead of throwing when item terms are valid', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:design:orders',
      type: 'design',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:design',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:dd:orders',
      type: 'data_dictionary',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:dd',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:br:orders',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:br',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:ucl:orders',
      type: 'ucl',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:ucl',
    })
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'epic_glossary')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = {
      ...validDocumentFor(db, task),
      documentType: 'glossary',
      title: 'Orders Glossary',
      summary: 'Glossary for order terms.',
      content: {
        evidence_gaps: ['source evidence is partial'],
        terms: [{}, {}],
      },
      items: [{
        itemType: 'term',
        stableKey: 'term-shopping-diary',
        title: '쇼핑일기',
        summary: 'A user-authored diary created from a purchased item.',
        content: {
          term: '쇼핑일기',
          canonical_term: '쇼핑일기',
          definition: 'A user-authored diary created from a purchased item.',
          termType: 'domain',
          source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'Defines the term.' }],
          aliases: ['구매일기'],
          synonyms: ['shopping diary'],
          candidate_aliases: [],
          antonyms: [],
          contrast_terms: [],
          related_terms: [],
          signals: ['orderGoodStockId'],
          ambiguity: { status: 'none', candidates: [] },
        },
        evidenceIds: sourceEvidenceIds.slice(0, 1),
      }],
    } satisfies BusinessDocsSubmittedDocument

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('glossary-unusable-content-terms'),
    }))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(result.task.status).toBe('saved')
    expect(saved?.content).toMatchObject({
      content: {
        terms: [
          expect.objectContaining({
            term: '쇼핑일기',
            canonical_term: '쇼핑일기',
          }),
        ],
      },
    })
  })

  it('derives glossary terms from glossary alias item types when core terms are placeholders', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:design:orders',
      type: 'design',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:design',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:dd:orders',
      type: 'data_dictionary',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:dd',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:br:orders',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:br',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:ucl:orders',
      type: 'ucl',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:ucl',
    })
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'epic_glossary')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = {
      ...validDocumentFor(db, task),
      documentType: 'glossary',
      title: 'Orders Glossary',
      summary: 'Glossary for order terms.',
      content: {
        type: 'glossary',
        glossary_scope: 'epic',
        terms: [{}, {}],
      },
      items: [
        glossaryItem('glossary_item', '쇼핑일기', sourceEvidenceIds.slice(0, 1)),
        glossaryItem('domain', '콘텐츠', sourceEvidenceIds.slice(0, 1)),
      ],
    } satisfies BusinessDocsSubmittedDocument

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('glossary-alias-items'),
    }))

    expect(result.task.status).toBe('saved')
    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(saved?.content).toMatchObject({
      content: {
        terms: [
          expect.objectContaining({ term: '쇼핑일기', canonical_term: '쇼핑일기' }),
          expect.objectContaining({ term: '콘텐츠', canonical_term: '콘텐츠' }),
        ],
      },
    })
  })

  it('requests repair when glossary content terms omit canonical_term', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:design:orders',
      type: 'design',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:design',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:dd:orders',
      type: 'data_dictionary',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:dd',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:br:orders',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:br',
    })
    seedExistingBusinessDocument(db, {
      id: 'doc:ucl:orders',
      type: 'ucl',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:ucl',
    })
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'epic_glossary')
    const sourceEvidenceIds = sourceDocumentEvidenceIds(db, task)
    const document = {
      ...validDocumentFor(db, task),
      documentType: 'glossary',
      title: 'Orders Glossary',
      summary: 'Glossary for order terms.',
      content: {
        type: 'glossary',
        glossary_scope: 'epic',
        terms: [{
          term: '쇼핑일기',
          definition: 'A user-authored diary created from a purchased item.',
          type: 'domain',
          aliases: ['구매일기'],
          synonyms: ['shopping diary'],
          candidate_aliases: ['diary with review'],
          antonyms: [],
          contrast_terms: ['상품 리뷰'],
          related_terms: ['상품 리뷰'],
          signals: ['orderGoodStockId'],
          epic_ids: ['epic:orders'],
          source_doc_ids: ['doc:orders-api'],
          ambiguity: { status: 'none', candidates: [] },
        }],
      },
      items: [{
        itemType: 'glossary_term',
        stableKey: 'term:쇼핑일기',
        title: '쇼핑일기',
        summary: 'A user-authored diary created from a purchased item.',
        content: {
          term: '쇼핑일기',
          canonical_term: '쇼핑일기',
          definition: 'A user-authored diary created from a purchased item.',
          termType: 'domain',
          aliases: ['구매일기'],
          synonyms: ['shopping diary'],
          candidate_aliases: ['diary with review'],
          antonyms: [],
          contrast_terms: ['상품 리뷰'],
          related_terms: ['상품 리뷰'],
          signals: ['orderGoodStockId'],
          source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'Defines the term.' }],
          ambiguity: { status: 'none', candidates: [] },
        },
        evidenceIds: sourceEvidenceIds.slice(0, 1),
      }],
    } satisfies BusinessDocsSubmittedDocument

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('submit'),
    }))

    expect(result.task.status).toBe('repair_requested')
    expect(result.submit.validationErrorCount).toBeGreaterThanOrEqual(1)
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('GLOSSARY_QUALITY_INSUFFICIENT')
  })

  it('materializes item source links from model evidence source document ids', () => {
    const db = createRunnableProject()
    db.insert(repositories).values({
      id: 'repo:orders',
      projectId,
      name: 'orders',
      repoPath: '/repo/orders',
      analysisBranch: 'main',
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(models).values({
      id: 'repo:orders:Order',
      repositoryId: 'repo:orders',
      name: 'Order',
      tableName: 'orders',
      fields: [{ name: 'id', type: 'String', nullable: false, primary: true, unique: true, line: 1 }],
      relations: [],
      orm: 'prisma',
      validity: 'fresh',
      createdAt: now,
      updatedAt: now,
    }).run()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'data_dictionary')
    const modelEvidenceId = `${runId}:${task.id}:model_evidence:1`
    db.update(businessDocContextPages)
      .set({
        pageOrder: 99,
        summary: 'Model evidence',
        evidenceIdsJson: [modelEvidenceId],
        contentJson: {
          models: [
            {
              evidenceId: modelEvidenceId,
              modelId: 'model:Order',
              name: 'Order',
              tableName: 'orders',
              sourceDocumentIds: ['doc:orders-api'],
            },
          ],
        },
        contentHash: 'hash:model-evidence',
      })
      .where(and(
        eq(businessDocContextPages.contextHandle, task.contextHandle),
        eq(businessDocContextPages.pageToken, 'model_evidence'),
      ))
      .run()

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        evidenceIds: [modelEvidenceId],
        items: [
          {
            itemType: 'data_entity',
            stableKey: 'dd:order',
            ordinal: 1,
            title: 'Order',
            summary: 'Order model.',
            content: {
              entity: 'Order',
              fields: [
                {
                  name: 'id',
                  type: 'String',
                  meaning: 'Order id.',
                  source_mapping: [modelEvidenceId],
                },
              ],
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('model-links'),
    }))

    const links = db.select().from(documentItemDocumentLinks).all()
    const modelLinks = db.select().from(documentItemModelLinks).all()
    expect(result.task.status).toBe('saved')
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toDocumentId: 'doc:orders-api',
        linkType: 'source_document',
        role: 'supporting',
      }),
    ]))
    expect(modelLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: 'repo:orders:Order',
        fieldName: null,
        linkType: 'describes_model',
        role: 'primary',
      }),
      expect.objectContaining({
        modelId: 'repo:orders:Order',
        fieldName: 'id',
        linkType: 'describes_field',
        role: 'supporting',
      }),
    ]))
  })

  it('materializes data dictionary item source links from nested field source mappings', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'data_dictionary')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        items: [
          {
            itemType: 'data_entity',
            stableKey: 'dd:order',
            ordinal: 1,
            title: 'Order',
            summary: 'Order model.',
            content: {
              entity: 'Order',
              fields: [
                {
                  name: 'id',
                  type: 'String',
                  meaning: 'Order id.',
                  source_mapping: ['source_document_1'],
                },
              ],
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('field-source-links'),
    }))

    const savedItem = db.select().from(documentItems)
      .where(and(
        eq(documentItems.documentId, String(result.document.savedDocumentId)),
        eq(documentItems.itemType, 'data_entity'),
        eq(documentItems.stableKey, 'dd:order'),
      ))
      .get()
    const links = savedItem
      ? db.select().from(documentItemDocumentLinks)
        .where(eq(documentItemDocumentLinks.fromItemId, savedItem.id))
        .all()
      : []
    expect(result.task.status).toBe('saved')
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toDocumentId: 'doc:orders-api',
        linkType: 'source_document',
        role: 'primary',
      }),
    ]))
  })

  it('derives data dictionary entities from submitted items when canonical entities are placeholders', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'data_dictionary')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        content: {
          evidence_gaps: [],
          entities: [{}, {}],
        },
        items: [
          {
            itemType: 'data_entity',
            stableKey: 'dd:order',
            ordinal: 1,
            title: 'Order',
            summary: 'Order model.',
            content: {
              entity: 'Order',
              fields: [
                {
                  name: 'id',
                  meaning: 'Order id.',
                  source_mapping: ['source_document_1'],
                },
              ],
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('dd-derived-entities'),
    }))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(result.task.status).toBe('saved')
    expect(saved?.content).toMatchObject({
      content: {
        entities: [
          {
            name: 'Order',
            fields: [
              {
                name: 'id',
                description: 'Order id.',
              },
            ],
          },
        ],
      },
    })
  })

  it('keeps data dictionary entities empty for explicit missing-model evidence placeholder docs', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'data_dictionary')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        content: {
          evidence_gaps: ['model evidence is missing'],
          entities: [{}],
        },
        items: [
          {
            itemType: 'data_entity',
            stableKey: 'dd:missing-model-evidence',
            ordinal: 1,
            title: 'Missing model evidence',
            summary: 'Model evidence is missing.',
            content: {
              gapType: 'missing_model_evidence',
              message: 'Model evidence is missing.',
              source_mapping: [
                {
                  sourceRef: 'source_document_1',
                  role: 'primary',
                  reason: 'Source document has no model evidence.',
                },
              ],
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('dd-missing-model-placeholder'),
    }))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(result.task.status).toBe('saved')
    expect(saved?.content).toMatchObject({
      content: {
        entities: [],
      },
    })
  })

  it('materializes item source links from top-level string source mappings', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'data_dictionary')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        items: [
          {
            itemType: 'data_gap',
            stableKey: 'dd:missing-model-evidence',
            ordinal: 1,
            title: 'Missing model evidence',
            summary: 'No model evidence was provided.',
            content: {
              gapType: 'missing_model_evidence',
              message: 'No model/table evidence was reachable from this context.',
              source_mapping: ['source_document_1'],
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('string-source-links'),
    }))

    const savedItem = db.select().from(documentItems)
      .where(and(
        eq(documentItems.documentId, String(result.document.savedDocumentId)),
        eq(documentItems.itemType, 'data_gap'),
        eq(documentItems.stableKey, 'dd:missing-model-evidence'),
      ))
      .get()
    const links = savedItem
      ? db.select().from(documentItemDocumentLinks)
        .where(eq(documentItemDocumentLinks.fromItemId, savedItem.id))
        .all()
      : []
    expect(result.task.status).toBe('saved')
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toDocumentId: 'doc:orders-api',
        linkType: 'source_document',
        role: 'primary',
      }),
    ]))
  })

  it('updates a matching canonical baseline and marks omitted items stale', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:br:orders',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:base',
    })
    seedDocumentItem(db, {
      id: 'item:old',
      documentId: 'doc:br:orders',
      itemType: 'business_rule',
      stableKey: 'rule:old',
    })
    seedDocumentItem(db, {
      id: 'item:kept',
      documentId: 'doc:br:orders',
      itemType: 'business_rule',
      stableKey: 'rule:kept',
    })
    seedDocumentItem(db, {
      id: 'item:legacy-type',
      documentId: 'doc:br:orders',
      itemType: 'legacy_rule',
      stableKey: 'legacy:old',
    })
    const runId = startRun(db, { forceRegenerate: true })
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      baseContentHash: 'hash:base',
      items: [
        item('rule:kept', 1, { title: 'Kept updated' }),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('update'),
    }))

    expect(result).toMatchObject({
      task: { status: 'saved' },
      document: {
        savedDocumentId: 'doc:br:orders',
        operation: 'update',
        proposalId: null,
      },
    })
    expect(db.select().from(documents)
      .where(eq(documents.id, 'doc:br:orders'))
      .get()?.contentHash).toBe(result.submit.contentHash)
    expect(db.select().from(documentItems)
      .where(eq(documentItems.id, 'item:old'))
      .get()?.status).toBe('stale')
    expect(db.select().from(documentItems)
      .where(eq(documentItems.id, 'item:kept'))
      .get()?.status).toBe('active')
    expect(db.select().from(documentItems)
      .where(eq(documentItems.id, 'item:legacy-type'))
      .get()?.status).toBe('stale')
  })

  it('uses the leased existing canonical hash when the submitted document omits baseContentHash', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:br:orders',
      type: 'br',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:base',
    })
    const runId = startRun(db, { forceRegenerate: true })
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      items: [
        item('rule:kept', 1, { title: 'Kept updated' }),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('update-from-context-baseline'),
    }))

    expect(result).toMatchObject({
      task: { status: 'saved' },
      document: {
        savedDocumentId: 'doc:br:orders',
        operation: 'update',
        proposalId: null,
      },
    })
    expect(db.select().from(documentProposals).all()).toHaveLength(0)
  })

  it('creates a proposal when the canonical baseline is stale', () => {
    const db = createRunnableProject()
    seedExistingBusinessDocument(db, {
      id: 'doc:design:orders',
      type: 'design',
      scope: 'epic',
      scopeId: 'epic:orders',
      contentHash: 'hash:base',
      content: { title: 'Old design' },
    })
    const runId = startRun(db, { forceRegenerate: true })
    db.update(documents)
      .set({ contentHash: 'hash:changed', content: { title: 'Changed by user' }, updatedAt: later })
      .where(eq(documents.id, 'doc:design:orders'))
      .run()
    const task = leaseOne(db, runId, 'system_design')
    const document = validDocumentFor(db, task, {
      baseContentHash: 'hash:base',
      items: [
        {
          itemType: 'design_component',
          stableKey: 'design:orders',
          ordinal: 1,
          title: 'Orders design',
          summary: 'Orders design component.',
          content: {
            component: 'Orders',
            responsibility: 'Handle order source behavior.',
            flow: ['Read order source.'],
            integration_points: ['Orders API'],
            source_mapping: [
              {
                sourceRef: 'source_document_1',
                role: 'primary',
                reason: 'Orders API source evidence.',
              },
            ],
            relationConfidence: 'direct_call_proven',
          },
        },
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('proposal'),
    }))

    expect(result).toMatchObject({
      task: { status: 'proposal_created' },
      document: {
        savedDocumentId: null,
        proposalId: expect.any(String),
        operation: 'proposal_update',
        baseDocumentId: 'doc:design:orders',
      },
    })
    expect(db.select().from(documents)
      .where(eq(documents.id, 'doc:design:orders'))
      .get()?.content).toEqual({ title: 'Changed by user' })
    const proposal = db.select().from(documentProposals)
      .where(eq(documentProposals.id, String(result.document.proposalId)))
      .get()
    expect(proposal).toMatchObject({
      projectId,
      type: 'design',
      scope: 'epic',
      scopeId: 'epic:orders',
      operation: 'update',
      status: 'pending',
      sourceRunId: runId,
    })
  })

  it('stamps sync source provenance and returns the canonical business document to fresh', () => {
    const db = createRunnableProject()
    const runId = startSyncRunWithStaleBusinessRule(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      baseContentHash: 'hash:doc:orders-br',
      items: [item('rule:sync-provenance', 1)],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('submit'),
    }))

    const saved = db.select().from(documents).where(eq(documents.id, result.document.savedDocumentId!)).get()
    expect(saved).toMatchObject({
      status: 'active',
      validity: 'fresh',
      documentSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      staticSnapshotId: 'snapshot:new',
      sourceRunId: runId,
      updatedBy: 'llm',
    })
  })

  it('creates a proposal for a user-edited stale business document instead of overwriting', () => {
    const db = createRunnableProject()
    const runId = startSyncRunWithStaleBusinessRule(db)
    db.update(documents)
      .set({ updatedBy: 'user', contentHash: 'user-edit-hash' })
      .where(eq(documents.id, 'doc:orders-br'))
      .run()
    const task = leaseOne(db, runId, 'business_rules')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        baseContentHash: 'user-edit-hash',
        items: [item('rule:user-edited-stale', 1)],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('proposal'),
    }))

    expect(result.document.operation).toBe('proposal_update')
    expect(db.select().from(documentProposals).all()).toHaveLength(1)
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()).toMatchObject({
      updatedBy: 'user',
      validity: 'stale',
    })
  })

  it('reuses an orphaned canonical row when the same target is regenerated', () => {
    const db = createRunnableProject()
    seedBusinessDocument(db, {
      id: 'doc:orders-br',
      type: 'br',
      status: 'deleted',
      validity: 'orphaned',
      documentSourceHash: 'old-source',
    })
    const runId = startSyncRunForMissingBusinessRule(db)
    const task = leaseOne(db, runId, 'business_rules')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        items: [item('rule:orphaned-reuse', 1)],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('reuse'),
    }))

    expect(result.document.savedDocumentId).toBe('doc:orders-br')
    expect(db.select().from(documents).where(eq(documents.id, 'doc:orders-br')).get()).toMatchObject({
      status: 'active',
      validity: 'fresh',
    })
  })

  it('treats initial UCL as checkpoint-only and unlocks the refine context', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'use_case_list')
    const clusterIds = sourceClusterIdsFor(db, task)
    const document = validDocumentFor(db, task, {
      items: [
        useCaseItem('uc:create-order', 1, clusterIds),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('ucl'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'saved',
      },
      document: {
        savedDocumentId: null,
        operation: 'checkpoint_only',
      },
      downstream: {
        contextsUnlocked: 1,
      },
    })
    expect(countBusinessDocuments(db)).toBe(0)

    const refineTask = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'use_case_list_refine'))
      .get()
    expect(refineTask).toBeTruthy()
    const refineBundle = db.select().from(businessDocContextBundles)
      .where(eq(businessDocContextBundles.taskId, String(refineTask?.id)))
      .get()
    expect(refineBundle?.manifestJson).toMatchObject({
      dependencyPagesReady: true,
      deferredPages: [],
    })
    expect(refineBundle?.manifestJson.pageTokens).toContain('upstream_business_docs')

    const refineLease = leaseOne(db, runId, 'use_case_list_refine')
    expect(refineLease.taskType).toBe('use_case_list_refine')
  })

  it('saves final UCL and creates ready use-case-spec tasks', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const initial = leaseOne(db, runId, 'use_case_list')
    const initialClusterIds = sourceClusterIdsFor(db, initial)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: initial.id,
      leaseToken: initial.leaseToken,
      attemptNo: initial.attemptNo,
      document: validDocumentFor(db, initial, {
        items: [
          useCaseItem('uc:create-order', 1, initialClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('initial-ucl'),
    }))

    const refine = leaseOne(db, runId, 'use_case_list_refine')
    const refineClusterIds = sourceClusterIdsFor(db, refine)
    seedExistingBusinessDocument(db, {
      id: 'doc:existing-create-order-ucs',
      type: 'ucs',
      scope: 'use_case',
      scopeId: 'epic:epic:orders:use_case:uc:create-order',
      contentHash: 'hash:existing-create-order-ucs',
    })
    const finalUcl = validDocumentFor(db, refine, {
      items: [
        useCaseItem('uc:create-order', 1, refineClusterIds),
        useCaseItem('uc:cancel-order', 2, refineClusterIds),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: refine.id,
      leaseToken: refine.leaseToken,
      attemptNo: refine.attemptNo,
      document: finalUcl,
      now: fixedNow,
      makeId: makeSequentialIds('final-ucl'),
    }))

    expect(result).toMatchObject({
      task: { status: 'saved' },
      document: {
        savedDocumentId: expect.any(String),
        operation: 'create',
      },
      downstream: {
        ucsTasksCreated: 2,
      },
    })

    const ucsTasks = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'use_case_spec'))
      .all()
    expect(ucsTasks.map((taskRow) => taskRow.targetKey).sort()).toEqual([
      'epic:epic:orders:use_case_spec:uc:cancel-order',
      'epic:epic:orders:use_case_spec:uc:create-order',
    ])
    expect(ucsTasks.every((taskRow) => taskRow.status === 'pending')).toBe(true)
    expect(ucsTasks.map((taskRow) => ({ scope: taskRow.scope, scopeId: taskRow.scopeId })).sort((a, b) => a.scopeId.localeCompare(b.scopeId))).toEqual([
      { scope: 'use_case', scopeId: 'epic:epic:orders:use_case:uc:cancel-order' },
      { scope: 'use_case', scopeId: 'epic:epic:orders:use_case:uc:create-order' },
    ])
    for (const ucsTask of ucsTasks) {
      const bundle = db.select().from(businessDocContextBundles)
        .where(eq(businessDocContextBundles.taskId, ucsTask.id))
        .get()
      expect(bundle?.manifestJson.dependencyPagesReady).toBe(true)
      expect(bundle?.manifestJson.pageTokens).toEqual(expect.arrayContaining([
        'target',
        'schema',
        'upstream_business_docs',
        'source_graph_projection',
      ]))
    }

    const createOrderTask = ucsTasks.find((taskRow) => taskRow.scopeId === 'epic:epic:orders:use_case:uc:create-order')
    expect(createOrderTask).toBeDefined()
    const createOrderBundle = db.select().from(businessDocContextBundles)
      .where(eq(businessDocContextBundles.taskId, createOrderTask!.id))
      .get()
    expect(createOrderBundle?.manifestJson.pageTokens).toContain('existing_canonical')
    const existingPage = db.select().from(businessDocContextPages)
      .where(and(
        eq(businessDocContextPages.contextHandle, createOrderBundle!.contextHandle),
        eq(businessDocContextPages.pageToken, 'existing_canonical'),
      ))
      .get()
    expect(existingPage?.contentJson.document).toMatchObject({
      documentType: 'ucs',
      contentHash: 'hash:existing-create-order-ucs',
      contentProjection: 'metadata_only',
    })

    const leasedUcs = leaseUseCaseSpec(db, runId, 'uc:create-order')
    const leasedUcsEvidenceIds = sourceGraphEvidenceIdsFor(db, leasedUcs)
    const updateResult = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: leasedUcs.id,
      leaseToken: leasedUcs.leaseToken,
      attemptNo: leasedUcs.attemptNo,
      document: validDocumentFor(db, leasedUcs, {
        baseContentHash: 'hash:existing-create-order-ucs',
        items: [
          {
            itemType: 'use_case_spec',
            stableKey: 'uc:create-order',
            ordinal: 1,
            title: 'Create order',
            summary: 'Create order UCS.',
            content: {
              actor: 'Customer',
              trigger: 'When the customer submits an order',
              preconditions: ['The order source graph is available.'],
              main_success_flow: ['The system creates the order.'],
              alternatives: ['The customer may update the order.'],
              exceptions: ['Invalid orders are rejected.'],
              business_rules: ['Orders require valid source evidence.'],
              source_mapping: [
                {
                  sourceRef: 'source_document_1',
                  role: 'primary',
                  reason: 'The source graph maps this UCS to the orders API.',
                },
              ],
              uncertainty: [],
            },
            evidenceIds: leasedUcsEvidenceIds.slice(0, 1),
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucs-update'),
    }))
    expect(updateResult).toMatchObject({
      task: { status: 'saved' },
      document: {
        savedDocumentId: 'doc:existing-create-order-ucs',
        operation: 'update',
      },
    })
  })

  it('derives final UCL use cases from submitted items when canonical use_cases are placeholders', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const initial = leaseOne(db, runId, 'use_case_list')
    const initialClusterIds = sourceClusterIdsFor(db, initial)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: initial.id,
      leaseToken: initial.leaseToken,
      attemptNo: initial.attemptNo,
      document: validDocumentFor(db, initial, {
        items: [
          useCaseItem('uc:create-order', 1, initialClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('initial-ucl-placeholder'),
    }))

    const refine = leaseOne(db, runId, 'use_case_list_refine')
    const refineClusterIds = sourceClusterIdsFor(db, refine)
    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: refine.id,
      leaseToken: refine.leaseToken,
      attemptNo: refine.attemptNo,
      document: validDocumentFor(db, refine, {
        content: {
          evidence_gaps: ['source evidence is partial'],
          use_cases: [{}],
        },
        items: [
          useCaseItem('uc:create-order', 1, refineClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('final-ucl-placeholder'),
    }))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(result.task.status).toBe('saved')
    expect(saved?.content).toMatchObject({
      content: {
        use_cases: [
          expect.objectContaining({
            use_case_id: 'uc:create-order',
            title: 'uc:create-order',
            goal: 'uc:create-order goal',
          }),
        ],
      },
    })
  })

  it('derives design sequence diagrams from submitted items when canonical diagrams are placeholders', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'system_design')
    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        content: {
          evidence_gaps: ['source evidence is partial'],
          sequence_diagrams: [{}],
        },
        items: [
          {
            itemType: 'component',
            stableKey: 'design:payment-flow',
            ordinal: 1,
            title: 'Payment flow',
            summary: 'Payment orchestration.',
            content: {
              component: 'Payment service',
              responsibility: 'Coordinates payment validation.',
              flow: ['Receive request', 'Validate payment'],
              integration_points: ['Orders'],
              source_mapping: [
                {
                  sourceRef: 'source_document_1',
                  role: 'primary',
                  reason: 'Orders API source evidence.',
                },
              ],
              relationConfidence: 'direct_call_proven',
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('design-placeholder'),
    }))

    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(result.task.status).toBe('saved')
    expect(saved?.content).toMatchObject({
      content: {
        sequence_diagrams: [
          expect.objectContaining({
            title: 'Payment flow',
            uc_hint: 'Payment orchestration.',
          }),
        ],
      },
    })
  })

  it('materializes UCS item source links from source graph projection refs', () => {
    const db = createRunnableProject()
    seedLowerDocument(db, { id: 'doc:orders-screen', type: 'screen_spec' })
    linkEpicDocument(db, {
      epicId: 'epic:orders',
      documentId: 'doc:orders-screen',
      documentType: 'screen_spec',
      role: 'supporting',
    })
    const runId = startRun(db)
    const initial = leaseOne(db, runId, 'use_case_list')
    const initialClusterIds = sourceClusterIdsFor(db, initial)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: initial.id,
      leaseToken: initial.leaseToken,
      attemptNo: initial.attemptNo,
      document: validDocumentFor(db, initial, {
        items: [
          useCaseItem('uc:create-order', 1, initialClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucs-link-initial-ucl'),
    }))

    const refine = leaseOne(db, runId, 'use_case_list_refine')
    const refineClusterIds = sourceClusterIdsFor(db, refine)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: refine.id,
      leaseToken: refine.leaseToken,
      attemptNo: refine.attemptNo,
      document: validDocumentFor(db, refine, {
        items: [
          useCaseItem('uc:create-order', 1, refineClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucs-link-final-ucl'),
    }))

    const ucs = leaseUseCaseSpec(db, runId, 'uc:create-order')
    const sourceCardsPage = db.select().from(businessDocContextPages)
      .where(and(
        eq(businessDocContextPages.contextHandle, ucs.contextHandle),
        eq(businessDocContextPages.pageToken, 'source_document_cards'),
      ))
      .get()
    const sourceGraphEvidenceIds = sourceGraphEvidenceIdsFor(db, ucs)
    expect(sourceCardsPage).toBeUndefined()
    expect(sourceGraphEvidenceIds.length).toBeGreaterThan(0)
    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: ucs.id,
      leaseToken: ucs.leaseToken,
      attemptNo: ucs.attemptNo,
      document: validDocumentFor(db, ucs, {
        items: [
          {
            itemType: 'use_case_spec',
            stableKey: 'uc:create-order',
            ordinal: 1,
            title: 'Create order',
            summary: 'Create order from source graph evidence.',
            content: {
              actor: 'Customer',
              trigger: 'When the customer submits an order',
              preconditions: ['The customer has a cart.'],
              main_success_flow: ['The system validates and creates the order.'],
              alternatives: ['The customer may update the cart before submit.'],
              exceptions: ['Invalid carts are rejected.'],
              business_rules: ['Orders require a valid cart.'],
              source_mapping: [
                {
                  sourceRef: 'source_document_1',
                  role: 'primary',
                  reason: 'The source graph maps this use case to the orders API.',
                },
              ],
              uncertainty: [],
            },
            evidenceIds: sourceGraphEvidenceIds.slice(0, 1),
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucs-source-graph-links'),
    }))

    const savedUcsItem = db.select().from(documentItems)
      .where(and(
        eq(documentItems.documentId, String(result.document.savedDocumentId)),
        eq(documentItems.itemType, 'use_case_spec'),
        eq(documentItems.stableKey, 'uc:create-order'),
      ))
      .get()
    const links = savedUcsItem
      ? db.select().from(documentItemDocumentLinks)
        .where(eq(documentItemDocumentLinks.fromItemId, savedUcsItem.id))
        .all()
      : []
    expect(result.task.status).toBe('saved')
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toDocumentId: 'doc:orders-api',
        linkType: 'source_document',
        role: 'primary',
      }),
      expect.objectContaining({
        toDocumentId: 'doc:orders-screen',
        linkType: 'source_document',
        role: 'supporting',
      }),
    ]))
  })

  it('requests repair when final UCL does not cover source coverage clusters', () => {
    const db = createRunnableProject()
    seedLowerDocument(db, {
      id: 'doc:admin-screen',
      type: 'screen_spec',
      content: {
        title: 'Admin review screen',
        identity: { route_path: '/admin/reviews', screen_name: 'AdminReviewPage' },
      },
    })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:admin-screen', documentType: 'screen_spec' })
    const runId = startRun(db)
    const initial = leaseOne(db, runId, 'use_case_list')
    const clusters = sourceClusterIdsFor(db, initial)
    expect(clusters.length).toBeGreaterThan(1)

    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: initial.id,
      leaseToken: initial.leaseToken,
      attemptNo: initial.attemptNo,
      document: validDocumentFor(db, initial, {
        items: [
          useCaseItem('uc:create-order', 1, clusters),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('initial-ucl'),
    }))

    const refine = leaseOne(db, runId, 'use_case_list_refine')
    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: refine.id,
      leaseToken: refine.leaseToken,
      attemptNo: refine.attemptNo,
      document: validDocumentFor(db, refine, {
        items: [
          useCaseItem('uc:create-order', 1, clusters.slice(0, 1)),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('missing-coverage'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'repair_requested',
      },
      nextAction: {
        type: 'repair_task',
      },
    })
    expect(result.submit.validationErrorCount).toBeGreaterThanOrEqual(1)
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, refine.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('SOURCE_COVERAGE_MISSING')
  })

  it('requests repair when a business document is only a source-card catalog', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const evidenceIds = allowedEvidenceIds(db, task)

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        items: [
          item('source-1', 1, {
            itemType: 'business_rule',
            content: {
              sourceRef: 'source_document_1',
              documentType: 'api_spec',
              sourceTitle: 'Orders API',
              sourceSummary: 'Orders API summary',
              sourceIdentity: { method: 'POST', path: '/orders' },
              epicLink: { role: 'owner', reason: 'orders', confidence: 'high' },
            },
            evidenceIds: evidenceIds.slice(0, 1),
          }),
          item('source-2', 2, {
            itemType: 'business_rule',
            content: {
              sourceRef: 'source_document_2',
              documentType: 'screen_spec',
              sourceTitle: 'Orders page',
              sourceSummary: 'Orders page summary',
              sourceIdentity: { routePath: '/orders' },
              epicLink: { role: 'primary', reason: 'orders', confidence: 'high' },
            },
            evidenceIds: evidenceIds.slice(1, 2),
          }),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('catalog-only'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'repair_requested',
      },
      nextAction: {
        type: 'repair_task',
      },
    })
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('DOCUMENT_QUALITY_INSUFFICIENT')
  })

  it('requests repair when a SOT business document has no active items', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, { items: [] }),
      now: fixedNow,
      makeId: makeSequentialIds('missing-items'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'repair_requested',
      },
    })
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('DOCUMENT_QUALITY_INSUFFICIENT')
  })

  it('requests repair when an item has no resolvable source mapping or evidence', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document: validDocumentFor(db, task, {
        items: [
          item('rule:unlinked', 1, {
            content: {
              earsPattern: 'event_driven',
              condition: 'When an order is submitted',
              rule: 'the system shall validate the order',
              outcome: 'invalid orders are rejected',
              ownership: 'owned_by_epic',
              source_mapping: [],
            },
            evidenceIds: [],
          }),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('unlinked-item'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'repair_requested',
      },
    })
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('SOURCE_RELATION_UNSUPPORTED')
  })

  it('requests repair for document-type-specific SOT quality failures', () => {
    const cases = [
      {
        taskType: 'business_rules',
        expectedCode: 'BR_QUALITY_INSUFFICIENT',
        item: item('rule:summary-only', 1, {
          itemType: 'business_rule',
          content: { sourceSummary: 'Orders require payment.' },
        }),
      },
      {
        taskType: 'data_dictionary',
        expectedCode: 'DD_QUALITY_INSUFFICIENT',
        item: item('dd:endpoint', 1, {
          itemType: 'data_entity',
          content: { endpoint: 'GET /orders', summary: 'Orders API' },
        }),
      },
      {
        taskType: 'system_design',
        expectedCode: 'DESIGN_QUALITY_INSUFFICIENT',
        item: item('design:source', 1, {
          itemType: 'design_component',
          content: { sourceRef: 'source_document_1' },
        }),
      },
    ] as const

    for (const testCase of cases) {
      const db = createRunnableProject()
      const runId = startRun(db)
      const task = leaseOne(db, runId, testCase.taskType)

      const result = mustSubmit(submitBusinessDocsTask(db, {
        projectId,
        taskId: task.id,
        leaseToken: task.leaseToken,
        attemptNo: task.attemptNo,
        document: validDocumentFor(db, task, {
          items: [testCase.item],
        }),
        now: fixedNow,
        makeId: makeSequentialIds(`quality:${testCase.taskType}`),
      }))

      expect(result).toMatchObject({
        task: {
          status: 'repair_requested',
        },
      })
      const stored = db.select().from(businessDocGenerationTasks)
        .where(eq(businessDocGenerationTasks.id, task.id))
        .get()
      expect(JSON.stringify(stored?.validationErrors)).toContain(testCase.expectedCode)
    }
  })

  it('requests repair when a UCS is missing answer-ready sections', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const initial = leaseOne(db, runId, 'use_case_list')
    const initialClusterIds = sourceClusterIdsFor(db, initial)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: initial.id,
      leaseToken: initial.leaseToken,
      attemptNo: initial.attemptNo,
      document: validDocumentFor(db, initial, {
        items: [
          useCaseItem('uc:create-order', 1, initialClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('thin-ucs-initial-ucl'),
    }))

    const refine = leaseOne(db, runId, 'use_case_list_refine')
    const refineClusterIds = sourceClusterIdsFor(db, refine)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: refine.id,
      leaseToken: refine.leaseToken,
      attemptNo: refine.attemptNo,
      document: validDocumentFor(db, refine, {
        items: [
          useCaseItem('uc:create-order', 1, refineClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('thin-ucs-final-ucl'),
    }))

    const ucs = leaseUseCaseSpec(db, runId, 'uc:create-order')
    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: ucs.id,
      leaseToken: ucs.leaseToken,
      attemptNo: ucs.attemptNo,
      document: validDocumentFor(db, ucs, {
        items: [
          {
            itemType: 'use_case_spec',
            stableKey: 'uc:create-order',
            ordinal: 1,
            title: 'Create order',
            summary: 'Thin UCS',
            content: {
              goal: 'Create an order.',
              flow: ['Submit cart.'],
              source_mapping: ['source_document_1'],
              business_rule: ['Order requires cart.'],
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('thin-ucs'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'repair_requested',
      },
    })
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, ucs.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('UCS_QUALITY_INSUFFICIENT')
  })

  it('requests repair when final UCL use cases omit ownership coverage metadata', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const initial = leaseOne(db, runId, 'use_case_list')
    const initialClusterIds = sourceClusterIdsFor(db, initial)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: initial.id,
      leaseToken: initial.leaseToken,
      attemptNo: initial.attemptNo,
      document: validDocumentFor(db, initial, {
        items: [
          useCaseItem('uc:create-order', 1, initialClusterIds),
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucl-ownership-initial'),
    }))

    const refine = leaseOne(db, runId, 'use_case_list_refine')
    const refineClusterIds = sourceClusterIdsFor(db, refine)
    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: refine.id,
      leaseToken: refine.leaseToken,
      attemptNo: refine.attemptNo,
      document: validDocumentFor(db, refine, {
        items: [
          {
            ...useCaseItem('uc:create-order', 1, refineClusterIds),
            content: {
              useCaseId: 'uc:create-order',
              goal: 'Create order',
              sourceClusterIds: refineClusterIds,
            },
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucl-ownership'),
    }))

    expect(result).toMatchObject({
      task: {
        status: 'repair_requested',
      },
    })
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, refine.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('UCL_QUALITY_INSUFFICIENT')
  })

  it('rejects a business doc whose summary leaks technical language (v3 contamination)', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      summary: 'OrderController exposes /api/orders for fulfillment.',
      content: {
        rules: [
          { id: 'R1', statement: 'Orders must be paid before fulfillment.' },
        ],
      },
      items: [item('rule:leak', 1)],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('leak'),
    }))

    expect(result.task.status).toBe('repair_requested')
    expect(result.document.savedDocumentId).toBeNull()
    expect(countBusinessDocuments(db)).toBe(0)
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(stored?.savedDocumentId).toBeNull()
    expect(stored?.validationErrors?.map((error) => error.code)).toContain('SOT_VALIDATION_FAILED')
    expect(stored?.validationErrors?.some((error) => error.message.includes('BUSINESS_LANGUAGE_CONTAMINATION'))).toBe(true)
  })

  it('rejects a br doc with an empty core array and no evidence_gaps (v3 empty core)', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      content: {
        rules: [],
      },
      items: [item('rule:empty-core', 1)],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('empty'),
    }))

    expect(result.task.status).toBe('repair_requested')
    expect(countBusinessDocuments(db)).toBe(0)
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(stored?.validationErrors?.map((error) => error.code)).toContain('SOT_VALIDATION_FAILED')
    expect(stored?.validationErrors?.some((error) => error.message.includes('EMPTY_CORE_ITEMS'))).toBe(true)
  })

  it('requests repair instead of throwing when br core rules omit statement', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      content: {
        rules: [
          { id: 'R1', rule: 'Orders must be paid before fulfillment begins.', pattern: 'state_driven' },
        ],
      },
      items: [item('rule:malformed-core', 1)],
    } as Partial<BusinessDocsSubmittedDocument>)

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('malformed-core'),
    }))

    expect(result.task.status).toBe('repair_requested')
    expect(countBusinessDocuments(db)).toBe(0)
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, task.id))
      .get()
    expect(stored?.validationErrors?.map((error) => error.code)).toContain('SOT_VALIDATION_FAILED')
    expect(stored?.validationErrors?.some((error) => error.message.includes('MISSING_REQUIRED_FIELD'))).toBe(true)
    expect(stored?.validationErrors?.some((error) => error.path === '$.content.rules[0].statement')).toBe(true)
  })

  it('saves a clean, well-formed br doc with real rules (v3 passes)', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      summary: 'Rules that govern order fulfillment and payment.',
      content: {
        rules: [
          { id: 'R1', statement: 'Orders must be paid before fulfillment begins.', pattern: 'state_driven' },
          { id: 'R2', statement: 'Cancelled orders cannot be fulfilled.', pattern: 'unwanted_behavior' },
        ],
      },
      items: [
        item('rule:payment', 1),
        item('rule:cancelled', 2),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('clean'),
    }))

    expect(result.task.status).toBe('saved')
    expect(result.document.operation).toBe('create')
    expect(result.document.savedDocumentId).toEqual(expect.any(String))
    const saved = db.select().from(documents)
      .where(eq(documents.id, String(result.document.savedDocumentId)))
      .get()
    expect(saved?.status).toBe('active')
  })

  it('does not false-reject a valid doc when systemSourceDocIds are present (link coverage)', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    // Stamp systemSourceDocIds on the task context pages as Phase A would.
    stampSystemSourceDocIds(db, task.contextHandle, ['doc:orders-api'])
    const document = validDocumentFor(db, task, {
      summary: 'Rules that govern order fulfillment.',
      content: {
        rules: [
          { id: 'R1', statement: 'Orders must be paid before fulfillment begins.', pattern: 'state_driven' },
        ],
      },
      items: [item('rule:coverage', 1)],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('coverage'),
    }))

    expect(result.task.status).toBe('saved')
    expect(result.document.savedDocumentId).toEqual(expect.any(String))
  })

  it('replays identical submits idempotently and rejects changed replay content', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    const document = validDocumentFor(db, task, {
      items: [
        item('rule:idempotent', 1),
      ],
    })
    const input = {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('idem'),
    }

    const first = mustSubmit(submitBusinessDocsTask(db, input))
    const replay = mustSubmit(submitBusinessDocsTask(db, input))

    expect(first.submit.idempotent).toBe(false)
    expect(replay).toMatchObject({
      task: { status: 'saved' },
      submit: {
        idempotent: true,
        contentHash: first.submit.contentHash,
      },
      document: {
        savedDocumentId: first.document.savedDocumentId,
      },
    })
    expect(countBusinessDocuments(db)).toBe(1)

    const changed = submitBusinessDocsTask(db, {
      ...input,
      document: {
        ...document,
        summary: 'Changed replay content',
      },
    })
    expect(changed).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_SUBMIT_NOT_IDEMPOTENT',
    })
  })

  it('materializes the SOT output graph (derives_from links + item links + FTS + versions) when a business doc is saved', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    stampSystemSourceDocIds(db, task.contextHandle, ['doc:orders-api'])
    const document = validDocumentFor(db, task, {
      summary: 'Rules that govern order fulfillment and payment.',
      content: {
        rules: [
          { id: 'R1', statement: 'Orders must be paid before fulfillment begins.', pattern: 'state_driven' },
          { id: 'R2', statement: 'Cancelled orders cannot be fulfilled.', pattern: 'unwanted_behavior' },
        ],
      },
      items: [
        item('rule:payment', 1),
        item('rule:fulfillment', 2),
      ],
    })

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('graph'),
    }))
    const savedDocumentId = String(result.document.savedDocumentId)

    // document_versions: first save = versionNo 1.
    const versions = db.select().from(documentVersions)
      .where(eq(documentVersions.documentId, savedDocumentId))
      .all()
    expect(versions.map((row) => row.versionNo)).toEqual([1])

    // document_links: derives_from from the business doc to each systemSourceDocId.
    const links = db.select().from(documentLinks)
      .where(eq(documentLinks.fromDocumentId, savedDocumentId))
      .all()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      fromDocumentId: savedDocumentId,
      toDocumentId: 'doc:orders-api',
      linkType: 'derives_from',
      createdBy: 'system',
    })

    // document_item_document_links: derives_from / supporting per persisted item.
    const items = db.select().from(documentItems)
      .where(eq(documentItems.documentId, savedDocumentId))
      .all()
    expect(items).toHaveLength(2)
    const itemLinks = db.select().from(documentItemDocumentLinks).all()
    const derivesFromItemLinks = itemLinks.filter((row) => row.linkType === 'derives_from')
    const sourceDocumentItemLinks = itemLinks.filter((row) => row.linkType === 'source_document')
    expect(derivesFromItemLinks).toHaveLength(2)
    expect(sourceDocumentItemLinks).toHaveLength(2)
    expect(derivesFromItemLinks.every((row) => row.role === 'supporting')).toBe(true)
    expect(derivesFromItemLinks.map((row) => row.fromItemId).sort()).toEqual(items.map((row) => row.id).sort())
    expect(itemLinks.every((row) => row.toDocumentId === 'doc:orders-api')).toBe(true)

    // document_items_fts: one indexed row per item.
    const ftsRows = db.all(sql`SELECT item_id FROM document_items_fts WHERE project_id = ${projectId}`) as Array<{ item_id: string }>
    expect(ftsRows.map((row) => row.item_id).sort()).toEqual(items.map((row) => row.id).sort())
    const ftsHit = db.all(sql`SELECT item_id FROM document_items_fts WHERE document_items_fts MATCH ${'payment'}`) as Array<{ item_id: string }>
    expect(ftsHit.length).toBeGreaterThanOrEqual(1)
  })

  it('replaces (does not duplicate) the SOT graph on an idempotent re-save', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const task = leaseOne(db, runId, 'business_rules')
    stampSystemSourceDocIds(db, task.contextHandle, ['doc:orders-api'])
    const document = validDocumentFor(db, task, {
      summary: 'Rules that govern order fulfillment.',
      content: {
        rules: [
          { id: 'R1', statement: 'Orders must be paid before fulfillment begins.', pattern: 'state_driven' },
        ],
      },
      items: [item('rule:payment', 1)],
    })
    const input = {
      projectId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo,
      document,
      now: fixedNow,
      makeId: makeSequentialIds('graph-idem'),
    }

    const first = mustSubmit(submitBusinessDocsTask(db, input))
    mustSubmit(submitBusinessDocsTask(db, input))
    const savedDocumentId = String(first.document.savedDocumentId)

    expect(db.select().from(documentLinks)
      .where(eq(documentLinks.fromDocumentId, savedDocumentId))
      .all()).toHaveLength(1)
    expect(db.select().from(documentVersions)
      .where(eq(documentVersions.documentId, savedDocumentId))
      .all()).toHaveLength(1)
    const items = db.select().from(documentItems)
      .where(eq(documentItems.documentId, savedDocumentId))
      .all()
    expect(items).toHaveLength(1)
    expect(db.select().from(documentItemDocumentLinks).all()).toHaveLength(2)
    const ftsRows = db.all(sql`SELECT item_id FROM document_items_fts WHERE project_id = ${projectId}`) as Array<{ item_id: string }>
    expect(ftsRows).toHaveLength(1)
  })

  it('requests repair for a ucs with zero items', () => {
    const db = createRunnableProject()
    const runId = startRun(db)
    const initial = leaseOne(db, runId, 'use_case_list')
    const initialClusterIds = sourceClusterIdsFor(db, initial)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: initial.id,
      leaseToken: initial.leaseToken,
      attemptNo: initial.attemptNo,
      document: validDocumentFor(db, initial, { items: [useCaseItem('uc:create-order', 1, initialClusterIds)] }),
      now: fixedNow,
      makeId: makeSequentialIds('ucs-ucl'),
    }))
    const refine = leaseOne(db, runId, 'use_case_list_refine')
    const refineClusterIds = sourceClusterIdsFor(db, refine)
    const refineEvidenceIds = sourceGraphEvidenceIdsFor(db, refine)
    mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: refine.id,
      leaseToken: refine.leaseToken,
      attemptNo: refine.attemptNo,
      document: validDocumentFor(db, refine, {
        items: [
          {
            ...useCaseItem('uc:create-order', 1, refineClusterIds),
            evidenceIds: refineEvidenceIds,
          },
        ],
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucs-refine'),
    }))

    const ucsTask = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'use_case_spec'))
      .get()
    if (!ucsTask) throw new Error('Expected a use_case_spec task')
    const lease = leaseBusinessDocsTasks(db, {
      projectId,
      runId,
      workerId: 'worker:ucs',
      limit: 8,
      leaseTtlMs: 15 * 60 * 1000,
      now: fixedNow,
      makeLeaseToken: makeSequentialIds('lease:ucs'),
    })
    if (!lease.ok) throw new Error(`Expected lease ok, got ${lease.code}`)
    const ucsLease = lease.data.tasks.find((candidate) => candidate.taskType === 'use_case_spec')
    if (!ucsLease) throw new Error('Expected leased use_case_spec')
    stampSystemSourceDocIds(db, ucsLease.contextHandle, ['doc:orders-api'])

    const result = mustSubmit(submitBusinessDocsTask(db, {
      projectId,
      taskId: ucsLease.id,
      leaseToken: ucsLease.leaseToken,
      attemptNo: ucsLease.attemptNo,
      document: validDocumentFor(db, ucsLease, {
        scope: 'use_case',
        scopeId: 'uc:create-order',
        summary: 'How a customer creates an order.',
        content: { main_flow: ['Customer submits the order.'] },
      }),
      now: fixedNow,
      makeId: makeSequentialIds('ucs-save'),
    }))
    expect(result.task.status).toBe('repair_requested')
    expect(result.document.savedDocumentId).toBeNull()
    const stored = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.id, ucsLease.id))
      .get()
    expect(JSON.stringify(stored?.validationErrors)).toContain('DOCUMENT_QUALITY_INSUFFICIENT')
  })
})

function createRunnableProject(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedEpic(db, { id: 'epic:orders' })
  seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
  linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
  return db
}

function startRun(db: TestDb, input: { forceRegenerate?: boolean } = {}): string {
  const result = startBusinessDocsGeneration(db, {
    projectId,
    forceRegenerate: input.forceRegenerate,
    now: fixedNow,
    makeId: makeSequentialIds('start'),
  })
  if (!result.ok) throw new Error(`Expected start ok, got ${result.code}`)
  return result.data.run.id
}

function startSyncRunWithStaleBusinessRule(db: TestDb): string {
  seedBusinessDocument(db, {
    id: 'doc:orders-br',
    type: 'br',
    status: 'active',
    validity: 'stale',
    documentSourceHash: 'old-business-source',
    staticSnapshotId: 'snapshot:old',
    updatedBy: 'system',
  })
  const runId = startRun(db, { forceRegenerate: true })
  stampSyncMetadataForTaskType(db, runId, 'business_rules')
  return runId
}

function startSyncRunForMissingBusinessRule(db: TestDb): string {
  const runId = startRun(db)
  stampSyncMetadataForTaskType(db, runId, 'business_rules')
  return runId
}

function stampSyncMetadataForTaskType(db: TestDb, runId: string, taskType: string): void {
  const task = db.select().from(businessDocGenerationTasks)
    .where(and(
      eq(businessDocGenerationTasks.runId, runId),
      eq(businessDocGenerationTasks.taskType, taskType),
    ))
    .get()
  if (!task?.contextHandle) throw new Error(`Expected ${taskType} task context`)
  const targetPage = db.select().from(businessDocContextPages)
    .where(and(
      eq(businessDocContextPages.contextHandle, task.contextHandle),
      eq(businessDocContextPages.pageKind, 'target'),
    ))
    .get()
  if (!targetPage) throw new Error(`Expected ${taskType} target page`)
  db.update(businessDocContextPages)
    .set({
      contentJson: {
        ...targetPage.contentJson,
        sync: {
          sourceHash: syncSourceHash,
          staticSnapshotId: 'snapshot:new',
          reason: 'source_changed',
        },
      },
    })
    .where(and(
      eq(businessDocContextPages.contextHandle, task.contextHandle),
      eq(businessDocContextPages.pageToken, targetPage.pageToken),
    ))
    .run()
}

function leaseOne(db: TestDb, runId: string, taskType: string): BusinessDocsLeasedTask {
  const result = leaseBusinessDocsTasks(db, {
    projectId,
    runId,
    workerId: `worker:${taskType}`,
    limit: 8,
    leaseTtlMs: 15 * 60 * 1000,
    now: fixedNow,
    makeLeaseToken: makeSequentialIds(`lease:${taskType}`),
  })
  if (!result.ok) throw new Error(`Expected lease ok, got ${result.code}`)
  const task = result.data.tasks.find((candidate) => candidate.taskType === taskType)
  if (!task) throw new Error(`Expected leased ${taskType}`)
  return task
}

function leaseUseCaseSpec(db: TestDb, runId: string, scopeId: string): BusinessDocsLeasedTask {
  const result = leaseBusinessDocsTasks(db, {
    projectId,
    runId,
    workerId: `worker:use_case_spec:${scopeId}`,
    limit: 8,
    leaseTtlMs: 15 * 60 * 1000,
    now: fixedNow,
    makeLeaseToken: makeSequentialIds(`lease:use_case_spec:${scopeId}`),
  })
  if (!result.ok) throw new Error(`Expected lease ok, got ${result.code}`)
  const task = result.data.tasks.find((candidate) =>
    candidate.taskType === 'use_case_spec' &&
    candidate.scopeId === `epic:epic:orders:use_case:${scopeId}`)
  if (!task) throw new Error(`Expected leased use_case_spec ${scopeId}`)
  return task
}

function validDocumentFor(
  db: TestDb,
  task: BusinessDocsLeasedTask,
  overrides: Partial<BusinessDocsSubmittedDocument> = {},
): BusinessDocsSubmittedDocument {
  const evidenceIds = allowedEvidenceIds(db, task)
  return {
    schemaVersion: 'business-doc.v1',
    documentType: task.documentType,
    scope: task.scope,
    scopeId: task.scopeId,
    title: `${task.taskType} title`,
    summary: `${task.taskType} summary`,
    content: {
      taskType: task.taskType,
      body: `${task.taskType} body`,
      // Fixtures carry no real source bodies; declaring the gap keeps the
      // generic placeholder content valid under deterministic v3 validation.
      evidence_gaps: ['fixture provides no source content'],
    },
    evidenceIds: evidenceIds.slice(0, 1),
    ...overrides,
  }
}

function stampSystemSourceDocIds(db: TestDb, contextHandle: string, ids: string[]): void {
  const pages = db.select().from(businessDocContextPages)
    .where(eq(businessDocContextPages.contextHandle, contextHandle))
    .all()
  for (const page of pages) {
    if (page.pageToken !== 'target' && page.pageToken !== 'source_document_cards') continue
    db.update(businessDocContextPages)
      .set({ contentJson: { ...page.contentJson, systemSourceDocIds: ids } })
      .where(and(
        eq(businessDocContextPages.contextHandle, contextHandle),
        eq(businessDocContextPages.pageToken, page.pageToken),
      ))
      .run()
  }
}

function allowedEvidenceIds(db: TestDb, task: BusinessDocsLeasedTask): string[] {
  const result = getBusinessDocsContextBundle(db, {
    contextHandle: task.contextHandle,
    leaseToken: task.leaseToken,
    now: fixedNow,
  })
  if (!result.ok) throw new Error(`Expected context ok, got ${result.code}`)
  return result.data.pages.flatMap((page) => page.evidenceIds)
}

function sourceDocumentEvidenceIds(db: TestDb, task: BusinessDocsLeasedTask): string[] {
  const page = db.select().from(businessDocContextPages)
    .where(and(
      eq(businessDocContextPages.contextHandle, task.contextHandle),
      eq(businessDocContextPages.pageToken, 'source_document_cards'),
    ))
    .get()
  return page?.evidenceIdsJson ?? []
}

function sourceClusterIdsFor(db: TestDb, task: BusinessDocsLeasedTask): string[] {
  const page = db.select().from(businessDocContextPages)
    .where(and(
      eq(businessDocContextPages.contextHandle, task.contextHandle),
      eq(businessDocContextPages.pageToken, 'source_graph_projection'),
    ))
    .get()
  const clusters = page?.contentJson?.coverageOutline?.clusters
  if (!Array.isArray(clusters)) return []
  return clusters
    .map((cluster) => typeof cluster.clusterId === 'string' ? cluster.clusterId : null)
    .filter((clusterId): clusterId is string => clusterId !== null)
}

function sourceGraphEvidenceIdsFor(db: TestDb, task: BusinessDocsLeasedTask): string[] {
  const page = db.select().from(businessDocContextPages)
    .where(and(
      eq(businessDocContextPages.contextHandle, task.contextHandle),
      eq(businessDocContextPages.pageToken, 'source_graph_projection'),
    ))
    .get()
  return page?.evidenceIdsJson ?? []
}

function item(stableKey: string, ordinal: number, overrides: Record<string, unknown> = {}) {
  return {
    itemType: 'business_rule',
    stableKey,
    ordinal,
    title: stableKey,
    summary: `${stableKey} summary`,
    content: {
      stableKey,
      earsPattern: 'event_driven',
      condition: `When ${stableKey} is triggered`,
      rule: 'the system shall enforce the business rule',
      outcome: 'the request is accepted or rejected consistently',
      ownership: 'owned_by_epic',
      source_mapping: [
        {
          sourceRef: 'source_document_1',
          role: 'primary',
          reason: `${stableKey} source evidence`,
        },
      ],
    },
    ...overrides,
  }
}

function glossaryItem(itemType: string, term: string, evidenceIds: string[]) {
  return {
    itemType,
    stableKey: `term:${term}`,
    title: term,
    summary: `${term} definition`,
    content: {
      term,
      canonical_term: term,
      definition: `${term} definition`,
      termType: 'domain',
      source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'Defines the term.' }],
      aliases: [],
      synonyms: [],
      candidate_aliases: [],
      antonyms: [],
      contrast_terms: [],
      related_terms: [],
      signals: [],
      ambiguity: { status: 'none', candidates: [] },
    },
    evidenceIds,
  }
}

function useCaseItem(stableKey: string, ordinal: number, sourceClusterIds: string[] = []) {
  return {
    itemType: 'use_case',
    stableKey,
    ordinal,
    title: stableKey,
    summary: `${stableKey} summary`,
    content: {
      useCaseId: stableKey,
      goal: `${stableKey} goal`,
      sourceClusterIds,
      coverageRelation: 'owned_by_epic',
      ownedByEpic: true,
      primarySourceRefs: ['source_document_1'],
      supportingSourceRefs: [],
      crossEpicSourceRefs: [],
      relationEvidenceRefs: [],
      uncertainty: [],
    },
  }
}

function mustSubmit(
  result: { ok: true; data: BusinessDocsSubmitResult } | { ok: false; code: string },
): BusinessDocsSubmitResult {
  if (!result.ok) throw new Error(`Expected submit ok, got ${result.code}`)
  return result.data
}

function fixedNow(): Date {
  return new Date(now)
}

function makeSequentialIds(prefix: string): () => string {
  let next = 0
  return () => `${prefix}:${++next}`
}

function countSubmittedTasks(db: TestDb): number {
  return Number(db.select({ value: count() }).from(businessDocGenerationTasks)
    .where(eq(businessDocGenerationTasks.status, 'saved'))
    .get()?.value ?? 0)
}

function countBusinessDocuments(db: TestDb): number {
  return Number(db.select({ value: count() }).from(documents)
    .where(eq(documents.track, 'business'))
    .get()?.value ?? 0)
}

function seedProject(db: TestDb): void {
  db.insert(projects).values({
    id: projectId,
    name: 'Platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedEpic(
  db: TestDb,
  overrides: { id: string; confirmedAt?: string | null },
): void {
  db.insert(epics).values({
    id: overrides.id,
    projectId,
    name: overrides.id.replace('epic:', ''),
    abbr: 'EP',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: overrides.confirmedAt === undefined ? now : overrides.confirmedAt,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedLowerDocument(
  db: TestDb,
  input: {
    id: string
    type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
    content?: Record<string, unknown>
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'technical',
    scope: input.type,
    scopeId: input.id,
    status: 'active',
    validity: 'fresh',
    summary: input.id,
    content: input.content ?? { id: input.id },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedExistingBusinessDocument(
  db: TestDb,
  input: {
    id: string
    type: string
    scope: string
    scopeId: string
    contentHash: string
    content?: Record<string, unknown>
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'business',
    scope: input.scope,
    scopeId: input.scopeId,
    status: 'active',
    validity: 'fresh',
    summary: input.id,
    content: input.content ?? { id: input.id },
    rawLlmOutput: '',
    contentHash: input.contentHash,
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
}

function seedBusinessDocument(
  db: TestDb,
  input: {
    id: string
    type: string
    scope?: string
    scopeId?: string
    status?: string
    validity?: 'fresh' | 'stale' | 'orphaned'
    contentHash?: string
    documentSourceHash?: string
    staticSnapshotId?: string
    updatedBy?: 'system' | 'llm' | 'user'
    content?: Record<string, unknown>
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'business',
    scope: input.scope ?? 'epic',
    scopeId: input.scopeId ?? 'epic:orders',
    status: input.status ?? 'active',
    validity: input.validity ?? 'fresh',
    summary: input.id,
    content: input.content ?? { id: input.id },
    rawLlmOutput: '',
    contentHash: input.contentHash ?? `hash:${input.id}`,
    staticSnapshotId: input.staticSnapshotId ?? null,
    documentSourceHash: input.documentSourceHash ?? null,
    updatedBy: input.updatedBy ?? 'llm',
    updatedAt: now,
  }).run()
}

function seedDocumentItem(
  db: TestDb,
  input: {
    id: string
    documentId: string
    itemType: string
    stableKey: string
  },
): void {
  db.insert(documentItems).values({
    id: input.id,
    documentId: input.documentId,
    projectId,
    itemType: input.itemType,
    stableKey: input.stableKey,
    ordinal: 1,
    title: input.stableKey,
    summary: input.stableKey,
    content: { stableKey: input.stableKey },
    contentHash: `hash:${input.stableKey}`,
    status: 'active',
    createdBy: 'llm',
    updatedBy: 'llm',
    updatedAt: now,
  }).run()
}

function linkEpicDocument(
  db: TestDb,
  input: {
    epicId: string
    documentId: string
    documentType: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
    role?: string
    reason?: string
    confidence?: string
  },
): void {
  db.insert(epicDocumentLinks).values({
    epicId: input.epicId,
    documentId: input.documentId,
    documentType: input.documentType,
    role: input.role ?? 'primary',
    reason: input.reason ?? 'test link',
    confidence: input.confidence ?? 'high',
    createdAt: now,
  }).run()
}
