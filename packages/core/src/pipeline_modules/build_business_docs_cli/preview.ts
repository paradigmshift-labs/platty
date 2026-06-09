import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { documents } from '@/db/schema/build_docs.js'
import { epicDocumentLinks } from '@/db/schema/build_epics.js'
import { epics, projects } from '@/db/schema/core.js'
import {
  DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
  type BusinessDocsBlocker,
  type BusinessDocsEstimatedTasks,
  type BusinessDocsLowerDocumentType,
  type BusinessDocsPerEpicPreview,
  type BusinessDocsPreview,
  type BusinessDocsPreviewDocType,
  type BusinessDocsProjectGlossaryMode,
  type BusinessDocsSourceDocCounts,
  type BusinessDocsStoredDocumentType,
  type BusinessDocsTaskType,
} from './types.js'

const LOWER_DOC_TYPES = ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec'] as const satisfies BusinessDocsLowerDocumentType[]
const SOURCE_DOCUMENT_STATUSES = ['active', 'passed'] as const
const EPIC_BUSINESS_DOC_TYPES = ['design', 'data_dictionary', 'br', 'ucl', 'ucs', 'glossary'] as const satisfies BusinessDocsStoredDocumentType[]
const EPIC_DOC_TYPE_ORDER = ['system_design', 'data_dictionary', 'br', 'ucl', 'ucs', 'glossary'] as const satisfies BusinessDocsPreviewDocType[]
const REQUIRED_EPIC_DOC_TYPES = EPIC_DOC_TYPE_ORDER.filter((docType) => docType !== 'ucs')

const STORED_TO_PREVIEW_DOC_TYPE = {
  design: 'system_design',
  data_dictionary: 'data_dictionary',
  br: 'br',
  ucl: 'ucl',
  ucs: 'ucs',
  glossary: 'glossary',
} as const satisfies Record<BusinessDocsStoredDocumentType, BusinessDocsPreviewDocType>

export interface BusinessDocsPreviewInput {
  projectId: string
  selectedEpicIds?: string[]
}

