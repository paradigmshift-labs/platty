import { and, asc, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { DB } from '@/db/client.js'
import { entryPoints } from '@/db/schema/build_route.js'
import { repositories } from '@/db/schema/core.js'
import type { EntryPointKind } from '@/db/schema/enums.js'
import {
  analysisReviewDecisions,
  type AnalysisReviewDecision,
  type AnalysisReviewDecisionRow,
  type AnalysisReviewReason,
  type AnalysisReviewTargetSource,
  type AnalysisReviewTargetType,
} from '@/db/schema/project_analysis_v2.js'
import type { DocumentTarget } from '@/pipeline_modules/build_docs/runtime/types.js'

export type AnalysisReviewDecisionErrorCode =
  | 'REPOSITORY_NOT_IN_PROJECT'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_TYPE_MISMATCH'
  | 'UNSUPPORTED_ENTRY_POINT_KIND'

export class AnalysisReviewDecisionError extends Error {
  constructor(
    readonly code: AnalysisReviewDecisionErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'AnalysisReviewDecisionError'
  }
}

export interface UpsertAnalysisReviewDecisionInput {
  projectId: string
  repoId: string
  targetType: AnalysisReviewTargetType
  targetId: string
  targetSource?: AnalysisReviewTargetSource
  decision: AnalysisReviewDecision
  reason: AnalysisReviewReason
  note?: string | null
  decidedBy?: string | null
  decidedAt?: string
  sourceRunId?: string | null
}

export interface ListAnalysisReviewDecisionsInput {
  projectId: string
  repoId?: string
  decision?: AnalysisReviewDecision
}

export interface DocumentTargetDecision {
  targetId: string
  decision: AnalysisReviewDecision
  decidedAt?: string | null
}

export interface ApplyReviewDecisionsResult {
  included: DocumentTarget[]
  excluded: Array<{
    target: DocumentTarget
    excludedEntryPointIds: string[]
  }>
}

export function mapEntryPointKindToReviewTarget(kind: EntryPointKind | string): AnalysisReviewTargetType {
  switch (kind) {
    case 'api':
      return 'route'
    case 'page':
      return 'screen'
    case 'job':
      return 'job'
    case 'event':
      return 'event'
    default:
      throw new AnalysisReviewDecisionError('UNSUPPORTED_ENTRY_POINT_KIND', `Unsupported entry point kind: ${kind}`)
  }
}

export function upsertAnalysisReviewDecision(
  db: DB,
  input: UpsertAnalysisReviewDecisionInput,
): AnalysisReviewDecisionRow {
  validateDecisionTarget(db, input)

  const targetSource = input.targetSource ?? 'entry_point'
  const decidedAt = input.decidedAt ?? new Date().toISOString()
  const existing = db
    .select()
    .from(analysisReviewDecisions)
    .where(and(
      eq(analysisReviewDecisions.projectId, input.projectId),
      eq(analysisReviewDecisions.repoId, input.repoId),
      eq(analysisReviewDecisions.targetType, input.targetType),
      eq(analysisReviewDecisions.targetId, input.targetId),
    ))
    .get()

  if (existing) {
    db.update(analysisReviewDecisions)
      .set({
        targetSource,
        decision: input.decision,
        reason: input.reason,
        note: input.note ?? null,
        decidedBy: input.decidedBy ?? null,
        decidedAt,
        sourceRunId: input.sourceRunId ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(analysisReviewDecisions.id, existing.id))
      .run()
    return mustGetDecision(db, existing.id)
  }

  const id = nanoid()
  db.insert(analysisReviewDecisions)
    .values({
      id,
      projectId: input.projectId,
      repoId: input.repoId,
      targetType: input.targetType,
      targetId: input.targetId,
      targetSource,
      decision: input.decision,
      reason: input.reason,
      note: input.note ?? null,
      decidedBy: input.decidedBy ?? null,
      decidedAt,
      sourceRunId: input.sourceRunId ?? null,
    })
    .run()

  return mustGetDecision(db, id)
}

export function listAnalysisReviewDecisions(
  db: DB,
  input: ListAnalysisReviewDecisionsInput,
): AnalysisReviewDecisionRow[] {
  const predicates = [eq(analysisReviewDecisions.projectId, input.projectId)]
  if (input.repoId) {
    predicates.push(eq(analysisReviewDecisions.repoId, input.repoId))
  }
  if (input.decision) {
    predicates.push(eq(analysisReviewDecisions.decision, input.decision))
  }

  return db
    .select()
    .from(analysisReviewDecisions)
    .where(and(...predicates))
    .orderBy(asc(analysisReviewDecisions.repoId), asc(analysisReviewDecisions.targetType), asc(analysisReviewDecisions.targetId))
    .all()
}

export function listDeprecatedEntryPointIds(
  db: DB,
  input: { projectId: string; repoId?: string },
): Set<string> {
  return new Set(
    listAnalysisReviewDecisions(db, {
      projectId: input.projectId,
      repoId: input.repoId,
      decision: 'deprecated',
    }).map((decision) => decision.targetId),
  )
}

export function isDeprecatedDocumentScope(
  document: { scopeId: string | null },
  deprecatedEntryPointIds: ReadonlySet<string>,
): boolean {
  return typeof document.scopeId === 'string' && deprecatedEntryPointIds.has(document.scopeId)
}

export function applyReviewDecisionsToDocumentTargets(
  targets: DocumentTarget[],
  decisions: DocumentTargetDecision[],
): ApplyReviewDecisionsResult {
  const latestDecisionByTargetId = new Map<string, DocumentTargetDecision>()
  for (const decision of decisions) {
    const previous = latestDecisionByTargetId.get(decision.targetId)
    if (!previous || compareDecisionTime(decision, previous) >= 0) {
      latestDecisionByTargetId.set(decision.targetId, decision)
    }
  }

  const included: DocumentTarget[] = []
  const excluded: ApplyReviewDecisionsResult['excluded'] = []

  for (const target of targets) {
    const excludedEntryPointIds = target.entryPointIds.filter((entryPointId) => {
      return latestDecisionByTargetId.get(entryPointId)?.decision === 'deprecated'
    })

    if (excludedEntryPointIds.length > 0) {
      excluded.push({ target, excludedEntryPointIds })
    } else {
      included.push(target)
    }
  }

  return { included, excluded }
}

function validateDecisionTarget(db: DB, input: UpsertAnalysisReviewDecisionInput): void {
  const repo = db
    .select({ id: repositories.id })
    .from(repositories)
    .where(and(
      eq(repositories.id, input.repoId),
      eq(repositories.projectId, input.projectId),
      isNull(repositories.deletedAt),
    ))
    .get()

  if (!repo) {
    throw new AnalysisReviewDecisionError(
      'REPOSITORY_NOT_IN_PROJECT',
      `Repository ${input.repoId} does not belong to project ${input.projectId}`,
    )
  }

  const target = db
    .select({ id: entryPoints.id, kind: entryPoints.kind })
    .from(entryPoints)
    .where(and(eq(entryPoints.id, input.targetId), eq(entryPoints.repoId, input.repoId)))
    .get()

  if (!target) {
    throw new AnalysisReviewDecisionError(
      'TARGET_NOT_FOUND',
      `Entry point ${input.targetId} was not found in repository ${input.repoId}`,
    )
  }

  const expectedTargetType = mapEntryPointKindToReviewTarget(target.kind)
  if (input.targetType !== expectedTargetType) {
    throw new AnalysisReviewDecisionError(
      'TARGET_TYPE_MISMATCH',
      `Entry point ${input.targetId} is ${expectedTargetType}, not ${input.targetType}`,
    )
  }
}

function mustGetDecision(db: DB, id: string): AnalysisReviewDecisionRow {
  const row = db.select().from(analysisReviewDecisions).where(eq(analysisReviewDecisions.id, id)).get()
  if (!row) {
    throw new Error(`Analysis review decision ${id} was not persisted`)
  }
  return row
}

function compareDecisionTime(left: DocumentTargetDecision, right: DocumentTargetDecision): number {
  return decisionTimestamp(left) - decisionTimestamp(right)
}

function decisionTimestamp(decision: DocumentTargetDecision): number {
  const timestamp = Date.parse(decision.decidedAt ?? '')
  return Number.isNaN(timestamp) ? 0 : timestamp
}
