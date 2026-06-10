import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '../../server/helpers.js'
import { documents } from '../../../src/db/schema/build_docs.js'
import { epicDocumentLinks } from '../../../src/db/schema/build_epics.js'
import { epics, projects } from '../../../src/db/schema/core.js'
import { previewBusinessDocsGeneration } from '../../../src/pipeline_modules/build_business_docs_cli/preview.js'

const projectId = 'project:platty'
const now = '2026-06-04T00:00:00.000Z'

describe('build_business_docs_cli preview', () => {
  it('missing project returns a fatal blocker and zero selected EPICs', async () => {
    const db = createTestDb()

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.project).toEqual({ id: projectId, name: '' })
    expect(preview.confirmedEpicCount).toBe(0)
    expect(preview.selectedEpicCount).toBe(0)
    expect(preview.blockers).toContainEqual({
      severity: 'fatal',
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found for business docs generation.',
    })
    expect(preview.estimatedTasks.total).toBe(0)
  })

  it('no confirmed EPIC returns a fatal blocker and zero selected EPICs', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:draft', confirmedAt: null })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.confirmedEpicCount).toBe(0)
    expect(preview.selectedEpicCount).toBe(0)
    expect(preview.blockers).toContainEqual(expect.objectContaining({
      severity: 'fatal',
      code: 'NO_CONFIRMED_EPICS',
    }))
    expect(preview.estimatedTasks.total).toBe(0)
  })

  it('confirmed EPIC with no linked active lower docs is blocked', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.confirmedEpicCount).toBe(1)
    expect(preview.selectedEpicCount).toBe(0)
    expect(preview.documentPlan.perEpic).toEqual([
      expect.objectContaining({
        epicId: 'epic:orders',
        blockers: [
          expect.objectContaining({
            severity: 'fatal',
            code: 'NO_SOURCE_DOCUMENTS',
            epicId: 'epic:orders',
          }),
        ],
      }),
    ])
  })

  it('ignores active linked lower-type docs when they are not technical documents', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec', track: 'business' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.selectedEpicCount).toBe(0)
    expect(preview.documentPlan.perEpic[0].sourceDocCounts.api_spec).toBe(0)
    expect(preview.documentPlan.perEpic[0].blockers).toContainEqual(expect.objectContaining({
      code: 'NO_SOURCE_DOCUMENTS',
      epicId: 'epic:orders',
    }))
  })

  it('ignores linked lower docs when link type and stored document type disagree', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedLowerDocument(db, { id: 'doc:orders-screen', type: 'screen_spec' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-screen', documentType: 'api_spec' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.selectedEpicCount).toBe(0)
    expect(preview.documentPlan.perEpic[0].sourceDocCounts).toEqual({
      api_spec: 0,
      screen_spec: 0,
      event_spec: 0,
      schedule_spec: 0,
    })
    expect(preview.documentPlan.perEpic[0].blockers).toContainEqual(expect.objectContaining({
      code: 'NO_SOURCE_DOCUMENTS',
    }))
  })

  it('confirmed EPIC with passed linked lower docs is runnable even without model evidence', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec', status: 'passed' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.selectedEpicCount).toBe(1)
    expect(preview.blockers).toEqual([])
    expect(preview.documentPlan.perEpic).toEqual([
      expect.objectContaining({
        epicId: 'epic:orders',
        sourceDocCounts: {
          api_spec: 1,
          screen_spec: 0,
          event_spec: 0,
          schedule_spec: 0,
        },
      }),
    ])
    expect(preview.warnings).toEqual(expect.arrayContaining([
      'Model evidence is not integrated into preview yet for 1 runnable EPIC.',
    ]))
  })

  it('aggregates model evidence preview warnings for many runnable EPICs', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedEpic(db, { id: 'epic:billing' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
    seedLowerDocument(db, { id: 'doc:billing-api', type: 'api_spec' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
    linkEpicDocument(db, { epicId: 'epic:billing', documentId: 'doc:billing-api', documentType: 'api_spec' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.selectedEpicCount).toBe(2)
    expect(preview.warnings).toEqual([
      'Model evidence is not integrated into preview yet for 2 runnable EPICs.',
    ])
  })

  it('limits preview to selected EPIC ids when provided', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedEpic(db, { id: 'epic:benefits' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
    seedLowerDocument(db, { id: 'doc:benefits-screen', type: 'screen_spec' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
    linkEpicDocument(db, { epicId: 'epic:benefits', documentId: 'doc:benefits-screen', documentType: 'screen_spec' })

    const preview = await previewBusinessDocsGeneration(db, {
      projectId,
      selectedEpicIds: ['epic:benefits'],
    })

    expect(preview.confirmedEpicCount).toBe(2)
    expect(preview.selectedEpicCount).toBe(1)
    expect(preview.documentPlan.perEpic.map((epic) => epic.epicId)).toEqual(['epic:benefits'])
    expect(preview.estimatedTasks).toMatchObject({
      system_design: 1,
      data_dictionary: 1,
      business_rules: 1,
      use_case_list: 1,
      use_case_list_refine: 1,
      epic_glossary: 1,
      project_glossary: 1,
      total: 7,
    })
  })


  it('existing active design counts as completed system_design', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
    seedBusinessDocument(db, { id: 'business:design:orders', type: 'design', scopeId: 'epic:orders' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.documentPlan.perEpic[0]).toEqual(expect.objectContaining({
      epicId: 'epic:orders',
      existingPassedDocTypes: expect.arrayContaining(['system_design']),
      missingDocTypes: expect.not.arrayContaining(['system_design']),
    }))
    expect(preview.estimatedTasks.system_design).toBe(0)
  })

  it('ignores active business document types when they are not business documents', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
    seedBusinessDocument(db, { id: 'business:design:orders', type: 'design', scopeId: 'epic:orders', track: 'technical' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.documentPlan.perEpic[0].existingPassedDocTypes).not.toContain('system_design')
    expect(preview.documentPlan.perEpic[0].missingDocTypes).toContain('system_design')
    expect(preview.estimatedTasks.system_design).toBe(1)
  })

  it('missing active business docs produce task estimates', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
    seedBusinessDocument(db, { id: 'business:design:orders', type: 'design', scopeId: 'epic:orders' })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.documentPlan.perEpic[0]).toEqual(expect.objectContaining({
      missingDocTypes: expect.arrayContaining(['data_dictionary', 'br', 'ucl', 'glossary']),
    }))
    expect(preview.estimatedTasks).toMatchObject({
      system_design: 0,
      data_dictionary: 1,
      business_rules: 1,
      use_case_list: 1,
      use_case_list_refine: 1,
      use_case_spec: 0,
      epic_glossary: 1,
      project_glossary: 1,
    })
    expect(preview.documentPlan.projectGlossary).toBe('full_build')
    expect(preview.estimatedTasks.total).toBe(6)
  })

  it('estimates incremental project glossary work when a project glossary already exists', async () => {
    const db = createTestDb()
    seedProject(db)
    seedEpic(db, { id: 'epic:orders' })
    seedLowerDocument(db, { id: 'doc:orders-api', type: 'api_spec' })
    linkEpicDocument(db, { epicId: 'epic:orders', documentId: 'doc:orders-api', documentType: 'api_spec' })
    seedBusinessDocument(db, { id: 'business:project-glossary', type: 'glossary', scope: 'project', scopeId: projectId })

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.documentPlan.projectGlossary).toBe('incremental_merge')
    expect(preview.estimatedTasks.project_glossary).toBe(1)
  })

  it('default policy exactly matches the approved build_business_docs CLI defaults', async () => {
    const db = createTestDb()
    seedProject(db)

    const preview = await previewBusinessDocsGeneration(db, { projectId })

    expect(preview.recommendedPolicy).toEqual({
      workerRuntime: 'external_cli',
      workerProvider: 'codex',
      maxWorkerCount: 20,
      approvedActiveLeases: 20,
      epicSchedulingConcurrency: 4,
      writerSoftLimit: 6,
      ucsChunkSize: 1,
      ucsSchedulingConcurrency: 16,
      maxRepairAttempts: 1,
      persistMode: 'incremental',
      projectGlossaryMode: 'auto',
      judgeMode: 'off',
      outputLanguage: 'en',
    })
  })

  it('service source does not import legacy LLM/generation modules', () => {
    const source = readFileSync(new URL('../../../src/pipeline_modules/build_business_docs_cli/preview.ts', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from ['"]\.\.\/build_business_docs\/(?:index|builders|prompts|f\d|.*llm).*['"]/)
    expect(source).not.toMatch(/from ['"]@\/pipeline_modules\/build_business_docs\/(?:index|builders|prompts|f\d|.*llm).*['"]/)
    expect(source).not.toMatch(/from ['"]@\/pipeline_infra\/.*['"]/)
  })
})

function seedProject(db: ReturnType<typeof createTestDb>): void {
  db.insert(projects).values({
    id: projectId,
    name: 'Platty',
    createdAt: now,
    updatedAt: now,
  }).run()
}

function seedEpic(
  db: ReturnType<typeof createTestDb>,
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
  db: ReturnType<typeof createTestDb>,
  input: {
    id: string
    type: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec'
    track?: 'technical' | 'business'
    status?: 'active' | 'passed'
  },
): void {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: input.track ?? 'technical',
    scope: input.type,
    scopeId: input.id,
    status: input.status ?? 'active',
    validity: 'fresh',
    summary: input.id,
    content: { id: input.id },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function seedBusinessDocument(
  db: ReturnType<typeof createTestDb>,
  input: { id: string; type: 'design' | 'data_dictionary' | 'br' | 'ucl' | 'ucs' | 'glossary'; scopeId: string; scope?: 'epic' | 'project'; track?: 'business' | 'technical' },
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
    summary: input.type,
    content: { type: input.type },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()
}

function linkEpicDocument(
  db: ReturnType<typeof createTestDb>,
  input: { epicId: string; documentId: string; documentType: 'api_spec' | 'screen_spec' | 'event_spec' | 'schedule_spec' },
): void {
  db.insert(epicDocumentLinks).values({
    epicId: input.epicId,
    documentId: input.documentId,
    documentType: input.documentType,
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
}
