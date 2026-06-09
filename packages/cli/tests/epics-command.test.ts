import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb, schema, type DB, type TestPlattyDb } from '@platty/core'
import { runPlattyCommand } from '../src/main.js'

let rootDir: string
let db: DB
let client: TestPlattyDb

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'platty-cli-epics-'))
  vi.stubEnv('PLATTY_HOME', join(rootDir, '.platty'))
  client = createTestPlattyDb()
  db = client.db
  await runPlattyCommand(['init', '--json'], { cwd: rootDir, db })
  seedProject(db)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await client.cleanup()
  rmSync(rootDir, { recursive: true, force: true })
})

describe('platty epics CLI runtime', () => {
  it('does not import the pipeline infra barrel from CLI-loaded epic modules', () => {
    const runtime = readFileSync(join(process.cwd(), '../core/src/pipeline_modules/build_epics/runtime/runtime.ts'), 'utf8')
    const persist = readFileSync(join(process.cwd(), '../core/src/pipeline_modules/build_epics/core/f10_persist_confirmed_epics.ts'), 'utf8')

    expect(runtime).not.toContain('@/pipeline_infra/index.js')
    expect(persist).not.toContain('@/pipeline_infra/index.js')
    expect(runtime).toContain('@/pipeline_infra/phase/phase_status.js')
    expect(persist).toContain('@/pipeline_infra/phase/phase_status.js')
  })

  it('previews build_epics runtime policy through JSON command result', async () => {
    const command = await runPlattyCommand(['epics', 'preview', '--project', 'project:test', '--json'], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        documentCounts: { api_spec: 2 },
        estimatedTasks: {
          taxonomy_candidate: expect.any(Number),
          taxonomy_consolidation: 1,
          document_assignment: expect.any(Number),
          cross_domain_link: expect.any(Number),
        },
      },
      warnings: [],
      errors: [],
    })
    expect(JSON.parse(command.stdout)).toEqual(command.result)
  })

  it('starts, leases, reads context, submits, and shows a draft through CLI commands', async () => {
    const preview = await runPlattyCommand(['epics', 'preview', '--project', 'project:test', '--json'], { cwd: rootDir, db })
    const policyPath = join(rootDir, 'policy.json')
    writeFileSync(policyPath, JSON.stringify(preview.result.data?.recommendedPolicy), 'utf8')

    const start = await runPlattyCommand(['epics', 'start', '--project', 'project:test', '--policy', policyPath, '--json'], { cwd: rootDir, db })
    const runId = String(start.result.data?.runId)

    for (;;) {
      const lease = await runPlattyCommand(['epics', 'tasks', 'lease', '--run-id', runId, '--limit', '1', '--worker-id', 'worker:cli', '--json'], { cwd: rootDir, db })
      const leasedTasks = lease.result.data?.leasedTasks as Array<{ taskId: string; leaseToken: string; taskType: string }> | undefined
      if (!leasedTasks || leasedTasks.length === 0) break

      const task = leasedTasks[0]!
      const context = await runPlattyCommand(['epics', 'context', 'get', '--task-id', task.taskId, '--lease-token', task.leaseToken, '--json'], { cwd: rootDir, db })
      const content = context.result.data?.content as { taskType: string; cards: Array<{ documentId: string; title: string }>; epics?: Array<{ stableKey: string; tempEpicId?: string }> }
      const resultPath = join(rootDir, `${task.taskId.replaceAll(':', '-')}.json`)
      writeFileSync(resultPath, JSON.stringify(fakeCliResult(content)), 'utf8')

      const submit = await runPlattyCommand(['epics', 'tasks', 'submit', '--task-id', task.taskId, '--lease-token', task.leaseToken, '--input', resultPath, '--json'], { cwd: rootDir, db })
      expect(submit.result.data).toMatchObject({ status: 'completed' })
    }

    const draft = await runPlattyCommand(['epics', 'draft', 'show', '--run-id', runId, '--json'], { cwd: rootDir, db })

    expect(draft.exitCode).toBe(0)
    expect(draft.result.data).toMatchObject({ status: 'ready' })
    expect((draft.result.data?.plan as { epics?: Array<{ crossLinks: unknown[] }> }).epics?.some((epic) => epic.crossLinks.length > 0)).toBe(true)

    const editPath = join(rootDir, 'edit.json')
    writeFileSync(editPath, JSON.stringify({
      expectedVersion: 1,
      commands: [{
        type: 'rename_epic',
        epicId: 'epic:orders',
        name: 'Order Management',
        reason: 'User requested clearer naming.',
      }],
    }), 'utf8')

    const edit = await runPlattyCommand(['epics', 'draft', 'edit', '--run-id', runId, '--input', editPath, '--json'], { cwd: rootDir, db })
    const confirm = await runPlattyCommand(['epics', 'draft', 'confirm', '--run-id', runId, '--json'], { cwd: rootDir, db })

    expect(edit.exitCode).toBe(0)
    expect(edit.result.data).toMatchObject({
      previousVersion: 1,
      nextVersion: 2,
    })
    expect(confirm.exitCode).toBe(0)
    expect(confirm.result.data).toMatchObject({ status: 'confirmed' })
  })

  it('returns a self-contained worker packet for Claude or Codex skill workers', async () => {
    const preview = await runPlattyCommand(['epics', 'preview', '--project', 'project:test', '--json'], { cwd: rootDir, db })
    const policyPath = join(rootDir, 'policy.json')
    writeFileSync(policyPath, JSON.stringify(preview.result.data?.recommendedPolicy), 'utf8')
    const start = await runPlattyCommand(['epics', 'start', '--project', 'project:test', '--policy', policyPath, '--json'], { cwd: rootDir, db })
    const runId = String(start.result.data?.runId)

    const next = await runPlattyCommand([
      'epics',
      'worker',
      'next',
      '--run-id',
      runId,
      '--worker-id',
      'worker:epics:claude:1',
      '--json',
    ], { cwd: rootDir, db })

    expect(next.exitCode).toBe(0)
    expect(next.result.data).toMatchObject({
      type: 'task',
      task: {
        taskId: expect.any(String),
        leaseToken: expect.stringMatching(/^lease:/),
        taskType: 'taxonomy_candidate',
        targetKey: expect.any(String),
      },
      agentInput: {
        modelHint: { provider: 'claude_code', model: 'haiku', effort: 'low' },
        prompt: expect.stringContaining('Platty build_epics taxonomy candidates'),
        outputSchema: {
          type: 'object',
          required: expect.arrayContaining(['domains', 'epics']),
        },
        context: {
          content: {
            taskType: 'taxonomy_candidate',
            cards: expect.any(Array),
          },
        },
        forbiddenFields: expect.arrayContaining(['assignments']),
      },
      submit: {
        command: expect.arrayContaining(['platty', 'epics', 'tasks', 'submit']),
      },
    })
  })

  it('runs the final Codex worker preset through the epics run wrapper', async () => {
    const calls: Array<{ taskType: string; model: string; provider: string; effort?: string }> = []
    const command = await runPlattyCommand([
      'epics',
      'run',
      '--project',
      'project:test',
      '--provider',
      'codex_cli',
      '--preset',
      'final-mixed',
      '--workers',
      '2',
      '--json',
    ], {
      cwd: rootDir,
      db,
      epicsTaskInvoker: async ({ content, model }) => {
        calls.push({ taskType: content.taskType, provider: model.provider, model: model.model, effort: model.effort })
        return fakeCliResult(content)
      },
    })

    expect(command.exitCode).toBe(0)
    expect(command.result.data).toMatchObject({
      runStatus: 'completed',
      draftStatus: 'ready',
      taskCountsByStatus: { completed: expect.any(Number) },
      validation: { fatal: 0, warnings: 0 },
      modelPolicy: {
        taxonomy_candidate: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'low' },
        taxonomy_consolidation: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
        document_assignment: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
        cross_domain_link: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
      },
    })
    expect(calls.map((call) => call.taskType)).toContain('taxonomy_candidate')
    expect(calls.map((call) => call.taskType)).toContain('document_assignment')
    expect(calls.map((call) => call.taskType)).toContain('cross_domain_link')
  })
})

