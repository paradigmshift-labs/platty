import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { buildEpicsDrafts } from '@/db/schema/build_epics.js'
import type { GenerationTask } from '@/db/schema/build_docs.js'
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

export async function statusBuildEpicsRun(
  db: DB,
  input: { projectId: string; runId: string },
): Promise<UnifiedRunStatusResult> {
  return statusForSharedGenerationRun(db, { kind: 'build_epics', ...input })
}

export async function resumeBuildEpicsRun(
  db: DB,
  input: { projectId: string; runId: string },
): Promise<UnifiedRunResumeResult> {
  return resumeSharedGenerationRun(db, { kind: 'build_epics', ...input })
}

export async function retryBuildEpicsRunTasks(
  db: DB,
  input: UnifiedRunRetryInput,
): Promise<UnifiedRunRetryResult> {
  return retrySharedGenerationTasks(db, { ...input, kind: 'build_epics' }, {
    beforeReset: (tx, { tasks, retryableMatchedTasks }) => {
      assertBuildEpicsRetrySafe(tx, input.runId, tasks, retryableMatchedTasks)
    },
  })
}

export async function releaseBuildEpicsRunLeases(
  db: DB,
  input: { projectId: string; runId: string; reason?: string },
): Promise<UnifiedRunReleaseLeasesResult> {
  return releaseSharedGenerationLeases(db, { ...input, kind: 'build_epics' })
}

function assertBuildEpicsRetrySafe(
  db: Pick<DB, 'select'>,
  runId: string,
  tasks: GenerationTask[],
  selectedTasks: GenerationTask[],
): void {
  if (selectedTasks.length === 0) return

  const editableDraft = db.select().from(buildEpicsDrafts)
    .where(eq(buildEpicsDrafts.runId, runId))
    .get()
  if (draftVersion(editableDraft?.draftJson) > 1) {
    throw codeError('RUNS_RETRY_DRAFT_EDITED', 'Editable EPIC draft was edited after the run started.')
  }

  if (selectedTasks.some((task) => task.documentType === 'taxonomy_candidate' || task.documentType === 'taxonomy_consolidation')) {
    throw codeError('RUNS_RETRY_CASCADE_REQUIRED', 'Taxonomy retries require cascading retries across dependent EPIC tasks.')
  }

  if (
    selectedTasks.some((task) => task.documentType === 'document_assignment') &&
    tasks.some((task) =>
      (task.documentType === 'taxonomy_candidate' || task.documentType === 'taxonomy_consolidation') &&
      task.status !== 'completed'
    )
  ) {
    throw codeError('RUNS_RETRY_PREREQUISITE_NOT_READY', 'Taxonomy tasks must be completed before retrying assignment tasks.')
  }

  if (
    selectedTasks.some((task) => task.documentType === 'cross_domain_link') &&
    tasks.some((task) =>
      (
        task.documentType === 'taxonomy_candidate' ||
        task.documentType === 'taxonomy_consolidation' ||
        task.documentType === 'document_assignment'
      ) &&
      task.status !== 'completed'
    )
  ) {
    throw codeError('RUNS_RETRY_PREREQUISITE_NOT_READY', 'Taxonomy and assignment tasks must be completed before retrying cross-domain link tasks.')
  }
}

function draftVersion(draftJson: Record<string, unknown> | null | undefined): number {
  return typeof draftJson?.version === 'number' ? draftJson.version : 1
}

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
