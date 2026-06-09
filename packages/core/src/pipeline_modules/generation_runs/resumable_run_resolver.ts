import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  generationRuns,
  generationTasks,
  type GenerationRun,
  type GenerationStage,
  type GenerationTask,
} from '@/db/schema/build_docs.js'

const resumableRunStatuses = new Set(['awaiting_approval', 'running', 'failed'])

export function findLatestResumableGenerationRun(
  db: DB,
  input: {
    projectId: string
    stage: GenerationStage
    now?: string
    includeRun?: (run: GenerationRun) => boolean
  },
): GenerationRun | null {
  const nowMs = Date.parse(input.now ?? new Date().toISOString())
  const runs = db.select().from(generationRuns)
    .where(eq(generationRuns.projectId, input.projectId))
    .all()
    .filter((run) => (
      run.stage === input.stage &&
      resumableRunStatuses.has(run.status) &&
      (input.includeRun?.(run) ?? true)
    ))
    .sort((a, b) => compareNewestFirst(a, b))

  for (const run of runs) {
    const tasks = db.select().from(generationTasks).where(eq(generationTasks.runId, run.id)).all()
    if (tasks.some((task) => isResumableTask(task, nowMs))) return run
  }
  return null
}

export function reopenFailedGenerationRun(db: DB, run: GenerationRun): GenerationRun {
  if (run.status !== 'failed') return run
  const now = new Date().toISOString()
  db.update(generationRuns)
    .set({ status: 'running', finishedAt: null, updatedAt: now })
    .where(eq(generationRuns.id, run.id))
    .run()
  return { ...run, status: 'running', finishedAt: null, updatedAt: now }
}

function isResumableTask(task: GenerationTask, nowMs: number): boolean {
  if (task.status === 'pending' || task.status === 'expired' || task.status === 'repair_requested') return true
  if (task.status !== 'leased' || !task.leaseExpiresAt) return false
  return Date.parse(task.leaseExpiresAt) <= nowMs
}

function compareNewestFirst(a: GenerationRun, b: GenerationRun): number {
  const created = b.createdAt.localeCompare(a.createdAt)
  if (created !== 0) return created
  const updated = b.updatedAt.localeCompare(a.updatedAt)
  if (updated !== 0) return updated
  return b.id.localeCompare(a.id)
}
