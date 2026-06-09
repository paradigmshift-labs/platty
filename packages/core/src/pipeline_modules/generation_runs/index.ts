import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { businessDocGenerationRuns } from '@/db/schema/build_business_docs_generation.js'
import { generationRuns } from '@/db/schema/build_docs.js'
import {
  releaseBuildDocsRunLeases,
  resumeBuildDocsRun,
  retryBuildDocsRunTasks,
  statusBuildDocsRun,
} from './build_docs_adapter.js'
import {
  releaseBuildEpicsRunLeases,
  resumeBuildEpicsRun,
  retryBuildEpicsRunTasks,
  statusBuildEpicsRun,
} from './build_epics_adapter.js'
import {
  releaseBusinessDocsRunLeases,
  resumeBusinessDocsUnifiedRun,
  retryBusinessDocsRunTasks,
  statusBusinessDocsUnifiedRun,
} from './business_docs_adapter.js'
import type { UnifiedRunAdapter, UnifiedRunRetryInput } from './types.js'

export function resolveUnifiedRunAdapter(
  db: DB,
  input: { projectId: string; runId: string },
): UnifiedRunAdapter {
  const run = db.select().from(generationRuns).where(and(
    eq(generationRuns.id, input.runId),
    eq(generationRuns.projectId, input.projectId),
  )).get()

  if (run?.stage === 'build_docs') {
    return {
      kind: 'build_docs',
      status: (args) => statusBuildDocsRun(db, args),
      resume: (args) => resumeBuildDocsRun(db, args),
      retry: (args: UnifiedRunRetryInput) => retryBuildDocsRunTasks(db, args),
      releaseLeases: (args) => releaseBuildDocsRunLeases(db, args),
    }
  }
  if (run?.stage === 'build_epics') {
    return {
      kind: 'build_epics',
      status: (args) => statusBuildEpicsRun(db, args),
      resume: (args) => resumeBuildEpicsRun(db, args),
      retry: (args: UnifiedRunRetryInput) => retryBuildEpicsRunTasks(db, args),
      releaseLeases: (args) => releaseBuildEpicsRunLeases(db, args),
    }
  }

  const businessDocsRun = db.select().from(businessDocGenerationRuns).where(and(
    eq(businessDocGenerationRuns.id, input.runId),
    eq(businessDocGenerationRuns.projectId, input.projectId),
  )).get()

  if (businessDocsRun) {
    return {
      kind: 'build_business_docs',
      status: (args) => statusBusinessDocsUnifiedRun(db, args),
      resume: (args) => resumeBusinessDocsUnifiedRun(db, args),
      retry: (args: UnifiedRunRetryInput) => retryBusinessDocsRunTasks(db, args),
      releaseLeases: (args) => releaseBusinessDocsRunLeases(db, args),
    }
  }

  throw codeError('RUN_NOT_FOUND', 'Run not found')
}

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

export * from './build_docs_adapter.js'
export * from './build_epics_adapter.js'
export * from './business_docs_adapter.js'
export * from './lease_engine.js'
export * from './resumable_run_resolver.js'
export * from './shared_generation_adapter.js'
export * from './types.js'