export function previewBusinessDocsGeneration(db: DB, input: BusinessDocsPreviewInput): BusinessDocsPreview {
  const project = db.select({
    id: projects.id,
    name: projects.name,
  }).from(projects).where(eq(projects.id, input.projectId)).get()

  if (!project) {
    return {
      project: {
        id: input.projectId,
        name: '',
      },
      confirmedEpicCount: 0,
      selectedEpicCount: 0,
      blockers: [{
        severity: 'fatal',
        code: 'PROJECT_NOT_FOUND',
        message: 'Project was not found for business docs generation.',
      }],
      documentPlan: {
        perEpic: [],
        projectGlossary: 'blocked',
      },
      recommendedPolicy: DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
      estimatedTasks: emptyEstimatedTasks(),
      warnings: [],
    }
  }

  const confirmedEpics = db.select({
    id: epics.id,
    name: epics.name,
  }).from(epics).where(and(
    eq(epics.projectId, input.projectId),
    isNotNull(epics.confirmedAt),
    isNull(epics.deletedAt),
  )).all()

  const selectedEpicIdSet = new Set((input.selectedEpicIds ?? []).map((id) => id.trim()).filter(Boolean))
  const planEpics = selectedEpicIdSet.size === 0
    ? confirmedEpics
    : confirmedEpics.filter((epic) => selectedEpicIdSet.has(epic.id))

  const sourceRows = planEpics.length === 0
    ? []
    : db.select({
      epicId: epicDocumentLinks.epicId,
      documentId: epicDocumentLinks.documentId,
      documentType: epicDocumentLinks.documentType,
      storedDocumentType: documents.type,
    }).from(epicDocumentLinks)
      .innerJoin(documents, eq(documents.id, epicDocumentLinks.documentId))
      .where(and(
        inArray(epicDocumentLinks.epicId, planEpics.map((epic) => epic.id)),
        inArray(epicDocumentLinks.documentType, LOWER_DOC_TYPES),
        eq(documents.projectId, input.projectId),
        inArray(documents.status, SOURCE_DOCUMENT_STATUSES),
        eq(documents.track, 'technical'),
        inArray(documents.type, LOWER_DOC_TYPES),
      ))
      .all()

  const existingBusinessDocs = db.select({
    type: documents.type,
    scope: documents.scope,
    scopeId: documents.scopeId,
  }).from(documents).where(and(
    eq(documents.projectId, input.projectId),
    eq(documents.status, 'active'),
    eq(documents.track, 'business'),
    inArray(documents.type, EPIC_BUSINESS_DOC_TYPES),
  )).all()

  const existingProjectGlossary = existingBusinessDocs.some((doc) =>
    doc.type === 'glossary' && doc.scope === 'project' && doc.scopeId === input.projectId)

  const sourceCountsByEpic = new Map<string, BusinessDocsSourceDocCounts>()
  const sourceDocumentKeys = new Set<string>()
  for (const epic of planEpics) {
    sourceCountsByEpic.set(epic.id, emptySourceDocCounts())
  }
  for (const row of sourceRows) {
    const counts = sourceCountsByEpic.get(row.epicId)
    const sourceDocumentKey = `${row.epicId}:${row.documentType}:${row.documentId}`
    if (
      counts &&
      isLowerDocType(row.documentType) &&
      row.documentType === row.storedDocumentType &&
      !sourceDocumentKeys.has(sourceDocumentKey)
    ) {
      counts[row.documentType] += 1
      sourceDocumentKeys.add(sourceDocumentKey)
    }
  }

  const existingDocsByEpic = new Map<string, Set<BusinessDocsPreviewDocType>>()
  for (const doc of existingBusinessDocs) {
    if (doc.scope !== 'epic' || !doc.scopeId || !isStoredDocumentType(doc.type)) continue
    const existing = existingDocsByEpic.get(doc.scopeId) ?? new Set<BusinessDocsPreviewDocType>()
    existing.add(STORED_TO_PREVIEW_DOC_TYPE[doc.type])
    existingDocsByEpic.set(doc.scopeId, existing)
  }

  const estimatedTasks = emptyEstimatedTasks()
  const perEpic: BusinessDocsPerEpicPreview[] = []
  let runnableEpicCount = 0

  for (const epic of planEpics) {
    const sourceDocCounts = sourceCountsByEpic.get(epic.id) ?? emptySourceDocCounts()
    const sourceDocCount = Object.values(sourceDocCounts).reduce((sum, count) => sum + count, 0)
    const existingSet = existingDocsByEpic.get(epic.id) ?? new Set<BusinessDocsPreviewDocType>()
    const existingDocTypes = EPIC_DOC_TYPE_ORDER.filter((docType) => existingSet.has(docType))
    const missingDocTypes = REQUIRED_EPIC_DOC_TYPES.filter((docType) => !existingDocTypes.includes(docType))
    const blockers: BusinessDocsBlocker[] = []

    if (sourceDocCount === 0) {
      blockers.push({
        severity: 'fatal',
        code: 'NO_SOURCE_DOCUMENTS',
        message: `Confirmed EPIC ${epic.name} has no active linked lower documents.`,
        epicId: epic.id,
      })
    } else {
      runnableEpicCount += 1
      addEpicTaskEstimates(estimatedTasks, missingDocTypes, existingDocTypes)
    }

    perEpic.push({
      epicId: epic.id,
      epicName: epic.name,
      existingPassedDocTypes: existingDocTypes,
      missingDocTypes,
      sourceDocCounts,
      blockers,
    })
  }

  const blockers: BusinessDocsBlocker[] = []
  if (confirmedEpics.length === 0) {
    blockers.push({
      severity: 'fatal',
      code: 'NO_CONFIRMED_EPICS',
      message: 'No confirmed EPICs are available for business docs generation.',
    })
  }

  const selectedEpicCount = perEpic.filter((epic) => epic.blockers.length === 0).length
  const warnings = runnableEpicCount > 0
    ? [`Model evidence is not integrated into preview yet for ${runnableEpicCount} runnable ${runnableEpicCount === 1 ? 'EPIC' : 'EPICs'}.`]
    : []
  const possibleEpicGlossaryCount = perEpic.filter((epic) =>
    epic.blockers.length === 0 &&
    (epic.existingPassedDocTypes.includes('glossary') || epic.missingDocTypes.includes('glossary'))
  ).length
  const projectGlossary = resolveProjectGlossaryMode({
    selectedEpicCount,
    possibleEpicGlossaryCount,
    existingProjectGlossary,
  })
  if (projectGlossary === 'full_build' || projectGlossary === 'incremental_merge') {
    estimatedTasks.project_glossary = 1
  }
  estimatedTasks.total = totalEstimatedTasks(estimatedTasks)

  return {
    project: {
      id: project?.id ?? input.projectId,
      name: project?.name ?? '',
    },
    confirmedEpicCount: confirmedEpics.length,
    selectedEpicCount,
    blockers,
    documentPlan: {
      perEpic,
      projectGlossary,
    },
    recommendedPolicy: DEFAULT_BUSINESS_DOCS_RUNTIME_POLICY,
    estimatedTasks,
    warnings,
  }
}

