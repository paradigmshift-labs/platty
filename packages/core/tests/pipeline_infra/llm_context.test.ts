import { describe, expect, it } from 'vitest'
import {
  createPipelineLlmContext,
  createPipelineLlmTaskRegistry,
  PipelineLlmBudgetExceededError,
  PIPELINE_ADAPTER_LLM_TASK_ID,
  PIPELINE_LEGACY_LARGE_TASK_ID,
  type LlmGatewayTask,
  type PipelineLegacyLargeTaskInput,
} from '@/pipeline_infra/index.js'

describe('PipelineLlmContext', () => {
  it('routes single-shot LLM work through gatewayTask and records the unified mode', async () => {
    const registry = createPipelineLlmTaskRegistry()
    registry.register({
      id: 'fixture.single',
      mode: 'single',
      taskMaxConcurrency: 10,
      run: async (input: { value: string }, ctx) => {
        ctx.recordTelemetry({ provider: 'fake', model: 'fake-1', inputTokens: 3, outputTokens: 5, costUsd: 0.01 })
        return { value: input.value.toUpperCase(), mode: ctx.mode }
      },
    })

    const calls: Array<Record<string, unknown>> = []
    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stepId: 'step1',
      stage: 'build_docs',
      envConcurrency: 20,
      providerLimit: 15,
      projectBudgetLimit: 12,
      recordCall: (call) => calls.push(call),
    })

    const result = await llm.gatewayTask('fixture.single', { value: 'hello' }, { subjectId: 'doc1' })

    expect(result).toEqual({ value: 'HELLO', mode: 'single' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      runId: 'run1',
      stepId: 'step1',
      stage: 'build_docs',
      taskId: 'fixture.single',
      mode: 'single',
      unitId: 'doc1',
      pass: 'single',
      attempt: 1,
      concurrency: 10,
      provider: 'fake',
      model: 'fake-1',
    })
  })

  it('records adapter gateway metadata from generate options and adapter result', async () => {
    const registry = createPipelineLlmTaskRegistry()
    const calls: Array<Record<string, unknown>> = []
    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stepId: 'step1',
      stage: 'build_epics',
      recordCall: (call) => calls.push(call),
    })

    const result = await llm.gatewayTask(
      PIPELINE_ADAPTER_LLM_TASK_ID,
      {
        adapter: {
          async generate() {
            return {
              text: 'ok',
              result: {
                provider: 'claude_code',
                model: 'claude-sonnet-4-6',
                usage: { inputTokens: 10, outputTokens: 20 },
                costUsd: 0.03,
              },
            }
          },
        },
        prompt: 'hello',
        options: {
          provider: 'claude_code',
          model: 'claude-sonnet-4-6',
          pass: 'taxonomy_candidates',
          attempt: 2,
        },
      },
      { subjectId: 'epic:orders' },
    )

    expect(result).toMatchObject({ text: 'ok' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      runId: 'run1',
      stepId: 'step1',
      stage: 'build_epics',
      taskId: PIPELINE_ADAPTER_LLM_TASK_ID,
      mode: 'single',
      unitId: 'epic:orders',
      pass: 'taxonomy_candidates',
      attempt: 2,
      correlationId: 'run1:step1:epic:orders:taxonomy_candidates:2',
      provider: 'claude_code',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.03,
    })
  })

  it('clamps task concurrency by env, task max, provider limit, and project budget limit', async () => {
    const registry = createPipelineLlmTaskRegistry()
    const seen: number[] = []
    registry.register({
      id: 'fixture.batch',
      mode: 'batch',
      taskMaxConcurrency: 30,
      run: async (_input: unknown, ctx) => {
        seen.push(ctx.concurrency)
        return 'ok'
      },
    })

    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stepId: 'step1',
      stage: 'build_epics',
      envConcurrency: 20,
      providerLimit: 8,
      projectBudgetLimit: 12,
    })

    await llm.gatewayTask('fixture.batch', {})

    expect(seen).toEqual([8])
  })

  it('rejects gatewayTask when recorded LLM cost exceeds the run budget', async () => {
    const registry = createPipelineLlmTaskRegistry()
    const events: Array<Record<string, unknown>> = []
    registry.register({
      id: 'fixture.expensive',
      mode: 'single',
      run: async (_input: unknown, ctx) => {
        ctx.recordTelemetry({ costUsd: 1.25 })
        return 'ok'
      },
    })

    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stage: 'build_docs',
      budgetUsd: 1,
      recordGatewayEvent: (event) => events.push(event),
    })

    await expect(llm.gatewayTask('fixture.expensive', {})).rejects.toBeInstanceOf(PipelineLlmBudgetExceededError)
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failureCode: 'PIPELINE_LLM_BUDGET_EXCEEDED',
      success: false,
    })
  })

  it('notifies the execution layer when the LLM budget is exceeded', async () => {
    const registry = createPipelineLlmTaskRegistry()
    let budgetExceeded = false
    registry.register({
      id: 'fixture.expensive',
      mode: 'single',
      run: async (_input: unknown, ctx) => {
        ctx.recordTelemetry({ costUsd: 2 })
        return 'ok'
      },
    })

    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stage: 'build_docs',
      budgetUsd: 1,
      onBudgetExceeded: () => {
        budgetExceeded = true
      },
    })

    await expect(llm.gatewayTask('fixture.expensive', {})).rejects.toBeInstanceOf(PipelineLlmBudgetExceededError)
    expect(budgetExceeded).toBe(true)
  })

  it('enforces the computed concurrency limit for gateway tasks', async () => {
    const registry = createPipelineLlmTaskRegistry()
    let active = 0
    let maxActive = 0
    registry.register({
      id: 'fixture.limited',
      mode: 'single',
      taskMaxConcurrency: 2,
      run: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return 'ok'
      },
    })

    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stage: 'build_docs',
      envConcurrency: 10,
      providerLimit: 2,
    })

    await Promise.all([
      llm.gatewayTask('fixture.limited', {}, { subjectId: 'a' }),
      llm.gatewayTask('fixture.limited', {}, { subjectId: 'b' }),
      llm.gatewayTask('fixture.limited', {}, { subjectId: 'c' }),
      llm.gatewayTask('fixture.limited', {}, { subjectId: 'd' }),
    ])

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('uses PIPELINE_LLM_CONCURRENCY as the default gateway concurrency', async () => {
    const previous = process.env.PIPELINE_LLM_CONCURRENCY
    process.env.PIPELINE_LLM_CONCURRENCY = '3'
    try {
      const registry = createPipelineLlmTaskRegistry()
      let active = 0
      let maxActive = 0
      registry.register({
        id: 'fixture.env-default',
        mode: 'single',
        run: async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => setTimeout(resolve, 10))
          active -= 1
          return 'ok'
        },
      })

      const llm = createPipelineLlmContext({
        registry,
        runId: 'run1',
        stage: 'build_epics',
      })

      await Promise.all([
        llm.gatewayTask('fixture.env-default', {}, { subjectId: 'a' }),
        llm.gatewayTask('fixture.env-default', {}, { subjectId: 'b' }),
        llm.gatewayTask('fixture.env-default', {}, { subjectId: 'c' }),
        llm.gatewayTask('fixture.env-default', {}, { subjectId: 'd' }),
      ])

      expect(maxActive).toBe(3)
    } finally {
      if (previous === undefined) delete process.env.PIPELINE_LLM_CONCURRENCY
      else process.env.PIPELINE_LLM_CONCURRENCY = previous
    }
  })

  it('emits generic gateway lifecycle events with queue depth and active counts', async () => {
    const registry = createPipelineLlmTaskRegistry()
    registry.register({
      id: 'fixture.events',
      mode: 'single',
      taskMaxConcurrency: 1,
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return 'ok'
      },
    })
    const events: Array<Record<string, unknown>> = []
    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stage: 'build_business_docs',
      envConcurrency: 1,
      recordGatewayEvent: (event) => events.push(event),
    })

    await Promise.all([
      llm.gatewayTask('fixture.events', {}, { subjectId: 'first' }),
      llm.gatewayTask('fixture.events', {}, { subjectId: 'second' }),
    ])

    expect(events.map((event) => event.type)).toEqual([
      'queued',
      'queued',
      'started',
      'finished',
      'started',
      'finished',
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'queued', unitId: 'second', queueDepth: 1 }),
      expect.objectContaining({ type: 'started', activeCalls: 1, concurrency: 1 }),
      expect.objectContaining({ type: 'finished', success: true }),
    ]))
  })

  it('runs legacy large-task gateway work through the pipeline gateway registry', async () => {
    const registry = createPipelineLlmTaskRegistry()
    const task: LlmGatewayTask<{ value: string }, null, { value: string }, { id: string; value: string }, { value: string }, { value: string }> = {
      name: 'fixture.legacy_large_task',
      mode: 'independent_map',
      tokenBudget: {
        targetInputTokens: 100,
        maxInputTokens: 200,
        maxOutputTokens: 100,
        maxReduceDepth: 1,
      },
      execution: {
        mapConcurrency: 1,
        reduceConcurrency: 1,
        timeoutMs: 1000,
        maxRetries: 0,
        maxRepairAttempts: 0,
        maxChunkSplitDepth: 1,
      },
      project: (input) => input,
      chunkPlanner: {
        plan: (input) => [{ id: 'only', value: input.projection.value }],
      },
      mapper: async (chunk) => ({ value: chunk.value.toUpperCase() }),
      deterministicMerge: (items) => items[0] ?? { value: '' },
      validate: () => ({ fatalIssues: [], warnings: [] }),
      debugRecorder: { record() {} },
      getChunkId: (chunk) => chunk.id,
      getChunkPrompt: (chunk) => chunk.value,
    }
    const calls: Array<Record<string, unknown>> = []
    const llm = createPipelineLlmContext({
      registry,
      runId: 'run1',
      stepId: 'step1',
      stage: 'build_epics',
      recordCall: (call) => calls.push(call),
    })

    const result = await llm.gatewayTask<
      PipelineLegacyLargeTaskInput<{ value: string }, null, { value: string }, { id: string; value: string }, { value: string }, { value: string }>,
      { output: { value: string } }
    >(
      PIPELINE_LEGACY_LARGE_TASK_ID,
      { task, input: { value: 'platty' } },
      { subjectId: task.name },
    )

    expect(result.output).toEqual({ value: 'PLATTY' })
    expect(calls[0]).toMatchObject({
      taskId: PIPELINE_LEGACY_LARGE_TASK_ID,
      mode: 'map_reduce',
      unitId: 'fixture.legacy_large_task',
    })
  })
})
