import { and, eq, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositoryPhaseStatus, type PhaseRunStatus, type UpstreamVersions } from '@/db/schema/core.js'
import type { RunKind } from '@/db/schema/enums.js'
import { upsertProjectPhaseStatus as upsertProjectPhaseStatusBase } from '@/pipeline_modules/shared/phase_status.js'

export interface PipelinePhaseStatusSource {
  status: PhaseRunStatus
  sourceRunId?: string | null
  sourceCommit?: string | null
  upstreamVersions?: UpstreamVersions | null
  meta?: Record<string, unknown> | null
}

export function upsertProjectPhaseStatus(
  db: DB,
  projectId: string,
  phase: RunKind,
  source: PipelinePhaseStatusSource,
): void {
  upsertProjectPhaseStatusBase(db, projectId, phase, source)
}

export function upsertRepositoryPhaseStatus(
  db: DB,
  repositoryId: string,
  phase: RunKind,
  source: PipelinePhaseStatusSource,
): void {
  const completedAt = source.status === 'passed' || source.status === 'waiting_for_user' ? sql`(datetime('now'))` : null
  const validity = source.status === 'passed' || source.status === 'waiting_for_user' ? 'fresh' : 'stale'
  // meta is a shared multi-key JSON blob (e.g. staticAnalysisApprovedConfig, promotedModelAdapters,
  // promotedRelationRules, promotedRouteRules) — MERGE source.meta into the existing blob instead of
  // overwriting it, so a phase write doesn't wipe another writer's keys (e.g. a loop-promoted rule a module
  // persisted under its own phase). A null source.meta preserves the existing blob.
  const existing = db.select({ meta: repositoryPhaseStatus.meta }).from(repositoryPhaseStatus)
    .where(and(eq(repositoryPhaseStatus.repositoryId, repositoryId), eq(repositoryPhaseStatus.phase, phase))).get()?.meta
  const existingObj = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : null
  const mergedMeta = source.meta ? { ...(existingObj ?? {}), ...source.meta } : (existing ?? null)
  db.insert(repositoryPhaseStatus)
    .values({
      repositoryId,
      phase,
      builtAt: completedAt as unknown as string | null,
      status: source.status,
      validity,
      sourceRunId: source.sourceRunId ?? null,
      sourceCommit: source.sourceCommit ?? null,
      builtFromCommit: source.sourceCommit ?? null,
      upstreamVersions: source.upstreamVersions ?? null,
      meta: mergedMeta as Record<string, unknown> | null,
      updatedAt: sql`(datetime('now'))`,
    })
    .onConflictDoUpdate({
      target: [repositoryPhaseStatus.repositoryId, repositoryPhaseStatus.phase],
      set: {
        builtAt: completedAt,
        status: source.status,
        validity,
        sourceRunId: source.sourceRunId ?? null,
        sourceCommit: source.sourceCommit ?? null,
        builtFromCommit: source.sourceCommit ?? null,
        upstreamVersions: source.upstreamVersions ?? null,
        meta: mergedMeta as Record<string, unknown> | null,
        updatedAt: sql`(datetime('now'))`,
      },
    })
    .run()
}
