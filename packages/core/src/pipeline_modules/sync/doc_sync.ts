import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema/index.js'
import { docDeps, docRelationLinks, documentLinks, documents } from '@/db/schema/build_docs.js'
import type { CodeRelationConfidence, CodeRelationKind } from '@/db/schema/build_relations.js'
import {
  docSyncCandidates,
  docSyncOutputs,
  docSyncPlans,
  staticMerkleSnapshots,
  type DocSyncCandidateKind,
  type DocSyncCandidatePhase,
  type DocSyncCandidateStatus,
  type DocSyncPlanStatus,
  type StaticMerkleSnapshot,
} from '@/db/schema/sync.js'
import { hashValue, stableStringify } from './hash.js'

type SyncDb = BetterSQLite3Database<typeof schema>

type Track = 'technical' | 'business'

interface DocumentTarget {
  track: Track
  type: string
  scope: string
  scopeId: string | null
  repoId?: string | null
}

interface HashEntry {
  key: string
  hash: string
  target: DocumentTarget
}

interface CandidateCounts {
  unchanged: number
  newDocument: number
  stale: number
  staleCandidate: number
  orphan: number
}

interface CreateDocSyncPlanInput {
  db: SyncDb
  projectId: string
  fromSnapshotId: 'last_applied' | string | null
  toSnapshotId: 'latest' | string
  scope?: {
    track?: Track
    repoIds?: string[]
    documentIds?: string[]
  }
}

interface CandidateListInput {
  db: SyncDb
  planId: string
  phase?: DocSyncCandidatePhase
  status?: DocSyncCandidateStatus
  limit?: number
}

interface CandidateContextInput {
  db: SyncDb
  planId: string
  candidateId: string
  detail?: 'compact' | 'full'
}

interface MarkCandidateInput {
  db: SyncDb
  planId: string
  candidateId: string
  decision: 'fresh' | 'orphan' | 'skip'
  rationale: string
}

interface StageOutputInput {
  db: SyncDb
  planId: string
  candidateId: string
  document: {
    summary: string
    content: Record<string, unknown>
    rawOutput?: string
    docDeps?: Array<{ codeNodeId: string; depType: string }>
    docRelationLinks?: Array<{
      relationId?: string | null
      repoId: string
      sourceNodeId: string
      kind: CodeRelationKind
      target?: string | null
      operation?: string | null
      canonicalTarget?: string | null
      payloadJson?: Record<string, unknown> | null
      evidenceNodeIdsJson: string[]
      confidence: CodeRelationConfidence
      unresolvedReason?: string | null
    }>
    documentLinks?: Array<{
      toDocumentId: string
      linkType: string
      createdBy?: string
    }>
  }
  evidence: Record<string, unknown>
}

interface AdvancePhaseInput {
  db: SyncDb
  planId: string
  nextPhase: 'business'
}

interface ApplyDocSyncPlanInput {
  db: SyncDb
  planId: string
}

export function createDocSyncPlan(input: CreateDocSyncPlanInput): {
  planId: string
  status: DocSyncPlanStatus
  fromSnapshotId: string | null
  toSnapshotId: string
  counts: CandidateCounts
} {
  const toSnapshot = resolveSnapshot(input.db, input.projectId, input.toSnapshotId)
  const fromSnapshot = input.fromSnapshotId
    ? resolveSnapshot(input.db, input.projectId, input.fromSnapshotId, toSnapshot.id)
    : null
  const planId = `doc_sync_plan:${nanoid()}`

  const { candidates, counts } = buildCandidates({
    db: input.db,
    projectId: input.projectId,
    phase: 'technical',
    oldEntries: entriesByKey(technicalHashEntries(fromSnapshot)),
    newEntries: entriesByKey(technicalHashEntries(toSnapshot)),
    oldReasonInputs: reasonInputs(fromSnapshot),
    newReasonInputs: reasonInputs(toSnapshot),
    scope: input.scope,
  })

  input.db.transaction((tx) => {
    tx.insert(docSyncPlans).values({
      id: planId,
      projectId: input.projectId,
      fromSnapshotId: fromSnapshot?.id ?? null,
      toSnapshotId: toSnapshot.id,
      status: 'technical_pending',
      countsJson: countsToJson(counts),
    }).run()
    for (const candidate of candidates) {
      tx.insert(docSyncCandidates).values({
        id: `doc_sync_candidate:${nanoid()}`,
        planId,
        phase: candidate.phase,
        kind: candidate.kind,
        status: 'pending',
        targetJson: targetToJson(candidate.target),
        oldHash: candidate.oldHash,
        newHash: candidate.newHash,
        reasonInputsJson: candidate.reasonInputs,
      }).run()
    }
  })

  return {
    planId,
    status: 'technical_pending',
    fromSnapshotId: fromSnapshot?.id ?? null,
    toSnapshotId: toSnapshot.id,
    counts,
  }
}

