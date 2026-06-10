import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  docRelationLinks,
  documentItemDocumentLinks,
  documentItemModelLinks,
  documentItemRelationLinks,
  documentItems,
  documents,
  type DocRelationLink,
} from '@/db/schema/build_docs.js'
import { models, type Model } from '@/db/schema/build_models.js'
import { repositories } from '@/db/schema/core.js'

const MATERIALIZER_ID = 'business_graph_materializer_v1'
type MaterializeGraphDb = Pick<DB, 'select' | 'insert' | 'delete'>

export interface MaterializeBusinessGraphResult {
  deletedLinks: number
  createdLinks: number
  deletedModelLinks?: number
  createdModelLinks?: number
  deletedRelationLinks?: number
  createdRelationLinks?: number
}

export function materializeDocumentItemModelLinks(
  db: MaterializeGraphDb,
  input: { projectId: string; documentId?: string; epicId?: string },
): MaterializeBusinessGraphResult {
  const items = loadDataDictionaryItems(db, input)
  if (items.length === 0) return { deletedLinks: 0, createdLinks: 0 }

  const itemIds = items.map((item) => item.id)
  const deletedLinks = deleteExistingModelLinks(db, itemIds)
  const deletedRelationLinks = deleteExistingRelationLinks(db, itemIds)
  const projectModels = loadProjectModels(db, input.projectId)
  const relationsByItemId = loadItemDbAccessRelations(db, itemIds)
  let createdLinks = 0
  let createdRelationLinks = 0

  for (const item of items) {
    const relations = relationsByItemId.get(item.id) ?? []
    for (const relation of relations) {
      db.insert(documentItemRelationLinks).values({
        id: relationLinkId(item.id, relation),
        itemId: item.id,
        relationId: relation.relationId,
        relationKey: relationKey(relation),
        repoId: relation.repoId,
        sourceNodeId: relation.sourceNodeId,
        kind: relation.kind,
        target: relation.target,
        operation: relation.operation,
        canonicalTarget: relation.canonicalTarget,
        payloadJson: relation.payloadJson,
        evidenceNodeIdsJson: relation.evidenceNodeIdsJson,
        confidence: relation.confidence,
      }).onConflictDoNothing().run()
      createdRelationLinks += 1
    }

    for (const match of matchItemModels(item, projectModels, relations)) {
      db.insert(documentItemModelLinks).values({
        projectId: input.projectId,
        itemId: item.id,
        modelId: match.model.id,
        fieldName: match.fieldName,
        linkType: match.linkType ?? (match.fieldName ? 'describes_field' : 'describes_model'),
        role: match.fieldName || match.linkType === 'uses_model' ? 'supporting' : 'primary',
        evidenceJson: {
          itemTitle: item.title,
          matchedBy: match.matchedBy,
          relationTargets: relations.map((relation) => relation.canonicalTarget ?? relation.target).filter(Boolean),
        },
        createdBy: MATERIALIZER_ID,
      }).onConflictDoNothing().run()
      createdLinks += 1
    }
  }

  return withRelationCounts({ deletedLinks, createdLinks }, deletedRelationLinks, createdRelationLinks)
}

export function materializeBusinessDocumentGraph(
  db: MaterializeGraphDb,
  input: { projectId: string; epicId?: string },
): MaterializeBusinessGraphResult {
  const modelLinkResult = materializeDocumentItemModelLinks(db, input)
  const uclItems = loadUseCaseListItems(db, input)
  if (uclItems.length === 0) {
    return {
      deletedLinks: 0,
      createdLinks: 0,
      deletedModelLinks: modelLinkResult.deletedLinks,
      createdModelLinks: modelLinkResult.createdLinks,
      ...(modelLinkResult.deletedRelationLinks !== undefined ? { deletedRelationLinks: modelLinkResult.deletedRelationLinks } : {}),
      ...(modelLinkResult.createdRelationLinks !== undefined ? { createdRelationLinks: modelLinkResult.createdRelationLinks } : {}),
    }
  }

  const deletedLinks = deleteExistingItemDocumentLinks(
    db,
    uclItems.map((item) => item.id),
    ['expands_use_case'],
  )
  const ucsDocuments = loadUseCaseSpecDocuments(db, input.projectId)
  let createdLinks = 0

  for (const item of uclItems) {
    const target = findMatchingUseCaseSpec(item, ucsDocuments)
    if (!target) continue
    db.insert(documentItemDocumentLinks).values({
      fromItemId: item.id,
      toDocumentId: target.id,
      linkType: 'expands_use_case',
      role: 'primary',
      createdBy: MATERIALIZER_ID,
    }).onConflictDoNothing().run()
    createdLinks += 1
  }

  return {
    deletedLinks,
    createdLinks,
    deletedModelLinks: modelLinkResult.deletedLinks,
    createdModelLinks: modelLinkResult.createdLinks,
    ...(modelLinkResult.deletedRelationLinks !== undefined ? { deletedRelationLinks: modelLinkResult.deletedRelationLinks } : {}),
    ...(modelLinkResult.createdRelationLinks !== undefined ? { createdRelationLinks: modelLinkResult.createdRelationLinks } : {}),
  }
}

