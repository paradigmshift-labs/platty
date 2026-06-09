import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DB } from '@/db/client.js'
import {
  generationEvents,
  generationRuns,
  generationTasks,
  type GenerationStage,
  type GenerationTask,
  type GenerationTaskKind,
  type GenerationTaskStatus,
} from '@/db/schema/build_docs.js'

const LEASEABLE_STATUSES: GenerationTaskStatus[] = ['pending', 'expired', 'repair_requested']
const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000

export interface SharedGenerationLeaseEngineInput {
  db: DB
  stage: GenerationStage
  leaseTtlMs?: number
}

export interface AcquireSharedGenerationLeasesInput {
  runId: string
  workerId: string
  limit: number
  taskKinds?: GenerationTaskKind[]
  isReady?: (task: GenerationTask) => boolean
}

export interface AcquiredSharedGenerationLease {
  taskId: string
  leaseToken: string
  leaseExpiresAt: string
  task: GenerationTask
}

export interface AcquireSharedGenerationLeasesResult {
  runId: string
  leasedTasks: AcquiredSharedGenerationLease[]
  remainingLeaseableTaskCount: number
}

export interface ReleaseSharedGenerationLeasesResult {
  runId: string
  runStatus: string
  releasedLeaseCount: number
}

export function createSharedGenerationLeaseEngine(input: SharedGenerationLeaseEngineInput) {
  const leaseTtlMs = input.leaseTtlMs === undefined ? DEFAULT_LEASE_TTL_MS : input.leaseTtlMs

  function acquireLeases(args: AcquireSharedGenerationLeasesInput): AcquireSharedGenerationLeasesResult {
    return input.db.transaction((tx): AcquireSharedGenerationLeasesResult => {
      recoverExpiredLeasesForDb(tx, args.runId)
      const run = tx.select().from(generationRuns).where(eq(generationRuns.id, args.runId)).get()
      if (!run) throw codeError('RUN_NOT_FOUND', `Generation run not found: ${args.runId}`)
      if (run.stage !== input.stage) throw codeError('RUN_STAGE_MISMATCH', `Generation run stage mismatch: ${run.stage}`)
      if (run.status !== 'running' || run.maxConcurrentTasks <= 0) {
        return {
          runId: args.runId,
          leasedTasks: [],
          remainingLeaseableTaskCount: countLeaseableForDb(tx, args.runId, args.taskKinds),
        }
      }

      const activeLeaseCount = tx.select().from(generationTasks)
        .where(and(eq(generationTasks.runId, args.runId), eq(generationTasks.status, 'leased')))
        .all().length
      const allowedCount = Math.max(0, Math.min(Math.floor(args.limit), run.maxConcurrentTasks - activeLeaseCount))
      const candidates = tx.select().from(generationTasks)
        .where(and(
          eq(generationTasks.runId, args.runId),
          inArray(generationTasks.status, LEASEABLE_STATUSES),
        ))
        .all()
        .filter((task) => !args.taskKinds || args.taskKinds.includes(task.documentType))
        .filter((task) => !args.isReady || args.isReady(task))
        .sort((a, b) => a.targetKey.localeCompare(b.targetKey))

      const leasedTasks: AcquiredSharedGenerationLease[] = []
      for (const task of candidates) {
        if (leasedTasks.length >= allowedCount) break
        const now = timestamp()
        const leaseToken = `lease:${randomUUID()}`
        const leaseExpiresAt = new Date(Date.now() + leaseTtlMs).toISOString()
        const updated = tx.update(generationTasks)
          .set({
            status: 'leased',
            leaseToken,
            leasedBy: args.workerId,
            leaseExpiresAt,
            updatedAt: now,
          })
          .where(and(
            eq(generationTasks.id, task.id),
            eq(generationTasks.runId, args.runId),
            inArray(generationTasks.status, LEASEABLE_STATUSES),
          ))
          .run()
        if (updated.changes !== 1) continue
        tx.insert(generationEvents).values({
          id: `event:${randomUUID()}`,
          runId: args.runId,
          taskId: task.id,
          eventType: 'task_leased',
          payloadJson: {
            worker_group_id: args.workerId,
            lease_expires_at: leaseExpiresAt,
            document_type: task.documentType,
            target_key: task.targetKey,
          },
          createdAt: now,
        }).run()
        leasedTasks.push({ taskId: task.id, leaseToken, leaseExpiresAt, task })
      }

      return {
        runId: args.runId,
        leasedTasks,
        remainingLeaseableTaskCount: countLeaseableForDb(tx, args.runId, args.taskKinds),
      }
    })
  }

  function recoverExpiredLeases(runId: string): number {
    return input.db.transaction((tx): number => recoverExpiredLeasesForDb(tx, runId))
  }

  function releaseActiveLeases(runId: string, reason = 'manual_release'): ReleaseSharedGenerationLeasesResult {
    return input.db.transaction((tx): ReleaseSharedGenerationLeasesResult => {
      const run = tx.select().from(generationRuns).where(eq(generationRuns.id, runId)).get()
      if (!run) throw codeError('RUN_NOT_FOUND', `Generation run not found: ${runId}`)
      if (run.stage !== input.stage) throw codeError('RUN_STAGE_MISMATCH', `Generation run stage mismatch: ${run.stage}`)

      const now = timestamp()
      let releasedLeaseCount = 0
      for (const task of tx.select().from(generationTasks)
        .where(and(eq(generationTasks.runId, runId), eq(generationTasks.status, 'leased')))
        .all()) {
        const updated = tx.update(generationTasks)
          .set({
            status: 'expired',
            leaseToken: null,
            leasedBy: null,
            leaseExpiresAt: null,
            updatedAt: now,
          })
          .where(and(eq(generationTasks.id, task.id), eq(generationTasks.status, 'leased')))
          .run()
        if (updated.changes !== 1) continue
        releasedLeaseCount += 1
        tx.insert(generationEvents).values({
          id: `event:${randomUUID()}`,
          runId,
          taskId: task.id,
          eventType: 'task_expired',
          payloadJson: {
            reason,
            previous_status: 'leased',
            next_status: 'expired',
          },
          createdAt: now,
        }).run()
      }

      tx.insert(generationEvents).values({
        id: `event:${randomUUID()}`,
        runId,
        eventType: 'leases_released',
        payloadJson: { reason, released_lease_count: releasedLeaseCount },
        createdAt: now,
      }).run()
      return { runId, runStatus: run.status, releasedLeaseCount }
    })
  }

  return { acquireLeases, recoverExpiredLeases, releaseActiveLeases }
}