export function listDocSyncCandidates(input: CandidateListInput): {
  candidates: Array<{
    candidateId: string
    phase: DocSyncCandidatePhase
    kind: DocSyncCandidateKind
    status: DocSyncCandidateStatus
    target: DocumentTarget
    oldHash: string | null
    newHash: string | null
    reasonSummary: string
  }>
} {
  let rows = input.db.select().from(docSyncCandidates).where(eq(docSyncCandidates.planId, input.planId)).all()
  if (input.phase) rows = rows.filter((row) => row.phase === input.phase)
  if (input.status) rows = rows.filter((row) => row.status === input.status)
  rows = rows.sort((a, b) => stableStringify(a.targetJson).localeCompare(stableStringify(b.targetJson)))
  if (input.limit != null) rows = rows.slice(0, input.limit)

  return {
    candidates: rows.map((row) => ({
      candidateId: row.id,
      phase: row.phase,
      kind: row.kind,
      status: row.status,
      target: asTarget(row.targetJson),
      oldHash: row.oldHash,
      newHash: row.newHash,
      reasonSummary: summarizeReason(row.reasonInputsJson),
    })),
  }
}

export function getDocSyncCandidateContext(input: CandidateContextInput): {
  candidateId: string
  kind: DocSyncCandidateKind
  oldHash: string | null
  newHash: string | null
  target: DocumentTarget
  existingDocument?: {
    id: string
    summary: string | null
    contentHash: string | null
    documentSourceHash: string | null
    content: Record<string, unknown> | null
  }
  reasonInputs: Record<string, unknown>
} {
  const plan = requirePlan(input.db, input.planId)
  const candidate = requireCandidate(input.db, input.planId, input.candidateId)
  const target = asTarget(candidate.targetJson)
  const existing = findDocument(input.db, plan.projectId, target)

  return {
    candidateId: candidate.id,
    kind: candidate.kind,
    oldHash: candidate.oldHash,
    newHash: candidate.newHash,
    target,
    existingDocument: existing
      ? {
          id: existing.id,
          summary: existing.summary,
          contentHash: existing.contentHash,
          documentSourceHash: existing.documentSourceHash,
          content: existing.content,
        }
      : undefined,
    reasonInputs: asRecord(candidate.reasonInputsJson),
  }
}

export function markDocSyncCandidate(input: MarkCandidateInput): {
  candidateId: string
  status: 'resolved' | 'skipped'
} {
  if (!input.rationale.trim()) throw new Error('Candidate decision requires a rationale.')
  const plan = requirePlan(input.db, input.planId)
  assertPlanMutable(plan)
  const candidate = requireCandidate(input.db, input.planId, input.candidateId)

  if (input.decision === 'fresh' && candidate.kind !== 'stale_candidate') {
    throw new Error('fresh decision is allowed only for stale_candidate candidates.')
  }
  if (input.decision === 'fresh' && !findDocument(input.db, plan.projectId, asTarget(candidate.targetJson))) {
    throw new Error('fresh decision requires an existing document to restamp.')
  }
  if (input.decision === 'orphan' && candidate.kind !== 'orphan_document') {
    throw new Error('orphan decision is allowed only for orphan_document candidates.')
  }
  if (input.decision === 'skip' && (candidate.kind === 'new_document' || candidate.kind === 'stale')) {
    throw new Error('new_document and stale candidates must be staged before apply.')
  }

  const status = input.decision === 'skip' ? 'skipped' : 'resolved'
  input.db.update(docSyncCandidates)
    .set({
      status,
      decision: input.decision,
      rationale: input.rationale,
      updatedAt: now(),
    })
    .where(eq(docSyncCandidates.id, input.candidateId))
    .run()

  return { candidateId: input.candidateId, status }
}

