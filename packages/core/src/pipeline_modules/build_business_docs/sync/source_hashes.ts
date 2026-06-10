import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { docRelationLinks, documents, type Document } from '@/db/schema/build_docs.js'
import { models } from '@/db/schema/build_models.js'
import { epicDependencies, epicDocumentLinks } from '@/db/schema/build_epics.js'
import { epics, repositories } from '@/db/schema/core.js'
import { staticMerkleSnapshots } from '@/db/schema/sync.js'
import { hashValue, stableStringify } from '@/pipeline_modules/sync/hash.js'
import type {
  BusinessDocsSourceHashResult,
  BusinessDocsSyncTargetDocType,
  BusinessDocsSyncTargetHash,
  BusinessDocsSyncTargetScope,
} from './types.js'

const EPIC_TARGET_DOC_TYPES = ['br', 'data_dictionary', 'design', 'glossary', 'ucl'] as const satisfies BusinessDocsSyncTargetDocType[]
const SOURCE_FIRST_DOC_TYPES = ['br', 'data_dictionary', 'design', 'ucl'] as const satisfies BusinessDocsSyncTargetDocType[]
const LOWER_DOC_TYPES = ['api_spec', 'screen_spec', 'event_spec', 'schedule_spec'] as const
const SOURCE_DOCUMENT_STATUSES = ['active', 'passed'] as const

interface SourceHashInput {
  projectId: string
  epicIds?: string[]
}

type SourceDocumentInput = {
  documentId: string
  documentType: string
  scope: string
  scopeId: string | null
  status: string
  summary: string | null
  contentHash: string | null
  documentSourceHash: string | null
  staticSnapshotId: string | null
  link: {
    role: string
    reason: string
    confidence: string
  }
}