type DataDictionaryItem = {
  id: string
  title: string | null
  content: Record<string, unknown>
}

type UseCaseListItem = {
  id: string
  stableKey: string
  title: string | null
  content: Record<string, unknown>
}

type UseCaseSpecDocument = {
  id: string
  scopeId: string | null
  content: Record<string, unknown> | null
}

type ModelMatch = {
  model: Model
  fieldName: string | null
  matchedBy: string[]
  linkType?: 'describes_model' | 'describes_field' | 'uses_model'
}

function loadDataDictionaryItems(
  db: MaterializeGraphDb,
  input: { projectId: string; documentId?: string; epicId?: string },
): DataDictionaryItem[] {
  const rows = db.select({
    id: documentItems.id,
    title: documentItems.title,
    content: documentItems.content,
  })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(
      eq(documentItems.projectId, input.projectId),
      eq(documentItems.status, 'active'),
      eq(documents.type, 'data_dictionary'),
      eq(documents.track, 'business'),
      eq(documents.status, 'active'),
      eq(documents.validity, 'fresh'),
      ...(input.documentId ? [eq(documents.id, input.documentId)] : []),
      ...(input.epicId ? [eq(documents.scopeId, input.epicId)] : []),
    ))
    .all()

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
  }))
}

function deleteExistingModelLinks(db: MaterializeGraphDb, itemIds: string[]): number {
  if (itemIds.length === 0) return 0
  const existing = db.select({ itemId: documentItemModelLinks.itemId })
    .from(documentItemModelLinks)
    .where(and(
      inArray(documentItemModelLinks.itemId, itemIds),
      eq(documentItemModelLinks.createdBy, MATERIALIZER_ID),
    ))
    .all()
  db.delete(documentItemModelLinks)
    .where(and(
      inArray(documentItemModelLinks.itemId, itemIds),
      eq(documentItemModelLinks.createdBy, MATERIALIZER_ID),
    ))
    .run()
  return existing.length
}

function deleteExistingRelationLinks(db: MaterializeGraphDb, itemIds: string[]): number {
  if (itemIds.length === 0) return 0
  const existing = db.select({ itemId: documentItemRelationLinks.itemId })
    .from(documentItemRelationLinks)
    .where(inArray(documentItemRelationLinks.itemId, itemIds))
    .all()
  db.delete(documentItemRelationLinks)
    .where(inArray(documentItemRelationLinks.itemId, itemIds))
    .run()
  return existing.length
}

function deleteExistingItemDocumentLinks(db: MaterializeGraphDb, itemIds: string[], linkTypes: string[]): number {
  if (itemIds.length === 0 || linkTypes.length === 0) return 0
  const existing = db.select({ fromItemId: documentItemDocumentLinks.fromItemId })
    .from(documentItemDocumentLinks)
    .where(and(
      inArray(documentItemDocumentLinks.fromItemId, itemIds),
      inArray(documentItemDocumentLinks.linkType, linkTypes),
      eq(documentItemDocumentLinks.createdBy, MATERIALIZER_ID),
    ))
    .all()
  db.delete(documentItemDocumentLinks)
    .where(and(
      inArray(documentItemDocumentLinks.fromItemId, itemIds),
      inArray(documentItemDocumentLinks.linkType, linkTypes),
      eq(documentItemDocumentLinks.createdBy, MATERIALIZER_ID),
    ))
    .run()
  return existing.length
}

function loadUseCaseListItems(db: MaterializeGraphDb, input: { projectId: string; epicId?: string }): UseCaseListItem[] {
  const rows = db.select({
    id: documentItems.id,
    stableKey: documentItems.stableKey,
    title: documentItems.title,
    content: documentItems.content,
  })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(and(
      eq(documentItems.projectId, input.projectId),
      eq(documentItems.status, 'active'),
      eq(documents.type, 'ucl'),
      eq(documents.track, 'business'),
      eq(documents.status, 'active'),
      eq(documents.validity, 'fresh'),
      ...(input.epicId ? [eq(documents.scopeId, input.epicId)] : []),
    ))
    .all()
  return rows.map((row) => ({
    id: row.id,
    stableKey: row.stableKey,
    title: row.title,
    content: row.content,
  }))
}