export function stageDocSyncOutput(input: StageOutputInput): {
  candidateId: string
  status: 'staged'
  contentHash: string
} {
  assertPlanMutable(requirePlan(input.db, input.planId))
  const candidate = requireCandidate(input.db, input.planId, input.candidateId)
  if (candidate.kind === 'orphan_document') throw new Error('orphan_document candidates cannot stage document output.')
  validateEvidence(asTarget(candidate.targetJson), input.evidence)
  const contentHash = hashValue(input.document)

  input.db.transaction((tx) => {
    tx.delete(docSyncOutputs).where(eq(docSyncOutputs.candidateId, input.candidateId)).run()
    tx.insert(docSyncOutputs).values({
      id: `doc_sync_output:${nanoid()}`,
      planId: input.planId,
      candidateId: input.candidateId,
      documentJson: input.document,
      evidenceJson: input.evidence,
      contentHash,
    }).run()
    tx.update(docSyncCandidates)
      .set({ status: 'staged', updatedAt: now() })
      .where(eq(docSyncCandidates.id, input.candidateId))
      .run()
  })

  return {
    candidateId: input.candidateId,
    status: 'staged',
    contentHash,
  }
}

export function advanceDocSyncPlanPhase(input: AdvancePhaseInput): {
  planId: string
  status: 'business_pending' | 'ready_to_apply'
  counts: Omit<CandidateCounts, 'unchanged'>
} {
  const plan = requirePlan(input.db, input.planId)
  assertPlanMutable(plan)
  if (plan.status !== 'technical_pending') {
    if (plan.status === 'business_pending') {
      const pendingBusiness = input.db.select().from(docSyncCandidates).where(eq(docSyncCandidates.planId, input.planId)).all()
        .filter((candidate) => candidate.phase === 'business' && candidate.status === 'pending')
      if (pendingBusiness.length === 0) {
        input.db.update(docSyncPlans)
          .set({ status: 'ready_to_apply', updatedAt: now() })
          .where(eq(docSyncPlans.id, input.planId))
          .run()
        return {
          planId: input.planId,
          status: 'ready_to_apply',
          counts: businessCounts(input.db, input.planId),
        }
      }
    }
    return {
      planId: input.planId,
      status: plan.status === 'business_pending' ? 'business_pending' : 'ready_to_apply',
      counts: businessCounts(input.db, input.planId),
    }
  }

  const pendingTechnical = input.db.select().from(docSyncCandidates).where(eq(docSyncCandidates.planId, input.planId)).all()
    .filter((candidate) => candidate.phase === 'technical' && candidate.status === 'pending')
  if (pendingTechnical.length > 0) {
    throw new Error('Cannot advance while pending technical candidates remain.')
  }

  const fromSnapshot = plan.fromSnapshotId ? requireSnapshot(input.db, plan.projectId, plan.fromSnapshotId) : null
  const toSnapshot = requireSnapshot(input.db, plan.projectId, plan.toSnapshotId)
  const { candidates, counts } = buildCandidates({
    db: input.db,
    projectId: plan.projectId,
    phase: 'business',
    oldEntries: entriesByKey(hashEntries(fromSnapshot, 'businessDocumentSourceHashes')),
    newEntries: entriesByKey(hashEntries(toSnapshot, 'businessDocumentSourceHashes')),
    oldReasonInputs: reasonInputs(fromSnapshot),
    newReasonInputs: reasonInputs(toSnapshot),
  })
  const status: 'business_pending' | 'ready_to_apply' = candidates.length > 0 ? 'business_pending' : 'ready_to_apply'

  input.db.transaction((tx) => {
    for (const candidate of candidates) {
      tx.insert(docSyncCandidates).values({
        id: `doc_sync_candidate:${nanoid()}`,
        planId: input.planId,
        phase: candidate.phase,
        kind: candidate.kind,
        status: 'pending',
        targetJson: targetToJson(candidate.target),
        oldHash: candidate.oldHash,
        newHash: candidate.newHash,
        reasonInputsJson: candidate.reasonInputs,
      }).run()
    }
    tx.update(docSyncPlans)
      .set({
        status,
        countsJson: { ...asRecord(plan.countsJson), business: countsToJson(counts) },
        updatedAt: now(),
      })
      .where(eq(docSyncPlans.id, input.planId))
      .run()
  })

  return {
    planId: input.planId,
    status,
    counts: {
      newDocument: counts.newDocument,
      stale: counts.stale,
      staleCandidate: counts.staleCandidate,
      orphan: counts.orphan,
    },
  }
}

