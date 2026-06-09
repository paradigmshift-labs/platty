import type { DB } from '@/db/client.js'
import {
  releaseSharedGenerationLeases,
  resumeSharedGenerationRun,
  retrySharedGenerationTasks,
  statusForSharedGenerationRun,
} from './shared_generation_adapter.js'
import type {
  UnifiedRunReleaseLeasesResult,
  UnifiedRunResumeResult,
  UnifiedRunRetryInput,
  UnifiedRunRetryResult,
  UnifiedRunStatusResult,
} from './types.js'

export async function statusBuildDocsRun(
  db: DB,
  input: { projectId: string; runId: string },
): Promise<UnifiedRunStatusResult> {
  return statusForSharedGenerationRun(db, { kind: 'build_docs', ...input })
}

export async function resumeBuildDocsRun(
  db: DB,
  input: { projectId: string; runId: string },
): Promise<UnifiedRunResumeResult> {
  return resumeSharedGenerationRun(db, { kind: 'build_docs', ...input })
}

export async function retryBuildDocsRunTasks(
  db: DB,
  input: UnifiedRunRetryInput,
): Promise<UnifiedRunRetryResult> {
  return retrySharedGenerationTasks(db, { ...input, kind: 'build_docs' })
}

export async function releaseBuildDocsRunLeases(
  db: DB,
  input: { projectId: string; runId: string; reason?: string },
): Promise<UnifiedRunReleaseLeasesResult> {
  return releaseSharedGenerationLeases(db, { ...input, kind: 'build_docs' })
}