function loadUseCaseSpecDocuments(db: MaterializeGraphDb, projectId: string): UseCaseSpecDocument[] {
  return db.select({
    id: documents.id,
    scopeId: documents.scopeId,
    content: documents.content,
  })
    .from(documents)
    .where(and(
      eq(documents.projectId, projectId),
      eq(documents.type, 'ucs'),
      eq(documents.track, 'business'),
      eq(documents.status, 'active'),
      eq(documents.validity, 'fresh'),
    ))
    .all()
}

export function parseEpicIdFromScopeId(scopeId: string | null): string | null {
  if (!scopeId) return null
  const match = /^epic:(.+?):use_case:/.exec(scopeId)
  return match?.[1] ?? null
}

function findMatchingUseCaseSpec(item: UseCaseListItem, docs: UseCaseSpecDocument[]): UseCaseSpecDocument | null {
  const stableKeyNormalized = normalize(item.stableKey)
  const itemKeys = normalizedSet([
    item.stableKey,
    item.title,
    readString(item.content.use_case_id),
    readString(item.content.useCaseId),
    readString(item.content.title),
  ])
  return docs.find((doc) => {
    const content = doc.content ?? {}
    const scopeIdSuffix = parseScopeIdUseCaseSuffix(doc.scopeId)
    const docKeys = normalizedSet([
      doc.scopeId,
      scopeIdSuffix,
      readString(content.use_case_id),
      readString(content.useCaseId),
      readString(content.title),
    ])
    for (const itemKey of itemKeys) {
      if (docKeys.has(itemKey)) return true
    }
    return [...docKeys].some((docKey) => docKey.includes(stableKeyNormalized))
  }) ?? null
}

function parseScopeIdUseCaseSuffix(scopeId: string | null): string | null {
  if (!scopeId) return null
  const idx = scopeId.indexOf(':use_case:')
  return idx >= 0 ? scopeId.slice(idx + ':use_case:'.length) : null
}

function loadProjectModels(db: MaterializeGraphDb, projectId: string): Model[] {
  const repoRows = db.select({ id: repositories.id })
    .from(repositories)
    .where(and(eq(repositories.projectId, projectId), isNull(repositories.deletedAt)))
    .all()
  const repoIds = repoRows.map((repo) => repo.id)
  if (repoIds.length === 0) return []
  return db.select().from(models)
    .where(inArray(models.repositoryId, repoIds))
    .all()
}

function matchItemModels(item: DataDictionaryItem, projectModels: Model[], relations: DocRelationLink[] = []): ModelMatch[] {
  const terms = modelTermsFromItem(item)
  const matches: ModelMatch[] = []
  for (const model of projectModels) {
    const modelNames = normalizedSet([model.name, model.tableName, `model:${model.name}`, `model:${model.tableName}`])
    const explicitModelId = terms.explicitModelIds.has(normalize(model.id))
    const matchedBy = explicitModelId
      ? [model.id]
      : [...terms.modelTerms].filter((term) => modelNames.has(term))
    if (matchedBy.length === 0) continue

    matches.push({ model, fieldName: null, matchedBy })
    for (const fieldName of matchedFieldNames(model, terms.fieldTerms)) {
      matches.push({ model, fieldName, matchedBy: [...matchedBy, fieldName] })
    }
  }
  if (matches.length > 0) return matches

  for (const model of projectModels) {
    const relationTargets = relationTermsForModel(model, relations)
    if (relationTargets.length === 0) continue
    matches.push({
      model,
      fieldName: null,
      matchedBy: relationTargets,
      linkType: 'uses_model',
    })
  }
  return matches
}

function modelTermsFromItem(item: DataDictionaryItem): { modelTerms: Set<string>; fieldTerms: Set<string>; explicitModelIds: Set<string> } {
  const modelTerms = normalizedSet([item.title])
  const fieldTerms = new Set<string>()
  const explicitModelIds = new Set<string>()
  const content = item.content
  addModelIdentityTerms({ modelTerms, explicitModelIds }, content)
  if (isRecord(content.storage)) addModelIdentityTerms({ modelTerms, explicitModelIds }, content.storage)
  addRecordTerms(modelTerms, content, ['entity', 'name', 'table_name', 'model', 'model_name'])
  addRefs(modelTerms, content.source_refs)
  addRefs(modelTerms, content.source_mapping)

  const fields = content.fields
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!isRecord(field)) continue
      addRecordTerms(fieldTerms, field, ['name', 'column_name'])
      addModelIdentityTerms({ modelTerms, explicitModelIds }, field)
      addRefs(modelTerms, field.source_refs)
      addRefs(modelTerms, field.source_mapping)
    }
  }

  return { modelTerms, fieldTerms, explicitModelIds }
}