export function applyDocSyncPlan(input: ApplyDocSyncPlanInput): {
  planId: string
  status: 'applied'
  appliedDocuments: number
} {
  const plan = requirePlan(input.db, input.planId)
  if (plan.status !== 'ready_to_apply') {
    throw new Error('doc sync plan must be ready_to_apply before apply.')
  }
  const candidates = input.db.select().from(docSyncCandidates).where(eq(docSyncCandidates.planId, input.planId)).all()
  for (const candidate of candidates) {
    if ((candidate.kind === 'new_document' || candidate.kind === 'stale') && candidate.status !== 'staged') {
      throw new Error('Missing staged document output for new_document or stale candidate.')
    }
    if (candidate.kind === 'stale_candidate' && candidate.status === 'pending') {
      throw new Error('stale_candidate remains pending.')
    }
    if (candidate.kind === 'orphan_document' && candidate.status === 'pending') {
      throw new Error('orphan_document remains pending.')
    }
  }

  const outputs = input.db.select().from(docSyncOutputs).where(eq(docSyncOutputs.planId, input.planId)).all()
  input.db.transaction((tx) => {
    for (const output of outputs) {
      const candidate = candidates.find((row) => row.id === output.candidateId)
      if (!candidate) throw new Error(`Missing candidate for output ${output.id}.`)
      const target = asTarget(candidate.targetJson)
      const existing = findDocument(tx as SyncDb, plan.projectId, target)
      const document = asGeneratedDocument(output.documentJson)
      const documentId = existing?.id ?? `doc:${nanoid()}`
      const values = {
        projectId: plan.projectId,
        type: target.type,
        track: target.track,
        scope: target.scope,
        scopeId: target.scopeId,
        status: 'passed',
        validity: 'fresh',
        summary: document.summary,
        content: document.content,
        rawLlmOutput: document.rawOutput ?? '',
        contentHash: output.contentHash,
        documentSourceHash: candidate.newHash,
        staticSnapshotId: plan.toSnapshotId,
        updatedBy: 'llm' as const,
        updatedAt: now(),
      }
      if (existing) {
        tx.update(documents).set(values).where(eq(documents.id, existing.id)).run()
      } else {
        tx.insert(documents).values({ id: documentId, ...values }).run()
      }
      replaceDocumentGraph(tx as SyncDb, documentId, document)
    }

    for (const candidate of candidates.filter((row) => row.kind === 'stale_candidate' && row.decision === 'fresh')) {
      const target = asTarget(candidate.targetJson)
      const existing = findDocument(tx as SyncDb, plan.projectId, target)
      if (existing) {
        tx.update(documents)
          .set({
            status: 'passed',
            validity: 'fresh',
            documentSourceHash: candidate.newHash,
            staticSnapshotId: plan.toSnapshotId,
            updatedAt: now(),
          })
          .where(eq(documents.id, existing.id))
          .run()
      }
    }

    for (const candidate of candidates.filter((row) => row.kind === 'orphan_document' && row.decision === 'orphan')) {
      const target = asTarget(candidate.targetJson)
      const existing = findDocument(tx as SyncDb, plan.projectId, target)
      if (existing) {
        tx.update(documents)
          .set({ status: 'deleted', validity: 'orphaned', updatedAt: now() })
          .where(eq(documents.id, existing.id))
          .run()
      }
    }

    tx.update(docSyncPlans)
      .set({ status: 'applied', updatedAt: now() })
      .where(eq(docSyncPlans.id, input.planId))
      .run()
  })

  return {
    planId: input.planId,
    status: 'applied',
    appliedDocuments: outputs.length,
  }
}