export function computeBusinessDocSourceHashes(db: DB, input: SourceHashInput): BusinessDocsSourceHashResult {
  const latestSnapshot = db.select().from(staticMerkleSnapshots)
    .where(eq(staticMerkleSnapshots.projectId, input.projectId))
    .orderBy(desc(staticMerkleSnapshots.createdAt), desc(staticMerkleSnapshots.id))
    .get()
  const selectedEpicIds = new Set((input.epicIds ?? []).map((id) => id.trim()).filter(Boolean))
  const hasEpicFilter = input.epicIds !== undefined
  const epicRows = db.select().from(epics)
    .where(eq(epics.projectId, input.projectId))
    .all()
    .filter((epic) =>
      epic.confirmedAt !== null &&
      epic.deletedAt === null &&
      (!hasEpicFilter || selectedEpicIds.has(epic.id)))
    .sort((a, b) => a.id.localeCompare(b.id))

  const epicIds = epicRows.map((epic) => epic.id)
  const documentsById = new Map(db.select().from(documents)
    .where(eq(documents.projectId, input.projectId))
    .all()
    .map((document) => [document.id, document]))
  const sourceLinks = epicIds.length === 0
    ? []
    : db.select().from(epicDocumentLinks)
      .where(inArray(epicDocumentLinks.epicId, epicIds))
      .all()
      .sort((a, b) => stableStringify(linkSortKey(a)).localeCompare(stableStringify(linkSortKey(b))))
  const sourceDocumentIds = sortedUnique(sourceLinks
    .flatMap((link) => isIncludedSourceDocument(documentsById.get(link.documentId), link.documentType) ? [link.documentId] : []))
  const relationRows = sourceDocumentIds.length === 0
    ? []
    : db.select().from(docRelationLinks)
      .where(inArray(docRelationLinks.documentId, sourceDocumentIds))
      .all()
      .sort((a, b) => stableStringify(relationSortKey(a)).localeCompare(stableStringify(relationSortKey(b))))
  const dependencyRows = epicIds.length === 0
    ? []
    : db.select().from(epicDependencies)
      .where(or(
        inArray(epicDependencies.sourceEpicId, epicIds),
        inArray(epicDependencies.targetEpicId, epicIds),
      ))
      .all()
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
  const modelRows = loadModelInputs(db, input.projectId, relationRows)

  const sourceDocumentsByEpic = new Map<string, SourceDocumentInput[]>()
  for (const epic of epicRows) sourceDocumentsByEpic.set(epic.id, [])
  for (const link of sourceLinks) {
    const document = documentsById.get(link.documentId)
    if (!isIncludedSourceDocument(document, link.documentType)) continue
    sourceDocumentsByEpic.get(link.epicId)?.push({
      documentId: document.id,
      documentType: document.type,
      scope: document.scope,
      scopeId: document.scopeId,
      status: document.status,
      summary: document.summary,
      contentHash: document.contentHash,
      documentSourceHash: document.documentSourceHash,
      staticSnapshotId: document.staticSnapshotId,
      link: {
        role: link.role,
        reason: link.reason,
        confidence: link.confidence,
      },
    })
  }
  for (const sourceDocuments of sourceDocumentsByEpic.values()) {
    sourceDocuments.sort((a, b) => a.documentId.localeCompare(b.documentId))
  }

  const targets: BusinessDocsSyncTargetHash[] = []
  for (const epic of epicRows) {
    const epicInputs = {
      projectId: input.projectId,
      epic: {
        id: epic.id,
        name: epic.name,
        abbr: epic.abbr,
        stableKey: epic.stableKey,
        summary: epic.summary,
        confirmedAt: epic.confirmedAt,
      },
      sourceDocuments: sourceDocumentsByEpic.get(epic.id) ?? [],
      relationEvidence: relationRows
        .filter((relation) => (sourceDocumentsByEpic.get(epic.id) ?? []).some((document) => document.documentId === relation.documentId))
        .map(projectRelationInput),
      modelEvidence: modelRows
        .filter((model) => model.sourceDocumentIds.some((documentId) =>
          (sourceDocumentsByEpic.get(epic.id) ?? []).some((document) => document.documentId === documentId))),
      dependencies: dependencyRows
        .filter((dependency) => dependency.sourceEpicId === epic.id || dependency.targetEpicId === epic.id)
        .map((dependency) => ({
          sourceEpicId: dependency.sourceEpicId,
          targetEpicId: dependency.targetEpicId,
          kind: dependency.kind,
          reason: dependency.reason,
        })),
    }

    const sourceFirstTargets = SOURCE_FIRST_DOC_TYPES.map((documentType) =>
      makeTarget({
        projectId: input.projectId,
        documentType,
        scope: 'epic',
        scopeId: epic.id,
        epicId: epic.id,
        staticSnapshotId: latestSnapshot?.id ?? null,
        sourceInputs: {
          target: { scope: 'epic', scopeId: epic.id, documentType },
          ...epicInputs,
        },
      }))
    targets.push(...sourceFirstTargets)

    const glossaryInputs = {
      target: { scope: 'epic', scopeId: epic.id, documentType: 'glossary' },
      ...epicInputs,
      upstreamBusinessDocHashes: sourceFirstTargets.map((target) => ({
        key: target.key,
        documentType: target.documentType,
        sourceHash: target.sourceHash,
      })),
    }
    targets.push(makeTarget({
      projectId: input.projectId,
      documentType: 'glossary',
      scope: 'epic',
      scopeId: epic.id,
      epicId: epic.id,
      staticSnapshotId: latestSnapshot?.id ?? null,
      sourceInputs: glossaryInputs,
    }))
  }

  if (epicRows.length > 0) {
    const epicTargetHashes = targets
      .filter((target) => target.scope === 'epic')
      .map((target) => ({
        key: target.key,
        epicId: target.epicId,
        documentType: target.documentType,
        sourceHash: target.sourceHash,
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
    targets.push(makeTarget({
      projectId: input.projectId,
      documentType: 'glossary',
      scope: 'project',
      scopeId: input.projectId,
      epicId: null,
      staticSnapshotId: latestSnapshot?.id ?? null,
      sourceInputs: {
        target: { scope: 'project', scopeId: input.projectId, documentType: 'glossary' },
        projectId: input.projectId,
        epicTargetHashes,
      },
    }))
  }

  return {
    projectId: input.projectId,
    latestStaticSnapshotId: latestSnapshot?.id ?? null,
    targets: targets.sort((a, b) => EPIC_TARGET_DOC_TYPES.indexOf(a.documentType) - EPIC_TARGET_DOC_TYPES.indexOf(b.documentType)
      || a.scope.localeCompare(b.scope)
      || a.scopeId.localeCompare(b.scopeId)),
  }
}

function makeTarget(input: {
  projectId: string
  documentType: BusinessDocsSyncTargetDocType
  scope: BusinessDocsSyncTargetScope
  scopeId: string
  epicId: string | null
  staticSnapshotId: string | null
  sourceInputs: Record<string, unknown>
}): BusinessDocsSyncTargetHash {
  const key = targetKey(input.scope, input.scopeId, input.documentType)
  return {
    key,
    projectId: input.projectId,
    documentType: input.documentType,
    scope: input.scope,
    scopeId: input.scopeId,
    epicId: input.epicId,
    sourceHash: hashValue(input.sourceInputs),
    staticSnapshotId: input.staticSnapshotId,
    sourceInputs: input.sourceInputs,
  }
}

function targetKey(scope: 'epic' | 'project', scopeId: string, documentType: string): string {
  return `${scope}:${scopeId}:${documentType}`
}

function isIncludedSourceDocument(
  document: Document | undefined,
  linkDocumentType: string | undefined,
): document is Document {
  return !!document &&
    document.type === linkDocumentType &&
    LOWER_DOC_TYPES.includes(document.type as typeof LOWER_DOC_TYPES[number]) &&
    document.track === 'technical' &&
    SOURCE_DOCUMENT_STATUSES.includes(document.status as typeof SOURCE_DOCUMENT_STATUSES[number])
}

function projectRelationInput(relation: typeof docRelationLinks.$inferSelect): Record<string, unknown> {
  return {
    documentId: relation.documentId,
    repoId: relation.repoId,
    sourceNodeId: relation.sourceNodeId,
    kind: relation.kind,
    target: relation.target,
    operation: relation.operation,
    canonicalTarget: relation.canonicalTarget,
    payloadJson: relation.payloadJson,
    evidenceNodeIdsJson: relation.evidenceNodeIdsJson,
    confidence: relation.confidence,
    unresolvedReason: relation.unresolvedReason,
  }
}

function loadModelInputs(
  db: DB,
  projectId: string,
  relations: Array<typeof docRelationLinks.$inferSelect>,
): Array<Record<string, unknown> & { sourceDocumentIds: string[] }> {
  if (relations.length === 0) return []
  const repoRows = db.select({ id: repositories.id }).from(repositories)
    .where(and(eq(repositories.projectId, projectId), isNull(repositories.deletedAt)))
    .all()
  const repoIds = new Set(repoRows.map((repo) => repo.id))
  const relationTargets = relations
    .map((relation) => ({
      repoId: relation.repoId,
      modelName: modelNameFromDbRelation(relation.canonicalTarget ?? relation.target),
      documentId: relation.documentId,
    }))
    .filter((target): target is { repoId: string; modelName: string; documentId: string } =>
      repoIds.has(target.repoId) && target.modelName !== null)
  if (relationTargets.length === 0) return []

  const modelRows = db.select().from(models)
    .where(inArray(models.repositoryId, [...new Set(relationTargets.map((target) => target.repoId))]))
    .all()
  return modelRows
    .flatMap((model) => {
      const matchingTargets = relationTargets.filter((target) =>
        target.repoId === model.repositoryId &&
        (target.modelName === model.name || target.modelName === model.tableName))
      if (matchingTargets.length === 0) return []
      return [{
        modelId: model.id,
        repositoryId: model.repositoryId,
        name: model.name,
        tableName: model.tableName,
        fields: model.fields,
        relations: model.relations,
        orm: model.orm,
        validity: model.validity,
        sourceDocumentIds: sortedUnique(matchingTargets.map((target) => target.documentId)),
      }]
    })
    .sort((a, b) => stableStringify({ repositoryId: a.repositoryId, name: a.name }).localeCompare(
      stableStringify({ repositoryId: b.repositoryId, name: b.name }),
    ))
}

function modelNameFromDbRelation(target: string | null): string | null {
  if (!target) return null
  const parts = target.split(':').filter(Boolean)
  if (parts.length >= 2 && parts[0] === 'db') return parts[1]
  return target
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function linkSortKey(link: typeof epicDocumentLinks.$inferSelect): Record<string, unknown> {
  return {
    epicId: link.epicId,
    documentType: link.documentType,
    documentId: link.documentId,
    role: link.role,
  }
}

function relationSortKey(relation: typeof docRelationLinks.$inferSelect): Record<string, unknown> {
  return {
    documentId: relation.documentId,
    repoId: relation.repoId,
    kind: relation.kind,
    canonicalTarget: relation.canonicalTarget,
    target: relation.target,
    operation: relation.operation,
  }
}