function addEpicTaskEstimates(
  estimatedTasks: BusinessDocsEstimatedTasks,
  missingDocTypes: BusinessDocsPreviewDocType[],
  existingDocTypes: BusinessDocsPreviewDocType[],
): void {
  if (missingDocTypes.includes('system_design')) estimatedTasks.system_design += 1
  if (missingDocTypes.includes('data_dictionary')) estimatedTasks.data_dictionary += 1
  if (missingDocTypes.includes('br')) estimatedTasks.business_rules += 1
  if (missingDocTypes.includes('ucl')) {
    estimatedTasks.use_case_list += 1
    estimatedTasks.use_case_list_refine += 1
  }

  const upstreamDocsExistOrArePlanned =
    existingDocTypes.some((type) => type !== 'glossary' && type !== 'ucs') ||
    missingDocTypes.some((type) => type !== 'glossary' && type !== 'ucs')
  if (missingDocTypes.includes('glossary') && upstreamDocsExistOrArePlanned) {
    estimatedTasks.epic_glossary += 1
  }
}

function resolveProjectGlossaryMode(input: {
  selectedEpicCount: number
  possibleEpicGlossaryCount: number
  existingProjectGlossary: boolean
}): BusinessDocsProjectGlossaryMode {
  if (input.selectedEpicCount === 0) return 'blocked'
  if (input.possibleEpicGlossaryCount === 0) return 'blocked'
  return input.existingProjectGlossary ? 'incremental_merge' : 'full_build'
}

function emptySourceDocCounts(): BusinessDocsSourceDocCounts {
  return {
    api_spec: 0,
    screen_spec: 0,
    event_spec: 0,
    schedule_spec: 0,
  }
}

function emptyEstimatedTasks(): BusinessDocsEstimatedTasks {
  return {
    system_design: 0,
    data_dictionary: 0,
    business_rules: 0,
    use_case_list: 0,
    use_case_list_refine: 0,
    use_case_spec: 0,
    epic_glossary: 0,
    project_glossary: 0,
    total: 0,
  }
}

function totalEstimatedTasks(estimatedTasks: BusinessDocsEstimatedTasks): number {
  const taskTypes: BusinessDocsTaskType[] = [
    'system_design',
    'data_dictionary',
    'business_rules',
    'use_case_list',
    'use_case_list_refine',
    'use_case_spec',
    'epic_glossary',
    'project_glossary',
  ]
  return taskTypes.reduce((total, taskType) => total + estimatedTasks[taskType], 0)
}

function isLowerDocType(value: string): value is BusinessDocsLowerDocumentType {
  return LOWER_DOC_TYPES.includes(value as BusinessDocsLowerDocumentType)
}

function isStoredDocumentType(value: string): value is BusinessDocsStoredDocumentType {
  return EPIC_BUSINESS_DOC_TYPES.includes(value as BusinessDocsStoredDocumentType)
}