function buildCandidates(input: {
  db: SyncDb
  projectId: string
  phase: DocSyncCandidatePhase
  oldEntries: Map<string, HashEntry>
  newEntries: Map<string, HashEntry>
  oldReasonInputs: Record<string, unknown>
  newReasonInputs: Record<string, unknown>
  scope?: CreateDocSyncPlanInput['scope']
}): {
  candidates: Array<{
    phase: DocSyncCandidatePhase
    kind: DocSyncCandidateKind
    target: DocumentTarget
    oldHash: string | null
    newHash: string | null
    reasonInputs: Record<string, unknown>
  }>
  counts: CandidateCounts
} {
  const counts: CandidateCounts = { unchanged: 0, newDocument: 0, stale: 0, staleCandidate: 0, orphan: 0 }
  const candidates: Array<{
    phase: DocSyncCandidatePhase
    kind: DocSyncCandidateKind
    target: DocumentTarget
    oldHash: string | null
    newHash: string | null
    reasonInputs: Record<string, unknown>
  }> = []
  const keys = Array.from(new Set([...input.oldEntries.keys(), ...input.newEntries.keys()])).sort()

  for (const key of keys) {
    const oldEntry = input.oldEntries.get(key)
    const newEntry = input.newEntries.get(key)
    const target = newEntry?.target ?? oldEntry?.target
    if (!target) continue
    if (!targetInScope(input.db, input.projectId, target, input.scope)) continue
    if (oldEntry && newEntry && oldEntry.hash === newEntry.hash) {
      counts.unchanged += 1
      continue
    }

    let kind: DocSyncCandidateKind
    if (!oldEntry && newEntry) {
      kind = 'new_document'
      counts.newDocument += 1
    } else if (oldEntry && !newEntry) {
      kind = 'orphan_document'
      counts.orphan += 1
    } else {
      const existing = findDocument(input.db, input.projectId, target)
      kind = existing?.documentSourceHash === oldEntry?.hash ? 'stale' : 'stale_candidate'
      if (kind === 'stale') counts.stale += 1
      else counts.staleCandidate += 1
    }

    candidates.push({
      phase: input.phase,
      kind,
      target,
      oldHash: oldEntry?.hash ?? null,
      newHash: newEntry?.hash ?? null,
      reasonInputs: {
        old: reasonForKey(input.oldReasonInputs, key),
        new: reasonForKey(input.newReasonInputs, key),
      },
    })
  }

  return { candidates, counts }
}

function targetInScope(
  db: SyncDb,
  projectId: string,
  target: DocumentTarget,
  scope?: CreateDocSyncPlanInput['scope'],
): boolean {
  if (!scope) return true
  if (scope.track && target.track !== scope.track) return false
  if (scope.repoIds?.length && (!target.repoId || !scope.repoIds.includes(target.repoId))) return false
  if (scope.documentIds?.length) {
    const existing = findDocument(db, projectId, target)
    return Boolean(existing && scope.documentIds.includes(existing.id))
  }
  return true
}

type HashSetField =
  | 'technicalDocumentSourceHashes'
  | 'routeDocumentSourceHashes'
  | 'modelDocumentSourceHashes'
  | 'businessDocumentSourceHashes'