type LeaseDb = Pick<DB, 'select' | 'update' | 'insert'>

function recoverExpiredLeasesForDb(db: LeaseDb, runId: string): number {
  const now = timestamp()
  const nowMs = Date.parse(now)
  let recovered = 0
  for (const task of db.select().from(generationTasks).where(eq(generationTasks.runId, runId)).all()) {
    if (task.status !== 'leased' || !task.leaseExpiresAt) continue
    if (Date.parse(task.leaseExpiresAt) > nowMs) continue
    const updated = db.update(generationTasks)
      .set({ status: 'expired', leaseToken: null, leasedBy: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(generationTasks.id, task.id), eq(generationTasks.status, 'leased')))
      .run()
    if (updated.changes !== 1) continue
    recovered += 1
    db.insert(generationEvents).values({
      id: `event:${randomUUID()}`,
      runId,
      taskId: task.id,
      eventType: 'task_expired',
      payloadJson: { reason: 'lease_ttl_expired_recovered', lease_expires_at: task.leaseExpiresAt },
      createdAt: now,
    }).run()
  }
  return recovered
}

function countLeaseableForDb(db: Pick<DB, 'select'>, runId: string, taskKinds?: GenerationTaskKind[]): number {
  return db.select().from(generationTasks)
    .where(and(eq(generationTasks.runId, runId), inArray(generationTasks.status, LEASEABLE_STATUSES)))
    .all()
    .filter((task) => !taskKinds || taskKinds.includes(task.documentType))
    .length
}

function timestamp(): string {
  return new Date().toISOString()
}

function codeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