function matchedFieldNames(model: Model, fieldTerms: Set<string>): string[] {
  const result: string[] = []
  for (const field of model.fields) {
    const names = normalizedSet([field.name])
    if ([...fieldTerms].some((term) => names.has(term))) result.push(field.name)
  }
  return result.sort()
}

function addRecordTerms(target: Set<string>, record: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) target.add(normalize(value))
  }
}

function addModelIdentityTerms(
  target: { modelTerms: Set<string>; explicitModelIds: Set<string> },
  record: Record<string, unknown>,
): void {
  for (const key of ['model_id', 'modelId']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      target.explicitModelIds.add(normalize(value))
      target.modelTerms.add(normalize(value))
    }
  }
  addRecordTerms(target.modelTerms, record, ['model_name', 'modelName', 'table_name', 'tableName'])
}

function addRefs(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      target.add(normalize(entry))
      continue
    }
    if (!isRecord(entry)) continue
    for (const key of ['sourceRef', 'modelId', 'model', 'tableName']) {
      const ref = entry[key]
      if (typeof ref === 'string' && ref.trim()) target.add(normalize(ref))
    }
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function loadItemDbAccessRelations(db: MaterializeGraphDb, itemIds: string[]): Map<string, DocRelationLink[]> {
  if (itemIds.length === 0) return new Map()
  const rows = db.select({
    itemId: documentItemDocumentLinks.fromItemId,
    relation: docRelationLinks,
  })
    .from(documentItemDocumentLinks)
    .innerJoin(docRelationLinks, eq(docRelationLinks.documentId, documentItemDocumentLinks.toDocumentId))
    .where(and(
      inArray(documentItemDocumentLinks.fromItemId, itemIds),
      eq(docRelationLinks.kind, 'db_access'),
    ))
    .all()
  const result = new Map<string, DocRelationLink[]>()
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.itemId}:${relationKey(row.relation)}`
    if (seen.has(key)) continue
    seen.add(key)
    const bucket = result.get(row.itemId) ?? []
    bucket.push(row.relation)
    result.set(row.itemId, bucket)
  }
  return result
}

function relationTermsForModel(model: Model, relations: DocRelationLink[]): string[] {
  const modelNames = normalizedSet([model.name, model.tableName])
  const matched: string[] = []
  for (const relation of relations) {
    for (const value of [relation.canonicalTarget, relation.target]) {
      const normalized = normalizeDbTarget(value)
      if (value && normalized && modelNames.has(normalized)) matched.push(value)
    }
  }
  return [...new Set(matched)].sort()
}

function normalizeDbTarget(target: string | null): string | null {
  if (!target) return null
  return target
    .replace(/^db:/, '')
    .split(':')[0]
    .trim()
    .toLowerCase()
    .replace(/^["'`]|["'`]$/g, '')
    || null
}

function relationLinkId(itemId: string, relation: DocRelationLink): string {
  return [
    'ddrel',
    itemId,
    relation.documentId,
    relation.kind,
    relation.canonicalTarget ?? relation.target ?? '',
    relation.operation ?? '',
  ].map((part) => part.replace(/[^a-zA-Z0-9:_-]/g, '_')).join(':')
}

function relationKey(relation: DocRelationLink): string {
  return [
    relation.documentId,
    relation.kind,
    relation.canonicalTarget ?? relation.target ?? '',
    relation.operation ?? '',
  ].join(':')
}

function withRelationCounts(
  result: MaterializeBusinessGraphResult,
  deletedRelationLinks: number,
  createdRelationLinks: number,
): MaterializeBusinessGraphResult {
  return {
    ...result,
    ...(deletedRelationLinks > 0 ? { deletedRelationLinks } : {}),
    ...(createdRelationLinks > 0 ? { createdRelationLinks } : {}),
  }
}

function normalizedSet(values: Array<string | null | undefined>): Set<string> {
  const result = new Set<string>()
  for (const value of values) {
    if (!value) continue
    result.add(normalize(value))
  }
  return result
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
