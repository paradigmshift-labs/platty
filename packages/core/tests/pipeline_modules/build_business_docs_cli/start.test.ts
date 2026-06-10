import { count, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { docRelationLinks, documents } from '../../../src/db/schema/build_docs.js'
import { models } from '../../../src/db/schema/build_models.js'
import { epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import { epics, projects, repositories } from '../../../src/db/schema/core.js'
import {
  businessDocContextBundles,
  businessDocContextPages,
  businessDocGenerationRuns,
  businessDocGenerationTasks,
} from '../../../src/db/schema/build_business_docs_generation.js'
import { startBusinessDocsGeneration } from '../../../src/pipeline_modules/build_business_docs_cli/start.js'

const projectId = 'project:platty'
const now = '2026-06-04T00:00:00.000Z'

type TestDb = ReturnType<typeof createTestDb>

describe('build_business_docs_cli start', () => {
  it('blocks when preview has no runnable EPICs and leaves generation tables empty', () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })

    const result = startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'BUSINESS_DOCS_START_BLOCKED',
      preview: {
        confirmedEpicCount: 1,
        selectedEpicCount: 0,
      },
    })
    expect(rowCount(db, businessDocGenerationRuns)).toBe(0)
    expect(rowCount(db, businessDocGenerationTasks)).toBe(0)
    expect(rowCount(db, businessDocContextBundles)).toBe(0)
    expect(rowCount(db, businessDocContextPages)).toBe(0)
  })

  it('creates one run, non-UCS tasks, and context snapshots for a runnable project', () => {
    const db = createRunnableProject()

    const result = startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
        project: { id: projectId, name: 'Platty' },
        run: {
          projectId,
          status: 'running',
          sourceCommit: 'unknown',
          forceRegenerate: false,
        },
        policy: {
          workerRuntime: 'external_cli',
          workerProvider: 'codex',
          maxRepairAttempts: 1,
          persistMode: 'incremental',
          judgeMode: 'off',
          outputLanguage: 'en',
        },
        preview: {
          selectedEpicCount: 1,
        },
        tasks: {
          total: 7,
          created: 7,
          skippedExisting: 0,
        },
        contexts: {
          bundlesCreated: 7,
          deferredDependencyContexts: 3,
        },
        nextAction: {
          type: 'lease_tasks',
        },
      },
    })

    const runs = db.select().from(businessDocGenerationRuns).all()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      projectId,
      status: 'running',
      sourceCommit: 'unknown',
      forceRegenerate: 0,
    })
    expect(runs[0].policyJson).toMatchObject({
      workerRuntime: 'external_cli',
      workerProvider: 'codex',
      maxRepairAttempts: 1,
      outputLanguage: 'en',
    })
    expect(runs[0].previewSnapshotJson).toMatchObject({
      selectedEpicCount: 1,
      estimatedTasks: { total: 7 },
    })
    expect(runs[0].selectedEpicIdsJson).toEqual(['epic:orders'])

    const tasks = db.select().from(businessDocGenerationTasks).all()
    expect(tasks.map((task) => task.taskType).sort()).toEqual([
      'business_rules',
      'data_dictionary',
      'epic_glossary',
      'project_glossary',
      'system_design',
      'use_case_list',
      'use_case_list_refine',
    ])
    expect(tasks.every((task) => task.status === 'pending')).toBe(true)
    expect(tasks.every((task) => task.contextHandle)).toBe(true)
    expect(tasks.some((task) => task.taskType === 'use_case_spec')).toBe(false)

    expect(rowCount(db, businessDocContextBundles)).toBe(tasks.length)
    expect(rowCount(db, businessDocContextPages)).toBeGreaterThanOrEqual(tasks.length * 3)

    const businessRules = tasks.find((task) => task.taskType === 'business_rules')
    const pages = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, businessRules!.contextHandle!))
      .all()
    const targetPage = pages.find((page) => page.pageKind === 'target')
    expect(targetPage?.contentJson).toMatchObject({
      outputLanguage: 'en',
      target: {
        epic: {
          id: 'epic:orders',
          name: 'Orders',
          stableKey: 'orders',
          summary: 'Order checkout and fulfillment.',
        },
      },
    })
    const sourcePage = pages.find((page) => page.pageKind === 'source_document_cards')
    expect(sourcePage?.contentJson).toMatchObject({
      cards: [
        expect.objectContaining({
          documentId: 'doc:orders-api',
          documentType: 'api_spec',
          scope: 'api_spec',
          scopeId: 'doc:orders-api',
          summary: 'Create an order from cart items.',
          contentProjection: 'source_graph_projection',
          epicLink: {
            role: 'primary',
            reason: 'test link',
            confidence: 'high',
          },
          facts: expect.objectContaining({
            identity: {
              method: 'POST',
              path: '/orders',
              handler: 'OrdersController.create',
            },
            flow: ['Validate cart', 'Persist order'],
            rules: ['Orders require at least one item.'],
            relations: {
              tables: [{ table: 'Order', operation: 'insert' }],
            },
          }),
        }),
      ],
    })
  })

  it('stores Korean output language in policy and target context when requested', () => {
    const db = createRunnableProject()

    const result = startBusinessDocsGeneration(db, {
      projectId,
      outputLanguage: 'ko',
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        policy: {
          outputLanguage: 'ko',
        },
      },
    })

    const run = db.select().from(businessDocGenerationRuns).get()
    expect(run?.policyJson).toMatchObject({ outputLanguage: 'ko' })
    const task = db.select().from(businessDocGenerationTasks).get()
    const targetPage = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, task!.contextHandle!))
      .all()
      .find((page) => page.pageKind === 'target')
    expect(targetPage?.contentJson).toMatchObject({ outputLanguage: 'ko' })
  })

  it('creates tasks only for selected EPIC ids when provided', () => {
    const db = createRunnableProject()
    seedEpic(db, {
      id: 'epic:benefits',
      name: 'Benefits',
      stableKey: 'benefits',
      summary: 'Benefit participation and missions.',
    })
    seedLowerDocument(db, {
      id: 'doc:benefits-screen',
      type: 'screen_spec',
      status: 'passed',
      summary: 'Benefit mission page.',
      content: {
        identity: {
          route_path: '/benefits',
          screen_name: 'BenefitMissionPage',
        },
      },
    })
    linkEpicDocument(db, {
      epicId: 'epic:benefits',
      documentId: 'doc:benefits-screen',
      documentType: 'screen_spec',
    })

    const result = startBusinessDocsGeneration(db, {
      projectId,
      selectedEpicIds: ['epic:benefits'],
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        preview: {
          confirmedEpicCount: 2,
          selectedEpicCount: 1,
          documentPlan: {
            perEpic: [
              expect.objectContaining({
                epicId: 'epic:benefits',
              }),
            ],
          },
        },
        tasks: {
          total: 7,
          created: 7,
        },
      },
    })

    const runs = db.select().from(businessDocGenerationRuns).all()
    expect(runs[0].selectedEpicIdsJson).toEqual(['epic:benefits'])
    const tasks = db.select().from(businessDocGenerationTasks).all()
    expect(tasks.filter((task) => task.scope === 'epic').every((task) => task.epicId === 'epic:benefits')).toBe(true)
    expect(tasks.filter((task) => task.scope === 'epic').some((task) => task.epicId === 'epic:orders')).toBe(false)
  })

  it('skips active business documents by default and does not write canonical documents', () => {
    const db = createRunnableProject()
    seedBusinessDocument(db, { id: 'business:design:orders', type: 'design', scopeId: 'epic:orders' })
    const beforeDocuments = rowCount(db, documents)

    const result = startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
        tasks: {
          total: 6,
          skippedExisting: 1,
        },
      },
    })
    const taskTypes = db.select().from(businessDocGenerationTasks).all().map((task) => task.taskType)
    expect(taskTypes).not.toContain('system_design')
    expect(taskTypes).not.toContain('use_case_spec')
    expect(rowCount(db, documents)).toBe(beforeDocuments)
  })

  it('creates tasks for active business documents when forceRegenerate is enabled', () => {
    const db = createRunnableProject()
    seedBusinessDocument(db, {
      id: 'business:design:orders',
      type: 'design',
      scopeId: 'epic:orders',
      summary: 'SELECT * FROM documents; open src/server/db.ts; /Users/pshift/private/platty.sqlite',
      content: {
        rawSql: 'SELECT * FROM canonical_documents',
        localSourceInstruction: 'open src/server/db.ts and read it directly',
      },
    })
    seedBusinessDocument(db, { id: 'business:dd:orders', type: 'data_dictionary', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:br:orders', type: 'br', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:ucl:orders', type: 'ucl', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:glossary:orders', type: 'glossary', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:project-glossary', type: 'glossary', scope: 'project', scopeId: projectId })

    const result = startBusinessDocsGeneration(db, {
      projectId,
      forceRegenerate: true,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
        run: { forceRegenerate: true },
        tasks: {
          total: 7,
          skippedExisting: 0,
        },
      },
    })
    expect(db.select().from(businessDocGenerationTasks).all().map((task) => task.taskType).sort()).toEqual([
      'business_rules',
      'data_dictionary',
      'epic_glossary',
      'project_glossary',
      'system_design',
      'use_case_list',
      'use_case_list_refine',
    ])

    const systemDesign = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'system_design'))
      .get()
    const systemDesignPages = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, systemDesign!.contextHandle!))
      .all()
    expect(systemDesignPages.map((page) => page.pageKind).sort()).toEqual([
      'existing_canonical',
      'model_evidence',
      'relation_evidence',
      'schema',
      'source_document_cards',
      'source_graph_projection',
      'target',
    ])
    const canonicalPage = systemDesignPages.find((page) => page.pageKind === 'existing_canonical')
    expect(canonicalPage?.contentJson).toMatchObject({
      document: {
        documentType: 'design',
        contentProjection: 'metadata_only',
      },
    })
    const canonicalContent = JSON.stringify(canonicalPage?.contentJson)
    expect(canonicalContent).not.toContain('sqlite')
    expect(canonicalContent).not.toContain('SELECT ')
    expect(canonicalContent).not.toContain('src/server/db.ts')
    expect(canonicalContent).not.toContain('open ')
  })

  it('includes the existing project glossary baseline for incremental glossary merges', () => {
    const db = createRunnableProject()
    seedBusinessDocument(db, { id: 'business:design:orders', type: 'design', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:dd:orders', type: 'data_dictionary', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:br:orders', type: 'br', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:ucl:orders', type: 'ucl', scopeId: 'epic:orders' })
    seedBusinessDocument(db, { id: 'business:glossary:orders', type: 'glossary', scopeId: 'epic:orders' })
    seedBusinessDocument(db, {
      id: 'business:project-glossary',
      type: 'glossary',
      scope: 'project',
      scopeId: projectId,
      contentHash: 'hash:project-glossary',
    })

    const result = startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        run: { forceRegenerate: false },
        tasks: { total: 1 },
      },
    })
    const projectGlossary = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'project_glossary'))
      .get()
    expect(projectGlossary).toBeTruthy()
    const pages = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, projectGlossary!.contextHandle!))
      .all()
    expect(pages.map((page) => page.pageKind)).toContain('existing_canonical')
    const canonicalPage = pages.find((page) => page.pageKind === 'existing_canonical')
    expect(canonicalPage?.contentJson).toMatchObject({
      document: {
        documentType: 'glossary',
        contentHash: 'hash:project-glossary',
        contentProjection: 'metadata_only',
      },
    })
  })

  it('resumes the newest resumable run by default without adding rows', () => {
    const db = createRunnableProject()
    const makeId = makeSequentialIds()
    const first = startBusinessDocsGeneration(db, { projectId, now: fixedNow, makeId })

    const taskCount = rowCount(db, businessDocGenerationTasks)
    const contextCount = rowCount(db, businessDocContextBundles)
    const second = startBusinessDocsGeneration(db, { projectId, now: fixedNow, makeId })

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({
      ok: true,
      data: {
        mode: 'resumed',
        tasks: {
          resumable: taskCount,
        },
        nextAction: {
          type: 'inspect_existing_run',
        },
      },
    })
    if (first.ok && second.ok) {
      expect(second.data.run.id).toBe(first.data.run.id)
    }
    expect(rowCount(db, businessDocGenerationRuns)).toBe(1)
    expect(rowCount(db, businessDocGenerationTasks)).toBe(taskCount)
    expect(rowCount(db, businessDocContextBundles)).toBe(contextCount)
  })

  it('creates a new run when newRun is enabled even if a resumable run exists', () => {
    const db = createRunnableProject()
    const makeId = makeSequentialIds()
    const first = startBusinessDocsGeneration(db, { projectId, now: fixedNow, makeId })
    const second = startBusinessDocsGeneration(db, { projectId, newRun: true, now: fixedNow, makeId })

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
      },
    })
    if (first.ok && second.ok) {
      expect(second.data.run.id).not.toBe(first.data.run.id)
    }
    expect(rowCount(db, businessDocGenerationRuns)).toBe(2)
  })

  it('records ready source-first safe context pages and deferred dependency context pages', () => {
    const db = createRunnableProject()
    seedLowerDocument(db, {
      id: 'doc:dangerous-screen',
      type: 'screen_spec',
      summary: 'User can create an order and update it. SELECT * FROM documents. API_KEY=sk-live-must-not-leak. Local file /Users/pshift/private/platty.sqlite',
      content: {
        identity: {
          route_path: '/orders',
          screen_name: 'OrdersPage',
        },
        dbPath: '/Users/pshift/private/platty.sqlite',
        rawSql: 'SELECT * FROM documents',
        localSourceInstruction: 'open src/server/db.ts and read it directly',
        flow: ['Safe checkout flow'],
      },
    })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:dangerous-screen', documentType: 'screen_spec' })
    startBusinessDocsGeneration(db, { projectId, now: fixedNow, makeId: makeSequentialIds() })

    const tasks = db.select().from(businessDocGenerationTasks).all()
    const useCaseList = tasks.find((task) => task.taskType === 'use_case_list')
    const refine = tasks.find((task) => task.taskType === 'use_case_list_refine')
    expect(useCaseList).toBeTruthy()
    expect(refine).toBeTruthy()
    expect(refine?.dependsOnTaskIdsJson).toEqual([useCaseList?.id])

    const sourcePages = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, useCaseList!.contextHandle!))
      .all()
    expect(sourcePages.map((page) => page.pageKind).sort()).toEqual([
      'model_evidence',
      'relation_evidence',
      'schema',
      'source_document_cards',
      'source_graph_projection',
      'target',
    ])
    // Redaction policy: ONLY env/secret material and absolute host paths / on-disk DB
    // files are masked. Business prose and SQL verbs pass through so the worker receives
    // real SOT context (rich content is forwarded, not stripped).
    const sourceContent = JSON.stringify(sourcePages.map((page) => page.contentJson))
    // env/secret + host-environment leakage is redacted
    expect(sourceContent).not.toContain('sk-live-must-not-leak')
    expect(sourceContent).not.toContain('platty.sqlite')
    expect(sourceContent).not.toContain('/Users/pshift')
    // legitimate business prose + SQL are forwarded intact (no over-redaction)
    expect(sourceContent).toContain('create an order and update it')
    expect(sourceContent).toContain('SELECT')

    const sourcePage = sourcePages.find((page) => page.pageKind === 'source_document_cards')
    const bundle = db.select().from(businessDocContextBundles)
      .where(eq(businessDocContextBundles.contextHandle, useCaseList!.contextHandle!))
      .get()
    expect(sourcePage?.evidenceIdsJson.every((id) =>
      id.startsWith(`${bundle?.manifestJson.evidenceIdNamespace}:`))).toBe(true)

    const refineBundle = db.select().from(businessDocContextBundles)
      .where(eq(businessDocContextBundles.contextHandle, refine!.contextHandle!))
      .get()
    expect(refineBundle?.manifestJson).toMatchObject({
      dependencyPagesReady: false,
      deferredPages: expect.arrayContaining(['upstream_business_docs']),
    })
  })

  it('projects cross-EPIC source roles and relation evidence into context pages', () => {
    const db = createRunnableProject()
    seedLowerDocument(db, {
      id: 'doc:store-feed-screen',
      type: 'screen_spec',
      summary: 'Store feed detail screen.',
      content: {
        title: 'Store feed detail',
        identity: {
          route_path: '/store/feed/:id',
          screen_name: 'StoreFeedDetailPage',
        },
        relations: {
          calls_api: [
            {
              method: 'GET',
              path: '/api/v2/feed/public/:feedId',
              confidence: 'medium',
              evidence: ['onMount fetch'],
            },
          ],
        },
      },
    })
    linkEpicDocument(db, {
      epicId: 'epic:orders',
      documentId: 'doc:store-feed-screen',
      documentType: 'screen_spec',
      role: 'cross_epic',
      reason: 'Orders links into feed detail.',
      confidence: 'medium',
    })

    startBusinessDocsGeneration(db, { projectId, now: fixedNow, makeId: makeSequentialIds() })

    const useCaseList = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'use_case_list'))
      .get()
    const pages = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, useCaseList!.contextHandle!))
      .all()
    const sourceGraph = pages.find((page) => page.pageKind === 'source_graph_projection')
    expect(JSON.stringify(sourceGraph?.contentJson)).toContain('cross_epic')
    expect(JSON.stringify(sourceGraph?.contentJson)).toContain('/api/v2/feed/public/:feedId')
    expect(JSON.stringify(sourceGraph?.contentJson)).toContain('relation_inferred')

    const relationPage = pages.find((page) => page.pageKind === 'relation_evidence')
    expect(relationPage?.contentJson).toMatchObject({
      relations: expect.arrayContaining([
        expect.objectContaining({
          sourceRef: expect.any(String),
          documentId: 'doc:store-feed-screen',
          relationType: 'calls_api',
          target: 'GET /api/v2/feed/public/:feedId',
          confidence: 'medium',
          relationClassification: 'relation_inferred',
          epicRole: 'cross_epic',
          epicConfidence: 'medium',
        }),
      ]),
    })
  })

  it('scopes model evidence to the repo that produced the db relation', () => {
    const db = createRunnableProject()
    db.insert(repositories).values([
      {
        id: 'repo:a',
        projectId,
        name: 'repo-a',
        repoPath: '/repo/a',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'repo:b',
        projectId,
        name: 'repo-b',
        repoPath: '/repo/b',
        createdAt: now,
        updatedAt: now,
      },
    ]).run()
    db.insert(docRelationLinks).values({
      documentId: 'doc:orders-api',
      relationId: null,
      repoId: 'repo:a',
      sourceNodeId: 'node:orders',
      kind: 'db_access',
      target: 'Order',
      operation: 'select',
      canonicalTarget: 'db:Order:select',
      payloadJson: null,
      evidenceNodeIdsJson: [],
      confidence: 'high',
      unresolvedReason: null,
      createdAt: now,
    }).run()
    db.insert(models).values([
      {
        id: 'model:repo-a-order',
        repositoryId: 'repo:a',
        name: 'Order',
        tableName: 'orders',
        fields: [{ name: 'id', type: 'String' }],
        relations: [],
        orm: 'prisma',
        validity: 'fresh',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'model:repo-b-order',
        repositoryId: 'repo:b',
        name: 'Order',
        tableName: 'orders',
        fields: [{ name: 'foreignId', type: 'String' }],
        relations: [],
        orm: 'prisma',
        validity: 'fresh',
        createdAt: now,
        updatedAt: now,
      },
    ]).run()

    const result = startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result.ok).toBe(true)
    const modelPage = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.pageToken, 'model_evidence'))
      .get()
    const projectedModels = modelPage?.contentJson.models
    expect(projectedModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'model:repo-a-order' }),
    ]))
    expect(projectedModels).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'model:repo-b-order' }),
    ]))
  })

  it('rolls back run, task, bundle, and page rows when an insert fails', () => {
    const db = createRunnableProject()

    expect(() => startBusinessDocsGeneration(db, {
      projectId,
      newRun: true,
      now: fixedNow,
      makeId: () => 'duplicate',
    })).toThrow()

    expect(rowCount(db, businessDocGenerationRuns)).toBe(0)
    expect(rowCount(db, businessDocGenerationTasks)).toBe(0)
    expect(rowCount(db, businessDocContextBundles)).toBe(0)
    expect(rowCount(db, businessDocContextPages)).toBe(0)
  })

  it('publishes glossary registry fields in the task schema page', () => {
    const db = createRunnableProject()

    const result = startBusinessDocsGeneration(db, {
      projectId,
      now: fixedNow,
      makeId: makeSequentialIds(),
    })

    expect(result.ok).toBe(true)
    const glossaryTask = db.select().from(businessDocGenerationTasks)
      .where(eq(businessDocGenerationTasks.taskType, 'epic_glossary'))
      .get()
    expect(glossaryTask).toBeTruthy()

    const schemaPage = db.select().from(businessDocContextPages)
      .where(eq(businessDocContextPages.contextHandle, glossaryTask!.contextHandle!))
      .all()
      .find((page) => page.pageToken === 'schema')

    expect(schemaPage?.contentJson).toMatchObject({
      expectedJson: {
        expectedItemContent: {
          canonical_term: 'string',
          aliases: 'string[] confirmed aliases',
          candidate_aliases: 'string[] unconfirmed natural-language aliases',
          synonyms: 'string[] including bilingual variants',
          antonyms: 'string[] opposite or contrast terms',
          related_terms: 'string[] near but not equivalent terms',
          signals: 'string[] code/business clues useful for deterministic search',
          ambiguity: 'object with status none | ambiguous | user_resolved, candidates, and optional resolution_note',
        },
      },
    })
  })
})

