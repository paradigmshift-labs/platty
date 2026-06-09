import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { docDeps, docRelationLinks, documents } from '@/db/schema/build_docs.js'
import type { CollectedContract, GroupContext, PersistResult, SynthesisResult } from './types.js'

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
type WriteDb = DB | Tx

export interface DocumentRow {
  id: string
  projectId: string
  type: string
  track: string
  scope: string
  scopeId: string | null
  status: string
  validity: string
  summary: string | null
  content: Record<string, unknown> | null
  rawLlmOutput: string
  sourceRunId: string | null
  sourceCommit: string | null
  updatedAt: string
}

export interface DocDepRow {
  documentId: string
  codeNodeId: string
  depType: 'entrypoint' | 'dependency'
}

export interface DocRelationLinkRow {
  documentId: string
  relationId: string
  repoId: string
  sourceNodeId: string
  kind: GroupContext['relations'][number]['kind']
  target: string | null
  operation: string | null
  canonicalTarget: string | null
  payloadJson: Record<string, unknown> | null
  evidenceNodeIdsJson: string[]
  confidence: GroupContext['relations'][number]['confidence']
  unresolvedReason: string | null
}

export async function persistDocument(
  context: GroupContext,
  synthesis: SynthesisResult,
  projectId: string,
  db: DB,
  source?: { runId?: string | null; commit?: string | null },
): Promise<PersistResult> {
  const row = buildDocumentRow(context, synthesis, projectId, source)
  const deps = buildDocDepRows(row.id, context.contracts)
  const relationLinks = buildDocRelationLinkRows(row.id, context.relations)

  db.transaction((tx) => {
    upsertDocument(row, tx)
    replaceDocDeps(row.id, deps, tx)
    replaceDocRelationLinks(row.id, relationLinks, tx)
  })

  return {
    upserted_docs: 1,
    upserted_deps: deps.length,
    document_id: row.id,
  }
}

export function buildDocumentRow(
  context: GroupContext,
  synthesis: SynthesisResult,
  projectId: string,
  source?: { runId?: string | null; commit?: string | null },
): DocumentRow {
  return {
    id: context.group.documentId,
    projectId,
    type: context.group.documentType,
    track: 'technical',
    scope: documentScope(context.group.documentType),
    scopeId: context.group.primaryEntryPointId,
    status: synthesis.status === 'ok' ? 'passed' : 'failed',
    validity: synthesis.status === 'ok' ? 'fresh' : 'stale',
    summary: extractSummary(synthesis.document),
    content: synthesis.status === 'ok'
      ? {
          ...synthesis.document,
          relation_evidence_checked: true,
        }
      : null,
    rawLlmOutput: synthesis.rawLlmOutput,
    sourceRunId: source?.runId ?? null,
    sourceCommit: source?.commit ?? null,
    updatedAt: new Date().toISOString(),
  }
}

export function buildDocDepRows(
  documentId: string,
  contracts: CollectedContract[],
): DocDepRow[] {
  const seen = new Set<string>()
  const rows: DocDepRow[] = []

  for (const contract of contracts) {
    const key = `${documentId}:${contract.nodeId}:${contract.depType}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      documentId,
      codeNodeId: contract.nodeId,
      depType: contract.depType,
    })
  }

  return rows
}

export function buildDocRelationLinkRows(
  documentId: string,
  relations: GroupContext['relations'],
): DocRelationLinkRow[] {
  const seen = new Set<string>()
  const rows: DocRelationLinkRow[] = []

  for (const relation of relations) {
    const key = `${documentId}:${relation.relationId}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      documentId,
      relationId: relation.relationId,
      repoId: relation.repoId,
      sourceNodeId: relation.sourceNodeId,
      kind: relation.kind,
      target: relation.target,
      operation: relation.operation,
      canonicalTarget: relation.canonicalTarget ?? relationPayloadCanonicalTarget(relation) ?? canonicalizeTarget(relation.kind, {
        target: relation.target,
        operation: relation.operation,
        payload: relation.payload,
      }),
      payloadJson: relation.payload ?? null,
      evidenceNodeIdsJson: relation.evidenceNodeIds,
      confidence: relation.confidence,
      unresolvedReason: relation.unresolvedReason,
    })
  }

  return rows
}

