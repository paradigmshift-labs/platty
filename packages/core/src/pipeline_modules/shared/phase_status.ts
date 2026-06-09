import { sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  projectPhaseStatus,
  repositoryPhaseStatus,
  type PhaseRunStatus,
  type UpstreamVersions,
} from '@/db/schema/core.js'
import type { RunKind } from '@/db/schema/enums.js'

export interface PhaseStatusSource {
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
  source: PhaseStatusSource,
): void {
  const updatedAt = Date.now()
  db.insert(projectPhaseStatus)
    .values({
      projectId,
      phase,
      status: source.status,
      sourceRunId: source.sourceRunId ?? null,
      sourceCommit: source.sourceCommit ?? null,
      upstreamVersions: source.upstreamVersions ?? null,
      updatedAt,
      meta: source.meta ?? null,
    })
    .onConflictDoUpdate({
      target: [projectPhaseStatus.projectId, projectPhaseStatus.phase],
      set: {
        status: source.status,
        sourceRunId: source.sourceRunId ?? null,
        sourceCommit: source.sourceCommit ?? null,
        upstreamVersions: source.upstreamVersions ?? null,
        updatedAt,
        meta: source.meta ?? null,
      },
    })
    .run()
}

export function repositoryPhaseSourceColumns(source: {
  runId?: string | null
  commit?: string | null
  status?: PhaseRunStatus
  upstreamVersions?: UpstreamVersions | null
  meta?: Record<string, unknown> | null
}): {
  status: PhaseRunStatus
  sourceRunId: string | null
  sourceCommit: string | null
  upstreamVersions: UpstreamVersions | null
  meta: Record<string, unknown> | null
} {
  return {
    status: source.status ?? 'passed',
    sourceRunId: source.runId ?? null,
    sourceCommit: source.commit ?? null,
    upstreamVersions: source.upstreamVersions ?? null,
    meta: source.meta ?? null,
  }
}

export function repositoryPhaseUpdatedAtSql() {
  return sql`(datetime('now'))`
}
