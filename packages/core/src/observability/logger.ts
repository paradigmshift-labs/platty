import { nanoid } from 'nanoid'
import { eq, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { pipelineRuns, pipelineSteps, pipelineEvents } from '@/db/schema/pipeline_runs.js'
import type { RunKind, EventKind, TriggeredBy } from '@/db/schema/enums.js'
import { progressBus } from './progress.js'
import { getLlmAdapter, type LlmSpec } from '@/llm/registry.js'
import type { LlmAdapter, LlmRequest, LlmResponse } from '@/llm/types.js'

/**
 * PipelineRun — 파이프라인 실행 단위 wrapper.
 *
 * 두 목적 (specs/refactor/v2_migration_plan.md §10):
 *   A. 디버깅 — pipeline_steps에 토큰/비용/error/raw 로그 경로 기록
 *   B. 유저 진행 체크 — pipeline_events INSERT + SSE 발행
 *
 * 사용 패턴 (specs/v2/m1-core-observability.md §4.3):
 *   const run = PipelineRun.start({ projectId, kind: 'build_docs', totalSteps: 5 })
 *   await run.step({ phase: 'build_docs', step: 'F2:extract' }, async (ctx) => {
 *     const llm = ctx.llm({ provider: 'claude_code', model: 'claude-sonnet-4-6' })
 *     const res = await llm.call({ prompt })  // 토큰/비용 자동 누적 UPDATE
 *     ctx.emit('progress', `extracted ${res.content.length} chars`)
 *     return res
 *   })
 *   run.finish('done')
 */

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'waiting_for_user'
export type PipelineEventVisibility = 'user' | 'admin'

export interface PipelineEventEmitOptions {
  visibility?: PipelineEventVisibility
  messageKey?: string
  messageParams?: Record<string, string | number | boolean | null>
}

/**
 * step ctx.llm 의 어댑터 선택 단계만 가로채는 override.
 *
 * usage recording wrapper (P12 토큰/비용 자동 기록) 는 항상 적용된다 — override 는 어댑터 선택만 바꾼다.
 * 미지정 시 글로벌 registry(`getLlmAdapter`) 사용. e2e fixture / 단위 테스트에서 mock 주입용.
 */
export type LlmOverride = (spec: LlmSpec) => LlmAdapter

export interface RunStartOptions {
  projectId: string
  repoId?: string
  kind: RunKind
  totalSteps?: number
  triggeredBy?: TriggeredBy
  meta?: Record<string, unknown>
  llmOverride?: LlmOverride
}

export interface StepOptions {
  phase: string
  step: string
  label?: string
}

export interface StepCtx {
  /** 활성 step row id */
  stepId: number
  /** wrapper adapter — call 결과의 토큰/비용/모델을 step에 자동 누적 UPDATE */
  llm(spec: LlmSpec): LlmAdapter
  /** step-level event 발행 (DB INSERT + SSE) */
  emit(kind: EventKind, message: string, data?: Record<string, unknown>, opts?: PipelineEventEmitOptions): void
  /** step-level admin/debug event 저장. SSE에는 발행하지 않는다. */
  emitAdmin(kind: EventKind, message: string, data?: Record<string, unknown>, opts?: Omit<PipelineEventEmitOptions, 'visibility'>): void
}

export class PipelineRun {
  constructor(
    public readonly id: string,
    public readonly projectId: string,
    public readonly kind: RunKind,
    private readonly db: DB,
    private readonly llmOverride?: LlmOverride,
  ) {}

  static start(opts: RunStartOptions, db: DB): PipelineRun {
    const id = nanoid()
    db.insert(pipelineRuns)
      .values({
        id,
        projectId: opts.projectId,
        repoId: opts.repoId,
        kind: opts.kind,
        status: 'running',
        triggeredBy: opts.triggeredBy,
        totalSteps: opts.totalSteps,
        meta: opts.meta,
        startedAt: new Date().toISOString(),  // ms 정밀도 명시 (default datetime('now')는 second 단위)
      })
      .run()
    return new PipelineRun(id, opts.projectId, opts.kind, db, opts.llmOverride)
  }

  step<T>(opts: StepOptions, fn: (ctx: StepCtx) => T | Promise<T>): T | Promise<T> {
    const startedAt = new Date().toISOString()
    const stepIdRow = this.db
      .insert(pipelineSteps)
      .values({
        runId: this.id,
        phase: opts.phase,
        step: opts.step,
        label: opts.label,
        status: 'running',
        startedAt,
      })
      .returning({ id: pipelineSteps.id })
      .get()
    const stepId = stepIdRow.id

    const ctx: StepCtx = {
      stepId,
      llm: (spec) => {
        const base = this.llmOverride?.(spec) ?? getLlmAdapter(spec)
        return wrapAdapterWithUsageRecording(base, this.db, stepId)
      },
      emit: (kind, message, data, opts) => {
        this.insertEvent(kind, message, data, { ...opts, stepId })
      },
      emitAdmin: (kind, message, data, opts) => {
        this.insertEvent(kind, message, data, { ...opts, stepId, visibility: 'admin' })
      },
    }

    const startTs = Date.now()
    const finalize = (status: RunStatus, error?: Error) => {
      const currentStep = this.db.select({ status: pipelineSteps.status }).from(pipelineSteps).where(eq(pipelineSteps.id, stepId)).get()
      if (currentStep?.status === 'cancelled') return
      this.db
        .update(pipelineSteps)
        .set({
          status,
          durationMs: Date.now() - startTs,
          finishedAt: new Date().toISOString(),
          errorMessage: error?.message,
          errorStack: error?.stack,
        })
        .where(eq(pipelineSteps.id, stepId))
        .run()
      if (status === 'done') {
        this.db
          .update(pipelineRuns)
          .set({ completedSteps: sql`${pipelineRuns.completedSteps} + 1` })
          .where(eq(pipelineRuns.id, this.id))
          .run()
      }
    }

    try {
      const result = fn(ctx)
      if (result instanceof Promise) {
        return result.then(
          (v) => {
            finalize('done')
            return v
          },
          (e) => {
            finalize('failed', e instanceof Error ? e : new Error(String(e)))
            throw e
          },
        )
      }
      finalize('done')
      return result
    } catch (e) {
      finalize('failed', e instanceof Error ? e : new Error(String(e)))
      throw e
    }
  }

  emit(kind: EventKind, message: string, data?: Record<string, unknown>, opts?: PipelineEventEmitOptions): void {
    this.insertEvent(kind, message, data, opts)
  }

  emitAdmin(kind: EventKind, message: string, data?: Record<string, unknown>, opts?: Omit<PipelineEventEmitOptions, 'visibility'>): void {
    this.insertEvent(kind, message, data, { ...opts, visibility: 'admin' })
  }

  private insertEvent(
    kind: EventKind,
    message: string,
    data?: Record<string, unknown>,
    opts: PipelineEventEmitOptions & { stepId?: number } = {},
  ): void {
    const visibility = opts.visibility ?? (kind === 'log' ? 'admin' : 'user')
    this.db
      .insert(pipelineEvents)
      .values({
        runId: this.id,
        stepId: opts.stepId,
        kind,
        visibility,
        messageKey: opts.messageKey,
        messageParams: opts.messageParams,
        message,
        data,
      })
      .run()
    if (visibility === 'user') progressBus.publish(this.id, { kind, message, data })
  }

  finish(status: 'done' | 'failed' | 'cancelled' | 'waiting_for_user', error?: string): void {
    const currentRun = this.db.select({ status: pipelineRuns.status }).from(pipelineRuns).where(eq(pipelineRuns.id, this.id)).get()
    if (currentRun?.status === 'cancelled' && status !== 'cancelled') return
    const message =
      status === 'done' ? '✓ 완료' : status === 'failed' ? `✗ 실패: ${error ?? 'unknown'}` : status === 'waiting_for_user' ? '사용자 확인 대기 중' : '✗ 취소됨'
    const messageKey =
      status === 'done'
        ? 'pipeline.finish.done'
        : status === 'failed'
          ? 'pipeline.finish.failed'
          : status === 'waiting_for_user'
            ? 'pipeline.finish.waiting_for_user'
            : 'pipeline.finish.cancelled'
    this.db
      .update(pipelineRuns)
      .set({
        status,
        finishedAt: new Date().toISOString(),
        errorMessage: error,
      })
      .where(eq(pipelineRuns.id, this.id))
      .run()
    this.insertEvent('milestone', message, undefined, {
      messageKey,
      messageParams: status === 'failed' ? { error: error ?? 'unknown' } : undefined,
    })
  }
}

/**
 * LLM adapter wrapper — call 결과를 활성 step에 자동 누적 UPDATE.
 *
 * 한 step에 여러 호출 시:
 *   - input_tokens / output_tokens / cache_* / cost_usd: COALESCE + 누적
 *   - llm_provider / model: 마지막 호출의 값으로 덮어씀
 *
 * 모델별 분해가 필요해지면 별 테이블(pipeline_step_llm_calls)로 분리.
 */
export function wrapAdapterWithUsageRecording(
  base: LlmAdapter,
  db: DB,
  stepId: number,
): LlmAdapter {
  return {
    provider: base.provider,
    model: base.model,
    async call(req: LlmRequest): Promise<LlmResponse> {
      const res = await base.call(req)
      db.update(pipelineSteps)
        .set({
          llmProvider: base.provider,
          model: res.model,
          inputTokens: sql`COALESCE(${pipelineSteps.inputTokens}, 0) + ${res.usage.inputTokens}`,
          outputTokens: sql`COALESCE(${pipelineSteps.outputTokens}, 0) + ${res.usage.outputTokens}`,
          cacheCreationTokens: sql`COALESCE(${pipelineSteps.cacheCreationTokens}, 0) + ${
            res.usage.cacheCreationTokens ?? 0
          }`,
          cacheReadTokens: sql`COALESCE(${pipelineSteps.cacheReadTokens}, 0) + ${
            res.usage.cacheReadTokens ?? 0
          }`,
          costUsd: sql`COALESCE(${pipelineSteps.costUsd}, 0) + ${res.costUsd}`,
        })
        .where(eq(pipelineSteps.id, stepId))
        .run()
      return res
    },
  }
}