export function upsertDocument(row: DocumentRow, db: WriteDb): void {
  db.insert(documents)
    .values(row)
    .onConflictDoUpdate({
      target: documents.id,
      set: {
        projectId: row.projectId,
        type: row.type,
        track: row.track,
        scope: row.scope,
        scopeId: row.scopeId,
        status: row.status,
        validity: row.validity,
        summary: row.summary,
        content: row.content,
        rawLlmOutput: row.rawLlmOutput,
        sourceRunId: row.sourceRunId,
        sourceCommit: row.sourceCommit,
        updatedAt: row.updatedAt,
      },
    })
    .run()
}

export function replaceDocDeps(documentId: string, rows: DocDepRow[], db: WriteDb): void {
  db.delete(docDeps).where(eq(docDeps.documentId, documentId)).run()
  for (const row of rows) {
    db.insert(docDeps).values(row).run()
  }
}

export function replaceDocRelationLinks(documentId: string, rows: DocRelationLinkRow[], db: WriteDb): void {
  db.delete(docRelationLinks).where(eq(docRelationLinks.documentId, documentId)).run()
  for (const row of rows) {
    db.insert(docRelationLinks).values(row).run()
  }
}

function documentScope(documentType: string): string {
  if (documentType === 'screen_spec') return 'screen'
  if (documentType === 'schedule_spec') return 'schedule'
  if (documentType === 'event_spec') return 'event'
  return 'route'
}

function extractSummary(document: SynthesisResult['document']): string | null {
  if (!document || typeof document !== 'object') return null
  const summary = (document as { summary?: unknown }).summary
  return typeof summary === 'string' ? summary : null
}

function relationPayloadCanonicalTarget(relation: GroupContext['relations'][number]): string | null {
  const canonicalTarget = relation.payload['canonical_target']
  return typeof canonicalTarget === 'string' && canonicalTarget.length > 0 ? canonicalTarget : null
}

function canonicalizeTarget(
  kind: GroupContext['relations'][number]['kind'],
  opts: {
    target?: string | null
    operation?: string | null
    payload?: Record<string, unknown>
  },
): string | null {
  const { target, operation, payload } = opts
  if (kind === 'db_access') {
    const table = (payload?.table as string | undefined) ?? target
    if (!table) return null
    return `db:${table}:${operation ?? 'unknown'}`
  }
  if (kind === 'api_call') {
    if (!target) return null
    const op = operation?.toLowerCase()
    if (op === 'graphql') return `graphql:${target}`
    if (op === 'trpc') return `trpc:${target}`
    if (!target.startsWith('/') && !target.startsWith('http')) return null
    return `${(operation ?? 'UNKNOWN').toUpperCase()} ${target}`
  }
  if (kind === 'navigation') {
    if (!target) return null
    if (target.startsWith('http://') || target.startsWith('https://')) return `external:${target}`
    return `screen:${target}`
  }
  if (kind === 'external_link') return target ? `external:${target}` : null
  if (kind === 'external_service') return target ? `external_service:${target}` : null
  if (kind === 'event_publish' || kind === 'event_listen') return canonicalizeEventTarget(target, payload)
  if (kind === 'schedule_trigger') return target ?? null
  return null
}

function canonicalizeEventTarget(target: string | null | undefined, payload: Record<string, unknown> | undefined): string | null {
  const broker = (payload?.broker as string | undefined) ?? ''
  const topic = (payload?.topic as string | undefined) ?? ''
  const name = target ?? (payload?.event as string | undefined) ?? null
  if (!name && !topic) return null
  const raw = topic || name
  if (raw) {
    const prefix = raw.split(':')[0]
    if (['bull', 'kafka', 'sqs', 'sns', 'rabbitmq', 'nats', 'websocket', 'nest_rpc', 'node_event', 'supabase_realtime', 'firebase_firestore', 'ably', 'pusher'].includes(prefix)) return raw
  }
  if (broker === 'bull' || broker === 'bee-queue') return topic || name ? `bull:${topic || name}` : null
  if (broker) return topic || name ? `${broker}:${topic || name}` : null
  return name
}
