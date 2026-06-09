import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runBuildDocsWorkerQueue } from '@/pipeline_modules/build_docs_cli_runtime/worker_runner.js'

describe('runBuildDocsWorkerQueue', () => {
  it('resumes the latest interrupted run before creating a new one', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'platty-docs-worker-'))
    let startCalled = false
    const runtime = {
      resumeLatestInterruptedRun: async () => ({ run_id: 'gen:docs:interrupted', status: 'running' }),
      start: async () => {
        startCalled = true
        throw new Error('should not start')
      },
      status: async () => ({
        run_id: 'gen:docs:interrupted',
        run_status: 'completed',
        task_counts_by_status: {},
        failed_tasks: [],
        saved_document_count: 0,
      }),
      approve: async () => null,
      leaseTasks: async () => ({
        type: 'tasks',
        run_id: 'gen:docs:interrupted',
        leased_tasks: [],
        actual_lease_count: 0,
        remaining_pending_task_count: 0,
      }),
    }

    try {
      const result = await runBuildDocsWorkerQueue({
        runtime: runtime as any,
        projectId: 'project:test',
        workers: 1,
        workDir,
        taskInvoker: async () => null,
      })

      expect(result.runId).toBe('gen:docs:interrupted')
      expect(startCalled).toBe(false)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('skips a task when submit loses the lease token and continues the queue', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'platty-docs-worker-'))
    const calls: string[] = []
    const runtime = {
      resumeLatestInterruptedRun: async () => null,
      start: async () => ({ run_id: 'gen:docs:lease-conflict', status: 'awaiting_approval' }),
      approve: async () => null,
      status: async () => ({
        run_id: 'gen:docs:lease-conflict',
        run_status: calls.includes('second-submitted') ? 'completed' : 'running',
        task_counts_by_status: calls.includes('second-submitted') ? { saved: 1 } : { pending: 1 },
        failed_tasks: [],
        saved_document_count: calls.includes('second-submitted') ? 1 : 0,
      }),
      leaseTasks: async () => {
        if (!calls.includes('first-leased')) {
          calls.push('first-leased')
          return leaseResult('task:first', 'lease:first')
        }
        if (!calls.includes('second-leased')) {
          calls.push('second-leased')
          return leaseResult('task:second', 'lease:second')
        }
        return {
          type: 'tasks',
          run_id: 'gen:docs:lease-conflict',
          leased_tasks: [],
          actual_lease_count: 0,
          remaining_pending_task_count: 0,
        }
      },
      getContext: async () => minimalApiContext(),
      submitTask: async (input: { taskId: string }) => {
        if (input.taskId === 'task:first') {
          throw Object.assign(new Error('lost lease'), { code: 'INVALID_LEASE_TOKEN' })
        }
        calls.push('second-submitted')
        return { status: 'saved' }
      },
    }

    try {
      const result = await runBuildDocsWorkerQueue({
        runtime: runtime as any,
        projectId: 'project:test',
        workers: 1,
        workDir,
        taskInvoker: async () => ({
          title: 'Order API',
          summary: 'Returns orders.',
          access: 'No access evidence.',
          flow: [],
          rules: [],
          source_link_selection: { access: [], input: [], response: [] },
        }),
      })

      expect(result.taskStats.saved).toBe(1)
      expect(calls).toContain('second-submitted')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('waits instead of failing no-progress while other workers hold active leases', async () => {
    vi.useFakeTimers()
    const workDir = mkdtempSync(join(tmpdir(), 'platty-docs-worker-'))
    let statusPolls = 0
    const runtime = {
      resumeLatestInterruptedRun: async () => null,
      start: async () => ({ run_id: 'gen:docs:active-leases', status: 'running' }),
      approve: async () => null,
      status: async () => {
        statusPolls += 1
        const completed = statusPolls > 2
        return {
          run_id: 'gen:docs:active-leases',
          run_status: completed ? 'completed' : 'running',
          task_counts_by_status: completed ? { saved: 1 } : { leased: 1 },
          failed_tasks: [],
          saved_document_count: completed ? 1 : 0,
        }
      },
      leaseTasks: async () => ({
        type: 'tasks',
        run_id: 'gen:docs:active-leases',
        leased_tasks: [],
        actual_lease_count: 0,
        remaining_pending_task_count: 0,
      }),
    }

    try {
      const run = runBuildDocsWorkerQueue({
        runtime: runtime as any,
        projectId: 'project:test',
        workers: 1,
        workDir,
        taskInvoker: async () => null,
      })
      await vi.advanceTimersByTimeAsync(5_000)

      await expect(run).resolves.toMatchObject({
        runId: 'gen:docs:active-leases',
        runStatus: 'completed',
      })
    } finally {
      vi.useRealTimers()
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('submits a failed draft when the task invoker does not return before the task timeout', async () => {
    vi.useFakeTimers()
    const workDir = mkdtempSync(join(tmpdir(), 'platty-docs-worker-'))
    let submittedDocument: unknown = null
    const runtime = {
      resumeLatestInterruptedRun: async () => null,
      start: async () => ({ run_id: 'gen:docs:task-timeout', status: 'running' }),
      approve: async () => null,
      status: async () => ({
        run_id: 'gen:docs:task-timeout',
        run_status: submittedDocument ? 'completed' : 'running',
        task_counts_by_status: submittedDocument ? { failed: 1 } : { pending: 1 },
        failed_tasks: [],
        saved_document_count: 0,
      }),
      leaseTasks: async () => submittedDocument ? {
        type: 'tasks',
        run_id: 'gen:docs:task-timeout',
        leased_tasks: [],
        actual_lease_count: 0,
        remaining_pending_task_count: 0,
      } : leaseResult('task:timeout', 'lease:timeout'),
      getContext: async () => minimalApiContext(),
      submitTask: async (input: { document: unknown }) => {
        submittedDocument = input.document
        return { status: 'failed' }
      },
    }

    try {
      const run = runBuildDocsWorkerQueue({
        runtime: runtime as any,
        projectId: 'project:test',
        workers: 1,
        workDir,
        taskInvoker: async () => new Promise(() => {}),
      })
      await vi.advanceTimersByTimeAsync(3 * 60_000 + 1)

      await expect(run).resolves.toMatchObject({
        runId: 'gen:docs:task-timeout',
        taskStats: { failed: 1, codexErrors: 1 },
      })
      expect(submittedDocument).toEqual({ title: '', summary: '', documentType: 'api_spec' })
    } finally {
      vi.useRealTimers()
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})

function leaseResult(taskId: string, leaseToken: string) {
  return {
    type: 'tasks',
    run_id: 'gen:docs:lease-conflict',
    actual_lease_count: 1,
    remaining_pending_task_count: 1,
    leased_tasks: [{
      type: 'task',
      run_id: 'gen:docs:lease-conflict',
      task_id: taskId,
      lease_token: leaseToken,
      document_type: 'api_spec',
      target_summary: 'api:GET:/orders',
      lease_expires_at: '2026-06-09T00:15:00.000Z',
    }],
  }
}

function minimalApiContext() {
  return {
    metadata: {
      run_id: 'gen:docs:lease-conflict',
      task_id: 'task:test',
      schema_version: 'build_docs_generation.v1',
      source_commit: 'commit:test',
    },
    manifest: {
      context_handle: 'ctx:task:test',
      schema_version: 'build_docs_generation.v1',
      pages: [],
      content_hash: 'hash:test',
    },
    content: {
      target: {},
      source_context: [],
      code_relation_facts: [],
      service_map_facts: [],
      related_edges: [],
      schema: {
        schema_name: 'api_spec',
        output_rules: [],
        quality_rules: [],
        system_injected_fields: [],
      },
      rules: [],
      evidence_gaps: [],
      evidence_reference_rules: {
        allowed_evidence_ids: [],
        required: false,
      },
      source_excerpts: [],
      relation_facts: [],
    },
  }
}
