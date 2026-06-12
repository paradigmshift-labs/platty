import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assignmentOutputSchema,
  buildBuildEpicsSyncAgentWorkPacket,
  crossOutputSchema,
  runBuildEpicsSyncWorkerQueue,
} from '@/pipeline_modules/build_epics/sync/worker_runner.js'

describe('buildBuildEpicsSyncAgentWorkPacket', () => {
  it('builds an assignment packet that includes existing epics and impacted document cards', () => {
    const packet = buildBuildEpicsSyncAgentWorkPacket({
      task: { taskId: 'task:sync', leaseToken: 'lease:sync', taskType: 'epic_sync_assignment', targetKey: 'sync:assignment:1' },
      context: {
        taskType: 'epic_sync_assignment',
        impactedCards: [{ documentId: 'doc:returns', type: 'api_spec', title: 'POST /returns', summary: 'Create return.' }],
        existingEpics: [{ stableKey: 'orders', name: 'Orders', summary: 'Orders summary' }],
      },
    })

    expect(packet.agentInput.outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['assignments'],
      properties: { assignments: expect.any(Object) },
    })
    expect(packet.agentInput.context).toMatchObject({
      taskType: 'epic_sync_assignment',
      impactedCards: [expect.objectContaining({ documentId: 'doc:returns' })],
      existingEpics: [expect.objectContaining({ stableKey: 'orders' })],
    })
    expect(packet.submit.command).toEqual([
      'platty',
      'epics',
      'sync',
      'tasks',
      'submit',
      '--task-id',
      'task:sync',
      '--lease-token',
      'lease:sync',
      '--input',
      'result.json',
      '--json',
    ])
  })

  it('uses a strict-compatible assignment schema for Codex structured output', () => {
    const schema = assignmentOutputSchema() as any
    const itemSchema = schema.properties.assignments.items

    expect(itemSchema.required).toEqual(Object.keys(itemSchema.properties))
    expect(itemSchema.properties.epicStableKey.type).toEqual(['string', 'null'])
    expect(itemSchema.properties.newEpic.anyOf).toEqual([
      expect.objectContaining({ type: 'object' }),
      { type: 'null' },
    ])
  })

  it('defaults sync worker prompts to English user-facing natural language', () => {
    const packet = buildBuildEpicsSyncAgentWorkPacket({
      task: { taskId: 'task:sync', leaseToken: 'lease:sync', taskType: 'epic_sync_assignment', targetKey: 'sync:assignment:1' },
      context: {
        taskType: 'epic_sync_assignment',
        impactedCards: [],
        existingEpics: [],
      },
    })

    expect(packet.agentInput.prompt).toContain('Write user-facing natural-language values in English.')
    expect(packet.agentInput.prompt).toContain('Do not translate JSON keys or source identifiers.')
  })

  it('uses Korean sync worker prompt instructions when the context requests Korean', () => {
    const packet = buildBuildEpicsSyncAgentWorkPacket({
      task: { taskId: 'task:sync', leaseToken: 'lease:sync', taskType: 'epic_sync_assignment', targetKey: 'sync:assignment:1' },
      context: {
        taskType: 'epic_sync_assignment',
        outputLanguage: 'ko',
        impactedCards: [],
        existingEpics: [],
      },
    })

    expect(packet.agentInput.prompt).toContain('Write user-facing natural-language values in Korean.')
  })

  it('narrows assignment schema to current impacted documents and existing EPIC keys', () => {
    const schema = assignmentOutputSchema({
      impactedCards: [
        { documentId: 'doc:api', type: 'api_spec' },
        { documentId: 'doc:screen', type: 'screen_spec' },
      ],
      existingEpics: [
        { stableKey: 'orders' },
        { stableKey: 'shopping' },
      ],
    }) as any
    const alternatives = schema.properties.assignments.items.anyOf

    expect(alternatives).toHaveLength(2)
    expect(alternatives[0].properties.documentId.enum).toEqual(['doc:api'])
    expect(alternatives[0].properties.role.enum).toEqual(['owner'])
    expect(alternatives[0].properties.epicStableKey.anyOf[0].enum).toEqual(['orders', 'shopping'])
    expect(alternatives[1].properties.documentId.enum).toEqual(['doc:screen'])
    expect(alternatives[1].properties.role.enum).toEqual(['owner', 'primary', 'supporting'])
  })

  it('builds a cross-link packet with cross schema and affected cards', () => {
    const packet = buildBuildEpicsSyncAgentWorkPacket({
      task: { taskId: 'task:cross', leaseToken: 'lease:cross', taskType: 'epic_sync_cross_links', targetKey: 'sync:cross_links:1' },
      context: {
        taskType: 'epic_sync_cross_links',
        affectedCards: [{ documentId: 'doc:returns', type: 'api_spec', title: 'POST /returns', summary: 'Create return.' }],
        existingEpics: [
          { stableKey: 'orders', name: 'Orders', summary: 'Orders summary', apiDocIds: ['doc:orders'] },
          { stableKey: 'returns', name: 'Returns', summary: 'Returns summary', apiDocIds: ['doc:returns'] },
        ],
      },
    })

    expect(packet.task.taskType).toBe('epic_sync_cross_links')
    expect(packet.agentInput.outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['links'],
      properties: { links: expect.any(Object) },
    })
    expect(packet.agentInput.context).toMatchObject({
      taskType: 'epic_sync_cross_links',
      affectedCards: [expect.objectContaining({ documentId: 'doc:returns' })],
    })
    expect(packet.agentInput.prompt).toContain('cross-EPIC links')
    expect(packet.agentInput.forbiddenFields).toEqual(['domains', 'epics', 'assignments', 'dependencies'])
  })

  it('builds a restructure work packet with split merge move schema', () => {
    const packet = buildBuildEpicsSyncAgentWorkPacket({
      task: {
        taskId: 'task:restructure',
        leaseToken: 'lease:restructure',
        taskType: 'epic_sync_restructure',
        targetKey: 'sync:restructure:1',
      },
      context: {
        taskType: 'epic_sync_restructure',
        restructureReasons: [{ code: 'BACKEND_APIS_EXPAND_SINGLE_EPIC', epicStableKey: 'user_management' }],
        existingEpics: [{ stableKey: 'user_management', name: 'User Management', apiDocIds: ['doc:users', 'doc:roles'] }],
        impactedCards: [{ documentId: 'doc:roles', type: 'api_spec', title: 'POST /roles', summary: 'Manage roles.' }],
      },
    })

    expect(packet.task.taskType).toBe('epic_sync_restructure')
    expect(JSON.stringify(packet.agentInput.outputSchema)).toContain('split_epic')
    expect(JSON.stringify(packet.agentInput.outputSchema)).toContain('merge_epics')
    expect(JSON.stringify(packet.agentInput.outputSchema)).toContain('move_document')
    expect(JSON.stringify(packet.agentInput.outputSchema)).toContain('doc:users')
    expect(packet.agentInput.rules).toEqual(expect.arrayContaining([
      expect.stringContaining('Do not auto-confirm'),
    ]))
    expect(packet.agentInput.forbiddenFields).toEqual(['domains', 'epics', 'assignments', 'links', 'dependencies'])
  })

  it('uses a strict-compatible cross-link schema for Codex structured output', () => {
    const schema = crossOutputSchema() as any
    const itemSchema = schema.properties.links.items

    expect(itemSchema.required).toEqual(Object.keys(itemSchema.properties))
    expect(itemSchema.properties.kind.enum).toEqual([
      'cross_domain_policy',
      'reward_or_coupon_effect',
      'state_change',
      'event_flow',
      'shared_user_journey',
      'operational_dependency',
    ])
    expect(itemSchema.properties.role.enum).toEqual(['impact', 'supporting', 'reference'])
  })

  it('narrows cross-link schema to affected documents and existing EPIC keys', () => {
    const schema = crossOutputSchema({
      affectedCards: [
        { documentId: 'doc:screen' },
      ],
      existingEpics: [
        { stableKey: 'orders' },
        { stableKey: 'shopping' },
      ],
    }) as any
    const itemSchema = schema.properties.links.items

    expect(itemSchema.properties.sourceDocumentId.enum).toEqual(['doc:screen'])
    expect(itemSchema.properties.targetEpicStableKey.enum).toEqual(['orders', 'shopping'])
  })

  it('marks a task failed instead of completing it when the worker invocation fails', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'platty-epics-sync-worker-'))
    let leaseCount = 0
    let failedTaskId: string | null = null
    let submittedResult: unknown = null
    const runtime = {
      resumeLatestInterruptedRun: async () => null,
      start: async () => ({ runId: 'run:sync', status: 'running' }),
      leaseTasks: async () => {
        leaseCount += 1
        return leaseCount === 1
          ? {
              leasedTasks: [{ taskId: 'task:sync', targetKey: 'sync:assignment:1', leaseToken: 'lease:sync' }],
              remainingPendingTaskCount: 0,
            }
          : { leasedTasks: [], remainingPendingTaskCount: 0 }
      },
      getContext: async () => ({
        content: {
          taskType: 'epic_sync_assignment',
          impactedCards: [{ documentId: 'doc:returns', type: 'api_spec', title: 'POST /returns', summary: 'Create return.' }],
          existingEpics: [],
        },
      }),
      submitTask: async (_input: { result: unknown }) => {
        submittedResult = _input.result
        return { status: 'completed', validationErrors: [] }
      },
      failTask: async (input: { taskId: string }) => {
        failedTaskId = input.taskId
        return { status: 'failed', validationErrors: [{ code: 'SYNC_WORKER_INVOCATION_FAILED' }] }
      },
      status: async () => ({
        runStatus: failedTaskId ? 'failed' : submittedResult ? 'completed' : 'running',
        draftStatus: failedTaskId ? 'invalid' : submittedResult ? 'ready' : 'building',
        taskCountsByStatus: failedTaskId ? { failed: 1 } : submittedResult ? { completed: 1 } : { leased: 1 },
      }),
      showDraft: async () => null,
    }

    try {
      const result = await runBuildEpicsSyncWorkerQueue({
        runtime: runtime as any,
        projectId: 'p1',
        docSyncPlanId: 'plan:sync',
        workers: 1,
        workDir,
        taskInvoker: async () => {
          throw new Error('codex failed')
        },
      })

      expect(result.taskStats).toMatchObject({ invocationErrors: 1, completed: 0, failed: 1 })
      expect(failedTaskId).toBe('task:sync')
      expect(submittedResult).toBeNull()
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('resumes the latest interrupted run before creating a new one', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'platty-epics-sync-worker-'))
    let startCalled = false
    const runtime = {
      resumeLatestInterruptedRun: async () => ({ runId: 'gen:sync:interrupted', status: 'running' }),
      start: async () => {
        startCalled = true
        throw new Error('should not start')
      },
      leaseTasks: async () => ({ leasedTasks: [], remainingPendingTaskCount: 0 }),
      status: async () => ({ runStatus: 'completed', draftStatus: 'ready', taskCountsByStatus: {} }),
      showDraft: async () => ({ plan: { epics: [], syncMetadata: {} } }),
    }

    try {
      const result = await runBuildEpicsSyncWorkerQueue({
        runtime: runtime as any,
        projectId: 'p1',
        docSyncPlanId: 'plan:sync',
        workers: 1,
        workDir,
        taskInvoker: async () => null,
      })

      expect(result.runId).toBe('gen:sync:interrupted')
      expect(startCalled).toBe(false)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