function technicalHashEntries(snapshot: StaticMerkleSnapshot | null): HashEntry[] {
  return uniqueEntries([
    ...hashEntries(snapshot, 'technicalDocumentSourceHashes'),
    ...hashEntries(snapshot, 'routeDocumentSourceHashes'),
    ...hashEntries(snapshot, 'modelDocumentSourceHashes'),
  ])
}

function uniqueEntries(entries: HashEntry[]): HashEntry[] {
  const byKey = new Map<string, HashEntry>()
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry)
  }
  return Array.from(byKey.values())
}

function hashEntries(snapshot: StaticMerkleSnapshot | null, field: HashSetField): HashEntry[] {
  if (!snapshot) return []
  const raw = snapshot.hashSetJson[field]
  if (Array.isArray(raw)) return raw.map(asHashEntry).filter((entry): entry is HashEntry => Boolean(entry))
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => asHashEntry({ key, ...(typeof value === 'object' && value ? value as Record<string, unknown> : { hash: value }) }))
      .filter((entry): entry is HashEntry => Boolean(entry))
  }
  return []
}

function entriesByKey(entries: HashEntry[]): Map<string, HashEntry> {
  return new Map(entries.map((entry) => [entry.key, entry]))
}

function asHashEntry(value: unknown): HashEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.key !== 'string' || typeof record.hash !== 'string') return null
  return {
    key: record.key,
    hash: record.hash,
    target: asTarget(record.target),
  }
}

function asTarget(value: unknown): DocumentTarget {
  if (!value || typeof value !== 'object') throw new Error('Invalid document target.')
  const record = value as Record<string, unknown>
  if (record.track !== 'technical' && record.track !== 'business') throw new Error('Invalid document target track.')
  if (typeof record.type !== 'string' || typeof record.scope !== 'string') throw new Error('Invalid document target.')
  return {
    track: record.track,
    type: record.type,
    scope: record.scope,
    scopeId: typeof record.scopeId === 'string' ? record.scopeId : null,
    repoId: typeof record.repoId === 'string' ? record.repoId : null,
  }
}

function targetToJson(target: DocumentTarget): Record<string, unknown> {
  return {
    track: target.track,
    type: target.type,
    scope: target.scope,
    scopeId: target.scopeId,
    repoId: target.repoId ?? null,
  }
}

function countsToJson(counts: CandidateCounts): Record<string, unknown> {
  return {
    unchanged: counts.unchanged,
    newDocument: counts.newDocument,
    stale: counts.stale,
    staleCandidate: counts.staleCandidate,
    orphan: counts.orphan,
  }
}

function asGeneratedDocument(value: unknown): {
  summary: string
  content: Record<string, unknown>
  rawOutput?: string
  docDeps: Array<{ codeNodeId: string; depType: string }>
  docRelationLinks: Array<{
    relationId: string | null
    repoId: string
    sourceNodeId: string
    kind: CodeRelationKind
    target: string | null
    operation: string | null
    canonicalTarget: string | null
    payloadJson: Record<string, unknown> | null
    evidenceNodeIdsJson: string[]
    confidence: CodeRelationConfidence
    unresolvedReason: string | null
  }>
  documentLinks: Array<{ toDocumentId: string; linkType: string; createdBy: string }>
} {
  if (!value || typeof value !== 'object') throw new Error('Invalid staged document output.')
  const record = value as Record<string, unknown>
  if (typeof record.summary !== 'string') throw new Error('Invalid staged document summary.')
  if (!record.content || typeof record.content !== 'object' || Array.isArray(record.content)) throw new Error('Invalid staged document content.')
  return {
    summary: record.summary,
    content: record.content as Record<string, unknown>,
    rawOutput: typeof record.rawOutput === 'string' ? record.rawOutput : undefined,
    docDeps: asDocDeps(record.docDeps),
    docRelationLinks: asDocRelationLinks(record.docRelationLinks),
    documentLinks: asDocumentLinks(record.documentLinks),
  }
}

