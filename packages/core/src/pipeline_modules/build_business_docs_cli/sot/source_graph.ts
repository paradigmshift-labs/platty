import type { EpicDocumentLink } from '@/db/schema/build_epics.js'
import type {
  BusinessSourceGraph,
  BusinessSourceGraphDocumentNode,
  BusinessSourceGraphModelNode,
  ConfirmedEpic,
  CrossEpicContextItem,
  ModelEvidence,
} from './types.js'
import type { Document, DocRelationLink } from '@/db/schema/build_docs.js'

export function buildBusinessSourceGraph(input: {
  epic: ConfirmedEpic
  sourceDocuments: Document[]
  epicDocumentLinks: EpicDocumentLink[]
  docRelationLinks: DocRelationLink[]
  modelEvidence: ModelEvidence[]
  crossEpicContext?: CrossEpicContextItem[]
}): BusinessSourceGraph {
  const epicRoleByDocumentId = new Map(input.epicDocumentLinks.map((link) => [link.documentId, link.role]))
  const relationTargetsByDocumentId = groupRelationTargets(input.docRelationLinks)
  const modelIdsByDocumentId = new Map<string, Set<string>>()

  for (const evidence of input.modelEvidence) {
    for (const documentId of evidence.sourceDocumentIds) {
      const bucket = modelIdsByDocumentId.get(documentId) ?? new Set<string>()
      bucket.add(evidence.model.id)
      modelIdsByDocumentId.set(documentId, bucket)
    }
  }

  const documents: BusinessSourceGraphDocumentNode[] = input.sourceDocuments.map((doc) => ({
    id: doc.id,
    type: doc.type,
    scope: doc.scope,
    scopeId: doc.scopeId,
    summary: doc.summary,
    contentChars: serializedLength(doc.content),
    epicRole: epicRoleByDocumentId.get(doc.id),
    relationTargets: [...(relationTargetsByDocumentId.get(doc.id) ?? [])].sort(),
    linkedModelIds: [...(modelIdsByDocumentId.get(doc.id) ?? [])].sort(),
  }))

  const models: BusinessSourceGraphModelNode[] = input.modelEvidence.map((evidence) => ({
    id: evidence.model.id,
    name: evidence.model.name,
    tableName: evidence.model.tableName,
    fieldCount: evidence.model.fields.length,
    sourceDocumentIds: evidence.sourceDocumentIds,
    relationTargets: evidence.relationTargets,
  }))

  return {
    epicId: input.epic.id,
    documents,
    models,
    edges: [
      ...input.epicDocumentLinks.map((link) => ({
        from: input.epic.id,
        to: link.documentId,
        kind: 'epic_link' as const,
        label: link.role,
      })),
      ...input.docRelationLinks.map((link) => ({
        from: link.documentId,
        to: link.canonicalTarget ?? link.target ?? link.sourceNodeId,
        kind: 'db_access' as const,
        label: link.kind,
      })),
      ...input.modelEvidence.flatMap((evidence) => evidence.sourceDocumentIds.map((documentId) => ({
        from: documentId,
        to: evidence.model.id,
        kind: 'model_evidence' as const,
        label: evidence.model.tableName,
      }))),
      ...(input.crossEpicContext ?? []).map((item) => ({
        from: item.direction === 'outgoing' ? input.epic.id : item.epic.id,
        to: item.direction === 'outgoing' ? item.epic.id : input.epic.id,
        kind: 'epic_dependency' as const,
        label: item.dependency.kind,
      })),
    ],
  }
}

function groupRelationTargets(links: DocRelationLink[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>()
  for (const link of links) {
    const target = link.canonicalTarget ?? link.target
    if (!target) continue
    const bucket = grouped.get(link.documentId) ?? new Set<string>()
    bucket.add(target)
    grouped.set(link.documentId, bucket)
  }
  return grouped
}

function serializedLength(value: unknown): number {
  if (value === null || value === undefined) return 0
  try {
    return JSON.stringify(value).length
  } catch {
    return String(value).length
  }
}
