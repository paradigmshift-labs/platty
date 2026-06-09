import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema/index.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { pipelineEvents, pipelineRuns, pipelineSteps } from '@/db/schema/pipeline_runs.js'
import { pipelineRunLinks } from '@/db/schema/project_analysis_v2.js'
import { PipelineExecution, cancelActivePipelineRun, createPipelineLlmTaskRegistry, isPipelineRunActive, registerActivePipelineRun } from '@/pipeline_infra/index.js'

type DB = ReturnType<typeof drizzle<typeof schema>>

function createTestDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

function seedProject(db: DB) {
  db.insert(projects).values({ id: 'p1', name: 'Test Project' }).run()
  db.insert(repositories).values({ id: 'r1', projectId: 'p1', name: 'repo1', repoPath: '/tmp/repo1' }).run()
}

describe('PipelineExecution', () => {
  let db: DB
  let pipeline: PipelineExecution

  beforeEach(() => {
    db = createTestDb()
    seedProject(db)
    pipeline = new PipelineExecution({ db })
  })

  it('persists a passed run, step, event, and repository phase status through runStage', async () => {
    const result = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_graph', sourceCommit: 'abc123', totalSteps: 1 },
      async (ctx) => {
        const value = await ctx.step({ step: 'F1:scan', label: 'Scan' }, (step) => {
          step.emit('progress', 'scanned')
          return 42
        })
        ctx.commitOutcome(ctx.markPassed({
          sourceCommit: 'abc123',
          outputRefs: { graph: { kind: 'artifact', id: 'graph:r1' } },
        }))
        return value
      },
    )

    expect(result.ok).toBe(true)
    expect(result.outcome.status).toBe('passed')
    expect(result.value).toBe(42)

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get()
    expect(run?.status).toBe('done')
    expect(run?.kind).toBe('build_graph')
    expect(run?.completedSteps).toBe(1)

    const step = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, result.runId)).get()
    expect(step?.status).toBe('done')
    expect(step?.phase).toBe('build_graph')
    expect(step?.step).toBe('F1:scan')

    const event = db.select().from(pipelineEvents).where(eq(pipelineEvents.runId, result.runId)).get()
    expect(event?.kind).toBe('progress')
    expect(event?.message).toBe('scanned')

    const phase = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'r1')).get()
    expect(phase?.phase).toBe('build_graph')
    expect(phase?.status).toBe('passed')
    expect(phase?.sourceRunId).toBe(result.runId)
    expect(phase?.sourceCommit).toBe('abc123')
  })

  it('starts a fire-and-forget stage with runId available before completion settles', async () => {
    let releaseStage: (() => void) | undefined
    const started = pipeline.startStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_graph', sourceCommit: 'abc123', totalSteps: 1 },
      async (ctx) => {
        await new Promise<void>((resolve) => {
          releaseStage = resolve
        })
        await ctx.step({ step: 'F1:scan', label: 'Scan' }, () => 42)
        ctx.commitOutcome(ctx.markPassed({ sourceCommit: 'abc123' }))
        return 42
      },
    )

    expect(started.runId).toEqual(expect.any(String))
    const running = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, started.runId)).get()
    expect(running?.status).toBe('running')
    expect(running?.completedSteps).toBe(0)

    releaseStage?.()
    const result = await started.completion

    expect(result.ok).toBe(true)
    expect(result.runId).toBe(started.runId)
    expect(result.value).toBe(42)

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, started.runId)).get()
    expect(run?.status).toBe('done')
    expect(run?.completedSteps).toBe(1)
  })

  it('turns a normal return without commitOutcome into an internal failure', async () => {
    const result = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_models' },
      async () => 'forgot',
    )

    expect(result.ok).toBe(false)
    expect(result.failure.kind).toBe('internal')
    expect(result.outcome.status).toBe('failed')

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get()
    expect(run?.status).toBe('failed')

    const phase = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'r1')).get()
    expect(phase?.phase).toBe('build_models')
    expect(phase?.status).toBe('failed')
  })

  it('supports waiting_for_user as a normal pause state with a user action event', async () => {
    const result = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'analyze_repo' },
      async (ctx) => {
        ctx.commitOutcome(ctx.markWaitingForUser({
          action: {
            kind: 'review_decisions',
            title: 'Review static analysis candidates',
            decisionRef: { kind: 'artifact', id: 'review-candidates:r1' },
          },
          resumeToken: 'resume:r1:1',
          partialOutputRefs: {
            candidates: { kind: 'artifact', id: 'review-candidates:r1' },
          },
        }))
      },
    )

    expect(result.ok).toBe(true)
    expect(result.outcome.status).toBe('waiting_for_user')

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get()
    expect(run?.status).toBe('waiting_for_user')

    const phase = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'r1')).get()
    expect(phase?.status).toBe('waiting_for_user')
    expect(phase?.builtAt).toBeTruthy()
    expect(phase?.meta).toMatchObject({ resumeToken: 'resume:r1:1' })

    const events = db.select().from(pipelineEvents).where(eq(pipelineEvents.runId, result.runId)).all()
    expect(events.some((event) => event.kind === 'requires_user_action')).toBe(true)
  })

  it('reports a committed failed outcome as a failed stage result even when the body returns normally', async () => {
    const result = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_docs' },
      async (ctx) => {
        const failure = {
          kind: 'llm_quality' as const,
          code: 'DOC_VALIDATION_FAILED',
          message: 'Generated docs did not pass validation.',
          retryable: true,
        }
        ctx.commitOutcome(ctx.markFailed({ failure, retryable: true }))
        return 'validation-result'
      },
    )

    expect(result.ok).toBe(false)
    expect(result.failure).toMatchObject({
      kind: 'llm_quality',
      code: 'DOC_VALIDATION_FAILED',
      retryable: true,
    })
    expect(result.outcome.status).toBe('failed')

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get()
    expect(run?.status).toBe('failed')
    expect(run?.errorMessage).toBe('Generated docs did not pass validation.')

    const phase = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'r1')).get()
    expect(phase?.status).toBe('failed')
  })

  it('does not upsert phase status when phase is null', async () => {
    const result = await pipeline.runStage(
      { projectId: 'p1', kind: 'analyze_project', phase: null },
      async (ctx) => {
        ctx.commitOutcome(ctx.markPassed({ summary: { childRuns: 0 } }))
      },
    )

    expect(result.ok).toBe(true)
    const phases = db.select().from(repositoryPhaseStatus).all()
    expect(phases).toHaveLength(0)
  })

  it('runs a child stage and persists the parent-child run link', async () => {
    const result = await pipeline.runStage(
      { projectId: 'p1', kind: 'analyze_project', phase: null },
      async (ctx) => {
        const child = await ctx.runChild(
          { projectId: 'p1', repoId: 'r1', kind: 'build_graph' },
          async (childCtx) => {
            childCtx.commitOutcome(childCtx.markPassed({ sourceCommit: 'child-commit' }))
            return 'child-value'
          },
        )
        ctx.commitOutcome(ctx.markPassed({ summary: { childOk: child.ok } }))
        return child
      },
    )

    expect(result.ok).toBe(true)
    expect(result.value.ok).toBe(true)
    const links = db.select().from(pipelineRunLinks).all()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      parentRunId: result.runId,
      childRunId: result.value.runId,
      relation: 'orchestrates',
      phase: 'build_graph',
      repoId: 'r1',
    })
  })

  it('propagates parent cancellation to child stages', async () => {
    const controller = new AbortController()
    const result = await pipeline.runStage(
      { projectId: 'p1', kind: 'analyze_project', phase: null, signal: controller.signal },
      async (ctx) => {
        controller.abort()
        const child = await ctx.runChild(
          { projectId: 'p1', repoId: 'r1', kind: 'build_graph' },
          async (childCtx) => {
            childCtx.commitOutcome(childCtx.markPassed({ sourceCommit: 'should-not-run' }))
            return 'child-value'
          },
        )
        ctx.commitOutcome(ctx.markPassed({ summary: { childOk: child.ok } }))
        return child
      },
    )

    expect(result.ok).toBe(true)
    expect(result.value.ok).toBe(false)
    expect(result.value.outcome.status).toBe('cancelled')
    const links = db.select().from(pipelineRunLinks).all()
    expect(links).toHaveLength(1)
  })

  it('links a stage to its parent when parentRunId is provided directly', async () => {
    const parent = await pipeline.runStage(
      { projectId: 'p1', kind: 'analyze_project', phase: null },
      async (ctx) => {
        ctx.commitOutcome(ctx.markPassed({}))
        return 'parent'
      },
    )
    expect(parent.ok).toBe(true)

    const child = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_models', parentRunId: parent.runId },
      async (ctx) => {
        ctx.commitOutcome(ctx.markPassed({}))
        return 'child'
      },
    )

    expect(child.ok).toBe(true)
    const links = db.select().from(pipelineRunLinks).all()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      parentRunId: parent.runId,
      childRunId: child.runId,
      relation: 'orchestrates',
      phase: 'build_models',
      repoId: 'r1',
    })
  })

  it('reuses an existing run when idempotencyKey and sourceCommit match', async () => {
    let invocations = 0
    const first = await pipeline.runStage(
      {
        projectId: 'p1',
        repoId: 'r1',
        kind: 'build_graph',
        sourceCommit: 'same-commit',
        idempotencyKey: 'build_graph:r1:same-commit',
      },
      async (ctx) => {
        invocations += 1
        ctx.commitOutcome(ctx.markPassed({ sourceCommit: 'same-commit' }))
        return 'created'
      },
    )

    const second = await pipeline.runStage(
      {
        projectId: 'p1',
        repoId: 'r1',
        kind: 'build_graph',
        sourceCommit: 'same-commit',
        idempotencyKey: 'build_graph:r1:same-commit',
      },
      async () => {
        throw new Error('idempotent run should not invoke stage body')
      },
    )

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.reused).toBe(true)
    expect(second.runId).toBe(first.runId)
    expect(second.outcome).toMatchObject({
      status: 'skipped',
      reason: 'idempotency_reused',
      upstreamRunId: first.runId,
    })
    expect(invocations).toBe(1)
    expect(db.select().from(pipelineRuns).all()).toHaveLength(1)
  })

  it('links a reused idempotent run to a new parent run when parentRunId is provided', async () => {
    const childInput = {
      projectId: 'p1',
      repoId: 'r1',
      kind: 'build_graph' as const,
      sourceCommit: 'same-commit',
      idempotencyKey: 'build_graph:r1:same-commit',
    }
    const existingChild = await pipeline.runStage(childInput, async (ctx) => {
      ctx.commitOutcome(ctx.markPassed({ sourceCommit: 'same-commit' }))
    })
    const parent = await pipeline.runStage(
      { projectId: 'p1', kind: 'analyze_project', phase: null },
      async (ctx) => {
        ctx.commitOutcome(ctx.markPassed({}))
      },
    )
    expect(parent.ok).toBe(true)

    const reusedChild = await pipeline.runStage(
      { ...childInput, parentRunId: parent.runId },
      async () => {
        throw new Error('idempotent run should not invoke stage body')
      },
    )

    expect(reusedChild.ok).toBe(true)
    expect(reusedChild.reused).toBe(true)
    expect(reusedChild.runId).toBe(existingChild.runId)
    const links = db.select().from(pipelineRunLinks).all()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      parentRunId: parent.runId,
      childRunId: existingChild.runId,
      relation: 'orchestrates',
      phase: 'build_graph',
      repoId: 'r1',
    })
  })

  it('creates a fresh run for the same idempotencyKey when force is true', async () => {
    const input = {
      projectId: 'p1',
      repoId: 'r1',
      kind: 'build_graph' as const,
      sourceCommit: 'same-commit',
      idempotencyKey: 'build_graph:r1:same-commit',
    }

    await pipeline.runStage(input, async (ctx) => {
      ctx.commitOutcome(ctx.markPassed({ sourceCommit: 'same-commit' }))
    })
    const forced = await pipeline.runStage({ ...input, force: true }, async (ctx) => {
      ctx.commitOutcome(ctx.markPassed({ sourceCommit: 'same-commit' }))
    })

    expect(forced.ok).toBe(true)
    expect(forced.reused).toBeUndefined()
    expect(db.select().from(pipelineRuns).all()).toHaveLength(2)
  })

  it('reuses a failed run without reporting it as success', async () => {
    const input = {
      projectId: 'p1',
      repoId: 'r1',
      kind: 'build_graph' as const,
      sourceCommit: 'same-commit',
      idempotencyKey: 'build_graph:r1:failed-commit',
    }
    const first = await pipeline.runStage(input, async () => {
      throw new Error('original failure')
    })

    const second = await pipeline.runStage(input, async () => {
      throw new Error('idempotent failed run should not invoke stage body')
    })

    expect(first.ok).toBe(false)
    expect(second.ok).toBe(false)
    expect(second.reused).toBe(true)
    expect(second.runId).toBe(first.runId)
    expect(second.failure.code).toBe('PIPELINE_REUSED_FAILED_RUN')
    expect(db.select().from(pipelineRuns).all()).toHaveLength(1)
  })

  it('does not report a reused running idempotent run as successful', async () => {
    let releaseStage: (() => void) | undefined
    const input = {
      projectId: 'p1',
      repoId: 'r1',
      kind: 'build_graph' as const,
      sourceCommit: 'same-commit',
      idempotencyKey: 'build_graph:r1:running-commit',
    }
    const first = pipeline.startStage(input, async (ctx) => {
      await new Promise<void>((resolve) => {
        releaseStage = resolve
      })
      ctx.commitOutcome(ctx.markPassed({ sourceCommit: 'same-commit' }))
      return 'created'
    })

    const second = await pipeline.runStage(input, async () => {
      throw new Error('running idempotent run should not invoke stage body')
    })

    expect(second.ok).toBe(false)
    expect(second.reused).toBe(true)
    expect(second.runId).toBe(first.runId)
    expect(second.failure).toMatchObject({
      code: 'PIPELINE_RUN_ALREADY_RUNNING',
      retryable: true,
    })
    expect(db.select().from(pipelineRuns).all()).toHaveLength(1)

    releaseStage?.()
    const completed = await first.completion
    expect(completed.ok).toBe(true)
  })

  it('reuses a waiting_for_user run as a waiting stage result instead of a completed skip', async () => {
    const input = {
      projectId: 'p1',
      repoId: 'r1',
      kind: 'analyze_repo' as const,
      sourceCommit: 'same-commit',
      idempotencyKey: 'analyze_repo:r1:same-commit',
    }
    const first = await pipeline.runStage(input, async (ctx) => {
      ctx.commitOutcome(ctx.markWaitingForUser({
        action: {
          kind: 'review_decisions',
          title: 'Review static analysis candidates',
          decisionRef: { kind: 'artifact', id: 'review-candidates:r1' },
        },
        resumeToken: 'resume:r1:1',
      }))
    })

    const second = await pipeline.runStage(input, async () => {
      throw new Error('waiting idempotent run should not invoke stage body')
    })

    expect(first.ok).toBe(true)
    expect(first.outcome.status).toBe('waiting_for_user')
    expect(second.ok).toBe(true)
    expect(second.reused).toBe(true)
    expect(second.runId).toBe(first.runId)
    expect(second.outcome).toMatchObject({
      status: 'waiting_for_user',
      action: {
        kind: 'review_decisions',
        title: 'Review static analysis candidates',
      },
      resumeToken: 'resume:r1:1',
      summary: { status: 'waiting_for_user' },
    })
    expect(db.select().from(pipelineRuns).all()).toHaveLength(1)
  })

  it('resumes a waiting_for_user run with a new linked run and resumed event', async () => {
    const waiting = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'analyze_repo', sourceCommit: 'same-commit' },
      async (ctx) => {
        ctx.commitOutcome(ctx.markWaitingForUser({
          action: {
            kind: 'review_decisions',
            title: 'Review static analysis candidates',
            decisionRef: { kind: 'artifact', id: 'review-candidates:r1' },
          },
          resumeToken: 'resume:r1:1',
        }))
      },
    )
    expect(waiting.ok).toBe(true)

    const resumed = await pipeline.resumeStage(
      {
        projectId: 'p1',
        repoId: 'r1',
        kind: 'analyze_repo',
        sourceCommit: 'same-commit',
        previousRunId: waiting.runId,
        resumeToken: 'resume:r1:1',
      },
      async (ctx) => {
        ctx.commitOutcome(ctx.markPassed({ sourceCommit: 'same-commit' }))
        return 'resumed'
      },
    )

    expect(resumed.ok).toBe(true)
    expect(resumed.runId).not.toBe(waiting.runId)
    const links = db.select().from(pipelineRunLinks).where(eq(pipelineRunLinks.parentRunId, waiting.runId)).all()
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      childRunId: resumed.runId,
      relation: 'resumes',
      phase: 'analyze_repo',
      repoId: 'r1',
    })
    const events = db.select().from(pipelineEvents).where(eq(pipelineEvents.runId, resumed.runId)).all()
    expect(events.some((event) => event.kind === 'resumed')).toBe(true)
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, resumed.runId)).get()
    expect(run?.meta).toMatchObject({
      previousRunId: waiting.runId,
      resumeToken: 'resume:r1:1',
    })
  })

  it('rejects resume when the resume token does not match', async () => {
    const waiting = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'analyze_repo' },
      async (ctx) => {
        ctx.commitOutcome(ctx.markWaitingForUser({
          action: {
            kind: 'review_decisions',
            title: 'Review static analysis candidates',
            decisionRef: { kind: 'artifact', id: 'review-candidates:r1' },
          },
          resumeToken: 'resume:r1:1',
        }))
      },
    )

    expect(() => pipeline.startResumeStage(
      {
        projectId: 'p1',
        repoId: 'r1',
        kind: 'analyze_repo',
        previousRunId: waiting.runId,
        resumeToken: 'wrong-token',
      },
      async (ctx) => {
        ctx.commitOutcome(ctx.markPassed({}))
      },
    )).toThrow('invalid resume token')
    expect(db.select().from(pipelineRuns).all()).toHaveLength(1)
  })

  it('honors a pre-aborted signal before running the stage body', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await pipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_models', signal: controller.signal },
      async () => {
        throw new Error('aborted run should not invoke stage body')
      },
    )

    expect(result.ok).toBe(false)
    expect(result.failure.kind).toBe('cancelled')
    expect(result.outcome.status).toBe('cancelled')

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get()
    expect(run?.status).toBe('cancelled')

    const phase = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'r1')).get()
    expect(phase?.status).toBe('cancelled')
  })

  it('aborts a running stage when the active run is cancelled', async () => {
    let observedSignal: AbortSignal | undefined
    const started = pipeline.startStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_docs' },
      async (ctx) => {
        observedSignal = ctx.signal
        await new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => {
            const error = new Error('This operation was aborted')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    )

    expect(isPipelineRunActive(started.runId)).toBe(true)
    expect(cancelActivePipelineRun(started.runId, 'Cancelled by test')).toBe(true)

    const result = await started.completion

    expect(observedSignal?.aborted).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.outcome.status).toBe('cancelled')
    expect(result.failure.kind).toBe('cancelled')
    expect(isPipelineRunActive(started.runId)).toBe(false)

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, started.runId)).get()
    expect(run?.status).toBe('cancelled')
    const phase = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'r1')).get()
    expect(phase?.status).toBe('cancelled')
  })

  it('rejects duplicate active run registration for the same run id', () => {
    const unregister = registerActivePipelineRun('run:duplicate', { abort: () => undefined })
    try {
      expect(() => registerActivePipelineRun('run:duplicate', { abort: () => undefined }))
        .toThrow('Pipeline run is already active')
    } finally {
      unregister()
    }
  })

  it('maps LLM budget failures to a budget_exceeded stage failure', async () => {
    const registry = createPipelineLlmTaskRegistry()
    let taskSignal: AbortSignal | undefined
    registry.register({
      id: 'fixture.expensive',
      mode: 'single',
      run: async (_input: unknown, ctx) => {
        taskSignal = ctx.signal
        ctx.recordTelemetry({ costUsd: 2 })
        return 'too-expensive'
      },
    })
    const budgetedPipeline = new PipelineExecution({
      db,
      llmTaskRegistry: registry,
      llmBudgetUsd: 1,
    })

    const result = await budgetedPipeline.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_docs' },
      async (ctx) => {
        await ctx.llm.gatewayTask('fixture.expensive', {})
        ctx.commitOutcome(ctx.markPassed({}))
      },
    )

    expect(result.ok).toBe(false)
    expect(result.failure.kind).toBe('budget_exceeded')
    expect(result.outcome.status).toBe('failed')
    expect(taskSignal?.aborted).toBe(true)

    const phase = db.select().from(repositoryPhaseStatus).where(eq(repositoryPhaseStatus.repositoryId, 'r1')).get()
    expect(phase?.status).toBe('failed')
    expect(phase?.meta).toMatchObject({
      failure: { kind: 'budget_exceeded', code: 'PIPELINE_LLM_BUDGET_EXCEEDED' },
    })
  })

  it('records ctx.llm.gatewayTask usage on the active pipeline step', async () => {
    const registry = createPipelineLlmTaskRegistry()
    registry.register({
      id: 'fixture.step-llm',
      mode: 'single',
      run: async (_input: unknown, ctx) => {
        ctx.recordTelemetry({
          provider: 'codex_sdk',
          model: 'fake-step-model',
          inputTokens: 7,
          outputTokens: 11,
          costUsd: 0.04,
        })
        return 'ok'
      },
    })
    const pipelineWithLlm = new PipelineExecution({ db, llmTaskRegistry: registry })

    const result = await pipelineWithLlm.runStage(
      { projectId: 'p1', repoId: 'r1', kind: 'build_docs', totalSteps: 1 },
      async (ctx) => {
        await ctx.step({ step: 'F1:llm', label: 'LLM' }, async () => {
          await ctx.llm.gatewayTask('fixture.step-llm', {}, { subjectId: 'doc1' })
        })
        ctx.commitOutcome(ctx.markPassed({}))
      },
    )

    expect(result.ok).toBe(true)
    const step = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, result.runId)).get()
    expect(step).toMatchObject({
      step: 'F1:llm',
      llmProvider: 'codex_sdk',
      model: 'fake-step-model',
      inputTokens: 7,
      outputTokens: 11,
      costUsd: 0.04,
    })
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, result.runId)).get()
    expect(run?.meta?.modelUsage).toMatchObject({
      byProvider: {
        codex_sdk: {
          calls: 1,
          inputTokens: 7,
          outputTokens: 11,
          estimatedUsd: 0.04,
        },
      },
      byModel: {
        'fake-step-model': {
          calls: 1,
          inputTokens: 7,
          outputTokens: 11,
          estimatedUsd: 0.04,
        },
      },
      totals: {
        calls: 1,
        inputTokens: 7,
        outputTokens: 11,
        estimatedUsd: 0.04,
      },
    })
  })
})