function asDocDeps(value: unknown): Array<{ codeNodeId: string; depType: string }> {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('Invalid staged document docDeps.')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid staged document docDeps.')
    const record = item as Record<string, unknown>
    if (typeof record.codeNodeId !== 'string' || typeof record.depType !== 'string') {
      throw new Error('Invalid staged document docDeps.')
    }
    return { codeNodeId: record.codeNodeId, depType: record.depType }
  })
}

function asDocRelationLinks(value: unknown): Array<{
  relationId: string | null
  repoId: string
  sourceNodeId: string
  kind: CodeRelationKind
  target: string | null
  operation: string | null
  canonicalTarget: string | null
  payloadJson: Record<string, unknown> | null
  evidenceNodeIdsJson: string[]
  confidence: CodeRelationConfidence
  unresolvedReason: string | null
}> {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('Invalid staged document docRelationLinks.')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid staged document docRelationLinks.')
    const record = item as Record<string, unknown>
    if (
      typeof record.repoId !== 'string'
      || typeof record.sourceNodeId !== 'string'
      || typeof record.kind !== 'string'
      || !Array.isArray(record.evidenceNodeIdsJson)
      || typeof record.confidence !== 'string'
    ) {
      throw new Error('Invalid staged document docRelationLinks.')
    }
    return {
      relationId: typeof record.relationId === 'string' ? record.relationId : null,
      repoId: record.repoId,
      sourceNodeId: record.sourceNodeId,
      kind: record.kind as CodeRelationKind,
      target: typeof record.target === 'string' ? record.target : null,
      operation: typeof record.operation === 'string' ? record.operation : null,
      canonicalTarget: typeof record.canonicalTarget === 'string' ? record.canonicalTarget : null,
      payloadJson: record.payloadJson && typeof record.payloadJson === 'object' && !Array.isArray(record.payloadJson)
        ? record.payloadJson as Record<string, unknown>
        : null,
      evidenceNodeIdsJson: record.evidenceNodeIdsJson.filter((item): item is string => typeof item === 'string'),
      confidence: record.confidence as CodeRelationConfidence,
      unresolvedReason: typeof record.unresolvedReason === 'string' ? record.unresolvedReason : null,
    }
  })
}

function asDocumentLinks(value: unknown): Array<{ toDocumentId: string; linkType: string; createdBy: string }> {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('Invalid staged document documentLinks.')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid staged document documentLinks.')
    const record = item as Record<string, unknown>
    if (typeof record.toDocumentId !== 'string' || typeof record.linkType !== 'string') {
      throw new Error('Invalid staged document documentLinks.')
    }
    return {
      toDocumentId: record.toDocumentId,
      linkType: record.linkType,
      createdBy: typeof record.createdBy === 'string' ? record.createdBy : 'sync',
    }
  })
}

function replaceDocumentGraph(
  db: SyncDb,
  documentId: string,
  document: ReturnType<typeof asGeneratedDocument>,
): void {
  db.delete(docDeps).where(eq(docDeps.documentId, documentId)).run()
  for (const dep of document.docDeps) {
    db.insert(docDeps).values({ documentId, ...dep }).run()
  }

  db.delete(docRelationLinks).where(eq(docRelationLinks.documentId, documentId)).run()
  for (const link of document.docRelationLinks) {
    db.insert(docRelationLinks).values({ documentId, ...link }).run()
  }

  db.delete(documentLinks).where(eq(documentLinks.fromDocumentId, documentId)).run()
  for (const link of document.documentLinks) {
    db.insert(documentLinks).values({ fromDocumentId: documentId, ...link }).run()
  }
}

function resolveSnapshot(db: SyncDb, projectId: string, id: 'latest' | 'last_applied' | string, beforeSnapshotId?: string): StaticMerkleSnapshot {
  if (id !== 'latest' && id !== 'last_applied') return requireSnapshot(db, projectId, id)
  const snapshots = db.select().from(staticMerkleSnapshots).where(eq(staticMerkleSnapshots.projectId, projectId)).all()
    .filter((snapshot) => !beforeSnapshotId || snapshot.id !== beforeSnapshotId)
    .sort((a, b) => `${b.createdAt}:${b.id}`.localeCompare(`${a.createdAt}:${a.id}`))
  const snapshot = snapshots[0]
  if (!snapshot) throw new Error(`No static Merkle snapshot found for project ${projectId}.`)
  return snapshot
}