function createRunnableProject(): TestDb {
  const db = createTestDb()
  seedProject(db)
  seedEpic(db, {
    id: 'epic:orders',
    name: 'Orders',
    stableKey: 'orders',
    summary: 'Order checkout and fulfillment.',
  })
  seedLowerDocument(db, {
    id: 'doc:orders-api',
    type: 'api_spec',
    status: 'passed',
    summary: 'Create an order from cart items.',
    content: {
      id: 'doc:orders-api',
      type: 'api_spec',
      title: 'Create order API',
      summary: 'Create an order from cart items.',
      identity: {
        method: 'POST',
        path: '/orders',
        handler: 'OrdersController.create',
        file_path: 'src/server/orders.ts',
      },
      flow: ['Validate cart', 'Persist order'],
      rules: ['Orders require at least one item.'],
      relations: {
        tables: [{ table: 'Order', operation: 'insert' }],
        external_calls: [],
      },
    },
  })
  linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
  return db
}

function fixedNow(): Date {
  return new Date(now)
}

function makeSequentialIds(): () => string {
  let next = 0
  return () => `id:${++next}`
}

function rowCount(db: TestDb, table: any): number {
  return Number(db.select({ value: count() }).from(table).get()?.value ?? 0)
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
  overrides: { id: string; confirmedAt?: string | null; name?: string; stableKey?: string; summary?: string },
): void {
  db.insert(epics).values({
    id: overrides.id,
    projectId,
    name: overrides.name ?? overrides.id.replace('epic:', ''),
    abbr: 'EP',
    stableKey: overrides.stableKey ?? overrides.id.replace('epic:', ''),
    summary: overrides.summary ?? null,
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
    track?: 'technical' | 'business'
    status?: 'active' | 'passed'
    scopeId?: string
    summary?: string
    content?: Record<string, unknown>
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: input.track ?? 'technical',
    scope: input.type,
    scopeId: input.scopeId ?? input.id,
    status: input.status ?? 'passed',
    validity: 'fresh',
    summary: input.summary ?? input.id,
    content: input.content ?? { id: input.id },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedBusinessDocument(
  db: TestDb,
  input: {
    id: string
    type: 'design' | 'data_dictionary' | 'br' | 'ucl' | 'ucs' | 'glossary'
    scopeId: string
    scope?: 'epic' | 'project'
    track?: 'business' | 'technical'
    summary?: string
    content?: Record<string, unknown>
    contentHash?: string | null
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: input.track ?? 'business',
    scope: input.scope ?? 'epic',
    scopeId: input.scopeId,
    status: 'active',
    validity: 'fresh',
    summary: input.summary ?? input.type,
    content: input.content ?? { type: input.type },
    contentHash: input.contentHash ?? null,
    rawLlmOutput: '',
    updatedBy: 'system',
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