function seedProject(db: DB): void {
  const now = new Date().toISOString()
  db.insert(schema.projects).values({ id: 'project:test', name: 'Project', createdAt: now, updatedAt: now }).run()
  db.insert(schema.repositories).values({ id: 'repo:test', projectId: 'project:test', name: 'repo', repoPath: rootDir, createdAt: now, updatedAt: now }).run()
  db.insert(schema.documents).values([
    row('api:orders', 'GET /orders', 'Orders API.'),
    row('api:users', 'GET /users', 'Users API.'),
  ]).run()
}

function row(id: string, title: string, summary: string) {
  const [method, path] = title.split(' ')
  return {
    id,
    projectId: 'project:test',
    type: 'api_spec',
    track: 'technical',
    scope: 'endpoint',
    scopeId: id,
    status: 'passed',
    validity: 'fresh',
    summary,
    content: { title, summary, method, path, handler: `${id}Handler` },
    rawLlmOutput: '{}',
    sourceRunId: 'run:docs',
    sourceCommit: 'commit:test',
  }
}

function fakeCliResult(content: { taskType: string; cards: Array<{ documentId: string; title: string }>; epics?: Array<{ stableKey: string; tempEpicId?: string }> }) {
  if (content.taskType === 'taxonomy_candidate') {
    return {
      domains: [{ domainId: 'domain:product', stableKey: 'product', name: 'Product', summary: 'Product domain.' }],
      epics: [
        { tempEpicId: 'epic:orders', domainId: 'domain:product', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Orders EPIC.' },
        { tempEpicId: 'epic:users', domainId: 'domain:product', stableKey: 'users', name: 'Users', abbr: 'USR', summary: 'Users EPIC.' },
      ],
    }
  }
  if (content.taskType === 'taxonomy_consolidation') {
    return {
      domains: [{ domainId: 'domain:product', stableKey: 'product', name: 'Product', summary: 'Product domain.' }],
      epics: [
        { tempEpicId: 'epic:orders', domainId: 'domain:product', stableKey: 'orders', name: 'Orders', abbr: 'ORD', summary: 'Orders EPIC.' },
        { tempEpicId: 'epic:users', domainId: 'domain:product', stableKey: 'users', name: 'Users', abbr: 'USR', summary: 'Users EPIC.' },
      ],
      aliases: [],
      boundaryNotes: [],
    }
  }
  if (content.taskType === 'cross_domain_link') {
    const source = content.cards.find((card) => card.documentId.includes('orders'))
    const target = content.epics?.find((epic) => epic.stableKey === 'users')
    return source && target?.tempEpicId
      ? {
          links: [{
            sourceDocumentId: source.documentId,
            targetTempEpicId: target.tempEpicId,
            kind: 'shared_user_journey',
            role: 'reference',
            confidence: 'medium',
            reason: 'Orders and users share account context.',
          }],
        }
      : { links: [] }
  }
  return {
    assignments: content.cards.map((card) => ({
      documentId: card.documentId,
      epicKey: card.documentId.includes('orders') ? 'orders' : 'users',
      role: 'owner',
      confidence: 'high',
      reason: `Assigned ${card.title}.`,
    })),
  }
}