function requireSnapshot(db: SyncDb, projectId: string, id: string): StaticMerkleSnapshot {
  const snapshot = db.select().from(staticMerkleSnapshots).where(eq(staticMerkleSnapshots.id, id)).get()
  if (!snapshot || snapshot.projectId !== projectId) throw new Error(`Static Merkle snapshot ${id} was not found for project ${projectId}.`)
  return snapshot
}

function requirePlan(db: SyncDb, planId: string): typeof docSyncPlans.$inferSelect {
  const plan = db.select().from(docSyncPlans).where(eq(docSyncPlans.id, planId)).get()
  if (!plan) throw new Error(`doc sync plan ${planId} was not found.`)
  return plan
}

function assertPlanMutable(plan: typeof docSyncPlans.$inferSelect): void {
  if (plan.status === 'applied' || plan.status === 'failed') {
    throw new Error('doc sync plan is no longer mutable.')
  }
}

function requireCandidate(db: SyncDb, planId: string, candidateId: string): typeof docSyncCandidates.$inferSelect {
  const candidate = db.select().from(docSyncCandidates).where(eq(docSyncCandidates.id, candidateId)).get()
  if (!candidate || candidate.planId !== planId) throw new Error(`doc sync candidate ${candidateId} was not found.`)
  return candidate
}

function findDocument(db: SyncDb, projectId: string, target: DocumentTarget): typeof documents.$inferSelect | undefined {
  return db.select().from(documents).where(eq(documents.projectId, projectId)).all()
    .find((document) => document.type === target.type
      && document.track === target.track
      && document.scope === target.scope
      && document.scopeId === target.scopeId)
}

function reasonInputs(snapshot: StaticMerkleSnapshot | null): Record<string, unknown> {
  if (!snapshot) return {}
  return asRecord(snapshot.reasonInputsJson)
}

function reasonForKey(inputs: Record<string, unknown>, key: string): unknown {
  const byKey = inputs.byKey
  if (byKey && typeof byKey === 'object') return (byKey as Record<string, unknown>)[key] ?? null
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function summarizeReason(value: unknown): string {
  const record = asRecord(value)
  const next = asRecord(record.new)
  const old = asRecord(record.old)
  const keys = new Set([...Object.keys(old), ...Object.keys(next)])
  return keys.size > 0 ? Array.from(keys).sort().join(', ') : 'hash_changed'
}

function businessCounts(db: SyncDb, planId: string): Omit<CandidateCounts, 'unchanged'> {
  const rows = db.select().from(docSyncCandidates).where(eq(docSyncCandidates.planId, planId)).all()
    .filter((candidate) => candidate.phase === 'business')
  return {
    newDocument: rows.filter((row) => row.kind === 'new_document').length,
    stale: rows.filter((row) => row.kind === 'stale').length,
    staleCandidate: rows.filter((row) => row.kind === 'stale_candidate').length,
    orphan: rows.filter((row) => row.kind === 'orphan_document').length,
  }
}

function validateEvidence(target: DocumentTarget, evidence: Record<string, unknown>): void {
  if (Object.keys(evidence).length === 0) throw new Error('Staged document output requires evidence.')
  const technicalKeys = ['codeNodeIds', 'entryPointIds', 'modelIds', 'relationIds', 'serviceMapEdgeIds', 'sourceHashes', 'linkedDocumentIds']
  const businessKeys = ['sourceDocumentIds', 'linkedDocumentIds', 'serviceMapEdgeIds', 'modelIds', 'sourceHashes']
  const keys = target.track === 'technical' ? technicalKeys : businessKeys
  const hasAcceptedEvidence = keys.some((key) => {
    const value = evidence[key]
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0
  })
  if (!hasAcceptedEvidence) {
    throw new Error(`Staged ${target.track} document output requires source evidence.`)
  }
}

function now(): string {
  return new Date().toISOString()
}
