import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  documentItemDocumentLinks,
  documentItemItemLinks,
  documentItemRelationLinks,
  documentItems,
  documentLinkEvidence,
  documentLinks,
  documents,
} from '@/db/schema/build_docs.js'
import { epicDocumentLinks } from '@/db/schema/build_epics.js'

type BusinessDocGraphCleanupDb = Pick<DB, 'delete' | 'run' | 'select' | 'update'>
type BusinessDocGraphInvariantDb = Pick<DB, 'all'>

export interface CleanupBusinessDocGraphInput {
  projectId: string
  documentIds: string[]
  now: string
}

export interface BusinessDocGraphInvariantViolation {
  code:
    | 'ACTIVE_ITEM_UNDER_ORPHANED_BUSINESS_DOC'
    | 'FTS_ROW_UNDER_ORPHANED_BUSINESS_DOC'
    | 'ACTIVE_ITEM_LINK_TO_ORPHANED_SOURCE_DOC'
  documentId: string
  itemId?: string
  linkedDocumentId?: string
}

export function cleanupOrphanedBusinessDocumentGraph(db: BusinessDocGraphCleanupDb, input: CleanupBusinessDocGraphInput): void {
  const documentIds = unique(input.documentIds)
  if (documentIds.length === 0) return

  const items = db.select({ id: documentItems.id })
    .from(documentItems)
    .where(inArray(documentItems.documentId, documentIds))
    .all()
  const itemIds = items.map((item) => item.id)

  if (itemIds.length > 0) {
    for (const itemId of itemIds) {
      db.run(sql`DELETE FROM document_items_fts WHERE item_id = ${itemId}`)
    }
    db.delete(documentItemDocumentLinks)
      .where(inArray(documentItemDocumentLinks.fromItemId, itemIds))
      .run()
    db.delete(documentItemItemLinks)
      .where(or(
        inArray(documentItemItemLinks.fromItemId, itemIds),
        inArray(documentItemItemLinks.toItemId, itemIds),
      ))
      .run()
    db.delete(documentItemRelationLinks)
      .where(inArray(documentItemRelationLinks.itemId, itemIds))
      .run()
    db.update(documentItems)
      .set({ status: 'stale', updatedBy: 'system', updatedAt: input.now })
      .where(inArray(documentItems.id, itemIds))
      .run()
  }

  db.delete(documentLinks)
    .where(inArray(documentLinks.fromDocumentId, documentIds))
    .run()
  db.delete(documentLinkEvidence)
    .where(inArray(documentLinkEvidence.fromDocumentId, documentIds))
    .run()
  db.delete(epicDocumentLinks)
    .where(inArray(epicDocumentLinks.documentId, documentIds))
    .run()
}

export function cleanupStaleBusinessDocumentSourceLinks(
  db: BusinessDocGraphCleanupDb,
  input: { projectId: string; documentIds: string[] },
): void {
  const documentIds = unique(input.documentIds)
  if (documentIds.length === 0) return

  const deletedSources = db.select({ id: documents.id })
    .from(documents)
    .where(and(
      eq(documents.projectId, input.projectId),
      or(
        eq(documents.status, 'deleted'),
        eq(documents.validity, 'orphaned'),
      ),
    ))
    .all()
  const deletedSourceIds = deletedSources.map((document) => document.id)
  if (deletedSourceIds.length === 0) return

  const items = db.select({ id: documentItems.id })
    .from(documentItems)
    .where(inArray(documentItems.documentId, documentIds))
    .all()
  const itemIds = items.map((item) => item.id)
  if (itemIds.length > 0) {
    db.delete(documentItemDocumentLinks)
      .where(and(
        inArray(documentItemDocumentLinks.fromItemId, itemIds),
        inArray(documentItemDocumentLinks.toDocumentId, deletedSourceIds),
      ))
      .run()
  }

  db.delete(documentLinks)
    .where(and(
      inArray(documentLinks.fromDocumentId, documentIds),
      inArray(documentLinks.toDocumentId, deletedSourceIds),
    ))
    .run()
  db.delete(documentLinkEvidence)
    .where(and(
      inArray(documentLinkEvidence.fromDocumentId, documentIds),
      inArray(documentLinkEvidence.toDocumentId, deletedSourceIds),
    ))
    .run()
}

export function checkBusinessDocGraphInvariants(db: BusinessDocGraphInvariantDb, input: { projectId: string }): { violations: BusinessDocGraphInvariantViolation[] } {
  const violations: BusinessDocGraphInvariantViolation[] = []
  const activeItemsUnderOrphaned = db.all(sql`
    SELECT d.id AS documentId, i.id AS itemId
    FROM document_items i
    JOIN documents d ON d.id = i.document_id
    WHERE d.project_id = ${input.projectId}
      AND d.track = 'business'
      AND (d.status = 'deleted' OR d.validity = 'orphaned')
      AND i.status = 'active'
  `) as Array<{ documentId: string; itemId: string }>

  for (const row of activeItemsUnderOrphaned) {
    violations.push({
      code: 'ACTIVE_ITEM_UNDER_ORPHANED_BUSINESS_DOC',
      documentId: row.documentId,
      itemId: row.itemId,
    })
  }

  const ftsRowsUnderOrphaned = db.all(sql`
    SELECT d.id AS documentId, i.id AS itemId
    FROM document_items_fts f
    JOIN document_items i ON i.id = f.item_id
    JOIN documents d ON d.id = i.document_id
    WHERE d.project_id = ${input.projectId}
      AND d.track = 'business'
      AND (d.status = 'deleted' OR d.validity = 'orphaned')
  `) as Array<{ documentId: string; itemId: string }>

  for (const row of ftsRowsUnderOrphaned) {
    violations.push({
      code: 'FTS_ROW_UNDER_ORPHANED_BUSINESS_DOC',
      documentId: row.documentId,
      itemId: row.itemId,
    })
  }

  const activeItemLinksToOrphanedSourceDocs = db.all(sql`
    SELECT bd.id AS documentId, i.id AS itemId, sd.id AS linkedDocumentId
    FROM document_item_document_links l
    JOIN document_items i ON i.id = l.from_item_id
    JOIN documents bd ON bd.id = i.document_id
    JOIN documents sd ON sd.id = l.to_document_id
    WHERE bd.project_id = ${input.projectId}
      AND bd.track = 'business'
      AND bd.status = 'active'
      AND i.status = 'active'
      AND (sd.status = 'deleted' OR sd.validity = 'orphaned')
  `) as Array<{ documentId: string; itemId: string; linkedDocumentId: string }>

  for (const row of activeItemLinksToOrphanedSourceDocs) {
    violations.push({
      code: 'ACTIVE_ITEM_LINK_TO_ORPHANED_SOURCE_DOC',
      documentId: row.documentId,
      itemId: row.itemId,
      linkedDocumentId: row.linkedDocumentId,
    })
  }

  return { violations }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))].sort()
}
