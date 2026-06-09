import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestPlattyDb, schema, type DB, type TestPlattyDb } from '@platty/core'
import { runPlattyCommand } from '../src/main.js'

let rootDir: string
let db: DB
let client: TestPlattyDb

const {
  businessDocGenerationTasks,
  docSyncCandidates,
  docSyncPlans,
  documentItemDocumentLinks,
  documentItems,
  documents,
  epicDocumentLinks,
  epics,
  staticMerkleSnapshots,
} = schema

const now = '2026-06-04T00:00:00.000Z'

beforeEach(async () => {
  rootDir = mkdtempSync(join(tmpdir(), 'platty-cli-business-docs-'))
  vi.stubEnv('PLATTY_HOME', join(rootDir, '.platty'))
  client = createTestPlattyDb()
  db = client.db
  await runPlattyCommand(['init', '--json'], { cwd: rootDir, db })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await client.cleanup()
  rmSync(rootDir, { recursive: true, force: true })
})

describe('platty business-docs CLI', () => {
  it('previews generation with a JSON envelope for the selected project and exact default policy', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))

    const command = await runPlattyCommand(['business-docs', 'preview', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(JSON.parse(command.stdout)).toEqual(command.result)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        project: {
          id: project.result.data?.id,
          name: 'Commerce',
        },
        confirmedEpicCount: 1,
        selectedEpicCount: 1,
        recommendedPolicy: {
          workerRuntime: 'external_cli',
          workerProvider: 'codex',
          maxWorkerCount: 20,
          approvedActiveLeases: 20,
          epicSchedulingConcurrency: 4,
          writerSoftLimit: 6,
          ucsChunkSize: 1,
          ucsSchedulingConcurrency: 16,
          maxRepairAttempts: 1,
          persistMode: 'incremental',
          projectGlossaryMode: 'auto',
          judgeMode: 'off',
          outputLanguage: 'ko',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('requires an explicit or current project before previewing', async () => {
    const command = await runPlattyCommand(['business-docs', 'preview', '--json'], { cwd: rootDir, db })

    expect(command.exitCode).toBe(2)
    expect(command.result).toMatchObject({
      ok: false,
      errors: [{ code: 'PROJECT_NOT_SELECTED', message: 'No Platty project is selected' }],
      nextAction: {
        type: 'select_project',
        command: ['platty', 'project', 'list'],
      },
    })
  })

  it('starts generation with a JSON envelope for a runnable project', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))

    const command = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(JSON.parse(command.stdout)).toEqual(command.result)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
        project: {
          id: project.result.data?.id,
          name: 'Commerce',
        },
        run: {
          projectId: project.result.data?.id,
          status: 'running',
          forceRegenerate: false,
        },
        tasks: {
          total: 7,
          created: 7,
        },
        contexts: {
          bundlesCreated: 7,
        },
        nextAction: {
          type: 'lease_tasks',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('resumes the existing incomplete run by default', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))

    const first = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const second = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(second.result).toMatchObject({
      ok: true,
      data: {
        mode: 'resumed',
        run: {
          id: first.result.data?.run.id,
        },
        nextAction: {
          type: 'inspect_existing_run',
        },
      },
    })
  })

  it('creates a new run when --new-run is provided', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))

    const first = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const second = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--new-run', '--json'], { cwd: rootDir, db })

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(second.result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
      },
    })
    expect(second.result.data?.run.id).not.toBe(first.result.data?.run.id)
  })

  it('plans active business documents again when --force-regenerate is provided', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    seedBusinessDocument(projectId, { id: 'business:orders-design', type: 'design', scopeId: 'epic:orders' })

    const command = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--force-regenerate', '--json'], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
        run: {
          forceRegenerate: true,
        },
        tasks: {
          total: 7,
          byType: {
            system_design: 1,
          },
        },
      },
    })
  })

  it('starts generation for only the EPIC selected by --epic', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    db.insert(epics).values({
      id: 'epic:benefits',
      projectId,
      name: 'Benefits',
      abbr: 'BEN',
      status: 'confirmed',
      source: 'build_epics',
      confidence: 'high',
      confirmedAt: now,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }).run()
    db.insert(documents).values({
      id: 'doc:benefits-screen',
      projectId,
      type: 'screen_spec',
      track: 'technical',
      scope: 'screen_spec',
      scopeId: 'doc:benefits-screen',
      status: 'active',
      validity: 'fresh',
      summary: 'Benefits screen',
      content: { id: 'doc:benefits-screen', title: 'Benefits screen' },
      rawLlmOutput: '',
      updatedBy: 'system',
      updatedAt: now,
    }).run()
    db.insert(epicDocumentLinks).values({
      epicId: 'epic:benefits',
      documentId: 'doc:benefits-screen',
      documentType: 'screen_spec',
      role: 'primary',
      reason: 'test link',
      confidence: 'high',
      createdAt: now,
    }).run()

    const command = await runPlattyCommand([
      'business-docs',
      'start',
      '--project',
      'Commerce',
      '--epic',
      'epic:benefits',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        preview: {
          confirmedEpicCount: 2,
          selectedEpicCount: 1,
          documentPlan: {
            perEpic: [
              expect.objectContaining({
                epicId: 'epic:benefits',
              }),
            ],
          },
        },
        tasks: {
          total: 7,
          created: 7,
        },
      },
    })
    const tasks = db.select().from(businessDocGenerationTasks).all()
    expect(tasks.filter((task) => task.scope === 'epic').every((task) => task.epicId === 'epic:benefits')).toBe(true)
  })

  it('leases business docs tasks for a worker', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    const command = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '2',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(JSON.parse(command.stdout)).toEqual(command.result)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        run: {
          id: started.result.data?.run.id,
          projectId,
        },
        worker: {
          id: 'codex-1',
        },
        lease: {
          requested: 2,
          granted: 2,
        },
        nextAction: {
          type: 'read_context',
        },
      },
      warnings: [],
      errors: [],
    })
    expect(command.result.data?.tasks).toHaveLength(2)
    expect(command.result.data?.tasks[0]).toMatchObject({
      leaseToken: expect.any(String),
      contextHandle: expect.any(String),
      contextPageTokens: expect.arrayContaining(['target', 'schema', 'source_document_cards']),
    })
  })

  it('validates required fields for business docs task leasing', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    const missingRun = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--worker',
      'codex-1',
      '--json',
    ], { cwd: rootDir, db })
    expect(missingRun.exitCode).toBe(2)
    expect(missingRun.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_RUN_REQUIRED' }],
    })

    const missingWorker = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--json',
    ], { cwd: rootDir, db })
    expect(missingWorker.exitCode).toBe(2)
    expect(missingWorker.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_WORKER_REQUIRED' }],
    })

    const invalidLimit = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '0',
      '--json',
    ], { cwd: rootDir, db })
    expect(invalidLimit.exitCode).toBe(2)
    expect(invalidLimit.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_INVALID_LIMIT' }],
    })
  })

  it('heartbeats a leased business docs task', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const leased = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '1',
      '--json',
    ], { cwd: rootDir, db })
    expect(leased.exitCode).toBe(0)
    const task = leased.result.data?.tasks[0]

    const command = await runPlattyCommand([
      'business-docs',
      'tasks',
      'heartbeat',
      '--project',
      'Commerce',
      '--task',
      String(task.id),
      '--lease-token',
      String(task.leaseToken),
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        task: {
          id: task.id,
          status: 'leased',
          workerId: 'codex-1',
        },
        lease: {
          leaseToken: task.leaseToken,
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('reads business docs context bundle and page with a lease token', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const leased = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '1',
      '--json',
    ], { cwd: rootDir, db })
    expect(leased.exitCode).toBe(0)
    const task = leased.result.data?.tasks[0]

    const bundle = await runPlattyCommand([
      'business-docs',
      'context',
      'get',
      '--context',
      String(task.contextHandle),
      '--lease-token',
      String(task.leaseToken),
      '--json',
    ], { cwd: rootDir, db })
    expect(bundle.exitCode).toBe(0)
    expect(bundle.result).toMatchObject({
      ok: true,
      data: {
        task: {
          id: task.id,
          status: 'leased',
        },
        manifest: {
          taskId: task.id,
        },
        pages: expect.arrayContaining([
          expect.objectContaining({ pageToken: 'target' }),
        ]),
      },
      warnings: [],
      errors: [],
    })
    expect(JSON.stringify(bundle.result.data?.pages)).not.toContain('contentJson')

    const page = await runPlattyCommand([
      'business-docs',
      'context',
      'page',
      '--context',
      String(task.contextHandle),
      '--page',
      'target',
      '--lease-token',
      String(task.leaseToken),
      '--json',
    ], { cwd: rootDir, db })
    expect(page.exitCode).toBe(0)
    expect(page.result).toMatchObject({
      ok: true,
      data: {
        page: {
          pageToken: 'target',
          content: {
            taskId: task.id,
          },
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('rejects business docs context reads with a wrong lease token', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const leased = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '1',
      '--json',
    ], { cwd: rootDir, db })
    expect(leased.exitCode).toBe(0)
    const task = leased.result.data?.tasks[0]

    const command = await runPlattyCommand([
      'business-docs',
      'context',
      'page',
      '--context',
      String(task.contextHandle),
      '--page',
      'target',
      '--lease-token',
      'wrong',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(2)
    expect(command.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_LEASE_CONFLICT' }],
    })
  })

  it('validates required fields and JSON for business docs task submit', async () => {
    await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })

    const missingTask = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--lease-token',
      'token',
      '--attempt',
      '0',
      '--document-json',
      '{}',
      '--json',
    ], { cwd: rootDir, db })
    expect(missingTask.exitCode).toBe(2)
    expect(missingTask.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_TASK_REQUIRED' }],
    })

    const missingToken = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--task',
      'task:1',
      '--attempt',
      '0',
      '--document-json',
      '{}',
      '--json',
    ], { cwd: rootDir, db })
    expect(missingToken.exitCode).toBe(2)
    expect(missingToken.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_LEASE_TOKEN_REQUIRED' }],
    })

    const invalidAttempt = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--task',
      'task:1',
      '--lease-token',
      'token',
      '--attempt',
      'x',
      '--document-json',
      '{}',
      '--json',
    ], { cwd: rootDir, db })
    expect(invalidAttempt.exitCode).toBe(2)
    expect(invalidAttempt.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_ATTEMPT_REQUIRED' }],
    })

    const missingJson = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--task',
      'task:1',
      '--lease-token',
      'token',
      '--attempt',
      '0',
      '--json',
    ], { cwd: rootDir, db })
    expect(missingJson.exitCode).toBe(2)
    expect(missingJson.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_SUBMIT_JSON_REQUIRED' }],
    })

    const invalidJson = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--task',
      'task:1',
      '--lease-token',
      'token',
      '--attempt',
      '0',
      '--document-json',
      '{',
      '--json',
    ], { cwd: rootDir, db })
    expect(invalidJson.exitCode).toBe(2)
    expect(invalidJson.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_SUBMIT_JSON_INVALID' }],
    })
  })

  it('submits a valid leased business docs task through CLI', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const leased = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '4',
      '--json',
    ], { cwd: rootDir, db })
    expect(leased.exitCode).toBe(0)
    const task = leased.result.data?.tasks.find((candidate: { taskType: string }) => candidate.taskType === 'business_rules')
    expect(task).toBeTruthy()
    const bundle = await runPlattyCommand([
      'business-docs',
      'context',
      'get',
      '--context',
      String(task.contextHandle),
      '--lease-token',
      String(task.leaseToken),
      '--json',
    ], { cwd: rootDir, db })
    expect(bundle.exitCode).toBe(0)
    const document = documentForTask(task, evidenceIdsFromBundle(bundle.result.data))

    const command = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--task',
      String(task.id),
      '--lease-token',
      String(task.leaseToken),
      '--attempt',
      String(task.attemptNo),
      '--document-json',
      JSON.stringify(document),
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(JSON.parse(command.stdout)).toEqual(command.result)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        task: {
          id: task.id,
          status: 'saved',
        },
        document: {
          savedDocumentId: expect.any(String),
          proposalId: null,
        },
        nextAction: {
          type: 'lease_more',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('runs Codex worker tasks through the business-docs run wrapper', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const calls: Array<{ taskType: string; provider: string; model: string; effort?: string }> = []

    const command = await runPlattyCommand([
      'business-docs',
      'run',
      '--project',
      'Commerce',
      '--provider',
      'codex_cli',
      '--workers',
      '2',
      '--json',
    ], {
      cwd: rootDir,
      db,
      businessDocsTaskInvoker: async ({ task, contextBundle, contextPages, model }) => {
        calls.push({
          taskType: task.taskType,
          provider: model.provider,
          model: model.model,
          effort: model.effort,
        })
        return documentForTask(task, [
          ...evidenceIdsFromBundle(contextBundle),
          ...evidenceIdsFromContextPages(contextPages),
        ], contextPages)
      },
    })

    expect(command.exitCode).toBe(0)
    expect(command.result.data).toMatchObject({
      runStatus: 'completed',
      taskCountsByStatus: {
        saved: expect.any(Number),
      },
      documents: {
        saved: expect.any(Number),
      },
      modelPolicy: {
        system_design: {
          provider: 'codex_cli',
          model: 'gpt-5.4',
          effort: 'medium',
        },
      },
    })
    expect(calls.map((call) => call.taskType)).toEqual(expect.arrayContaining([
      'system_design',
      'business_rules',
      'project_glossary',
    ]))
    expect(calls.every((call) => call.provider === 'codex_cli')).toBe(true)
  })

  it('returns repair status for schema-invalid business docs submit through CLI', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const leased = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '1',
      '--json',
    ], { cwd: rootDir, db })
    expect(leased.exitCode).toBe(0)
    const task = leased.result.data?.tasks[0]
    const invalid = {
      schemaVersion: 'business-doc.v1',
      documentType: task.documentType,
      scope: task.scope,
      scopeId: task.scopeId,
      title: '',
      summary: '',
      content: {},
      evidenceIds: ['invented:evidence'],
    }

    const command = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--task',
      String(task.id),
      '--lease-token',
      String(task.leaseToken),
      '--attempt',
      String(task.attemptNo),
      '--document-json',
      JSON.stringify(invalid),
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        task: {
          id: task.id,
          status: 'repair_requested',
        },
        repair: {
          validationPageToken: 'validation_errors',
        },
        nextAction: {
          type: 'repair_task',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('reports lifecycle status for a started business docs run through CLI', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    const command = await runPlattyCommand([
      'business-docs',
      'status',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(JSON.parse(command.stdout)).toEqual(command.result)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        run: {
          id: started.result.data?.run.id,
          projectId,
          status: 'running',
          sourceCommit: 'unknown',
        },
        tasks: {
          activeLeases: 0,
          counts: {
            pending: 7,
            total: 7,
          },
        },
        nextAction: {
          type: 'lease_tasks',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('retries a repair-requested business docs task through CLI', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const leased = await runPlattyCommand([
      'business-docs',
      'tasks',
      'lease',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--worker',
      'codex-1',
      '--limit',
      '1',
      '--json',
    ], { cwd: rootDir, db })
    expect(leased.exitCode).toBe(0)
    const task = leased.result.data?.tasks[0]
    const invalid = {
      schemaVersion: 'business-doc.v1',
      documentType: task.documentType,
      scope: task.scope,
      scopeId: task.scopeId,
      title: '',
      summary: '',
      content: {},
      evidenceIds: ['invented:evidence'],
    }

    const submitted = await runPlattyCommand([
      'business-docs',
      'tasks',
      'submit',
      '--project',
      'Commerce',
      '--task',
      String(task.id),
      '--lease-token',
      String(task.leaseToken),
      '--attempt',
      String(task.attemptNo),
      '--document-json',
      JSON.stringify(invalid),
      '--json',
    ], { cwd: rootDir, db })
    expect(submitted.exitCode).toBe(0)

    const retry = await runPlattyCommand([
      'business-docs',
      'tasks',
      'retry',
      '--project',
      'Commerce',
      '--task',
      String(task.id),
      '--json',
    ], { cwd: rootDir, db })

    expect(retry.exitCode).toBe(0)
    expect(retry.result).toMatchObject({
      ok: true,
      data: {
        task: {
          id: task.id,
          status: 'pending',
          previousStatus: 'repair_requested',
        },
        run: {
          status: 'running',
        },
        nextAction: {
          type: 'lease_tasks',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('cancels a running business docs run through CLI', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    const command = await runPlattyCommand([
      'business-docs',
      'cancel',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        run: {
          id: started.result.data?.run.id,
          status: 'cancelled',
          finishedAt: expect.any(String),
        },
        cancelled: {
          pendingTasksBlocked: 7,
          contextRetained: true,
        },
        nextAction: {
          type: 'cancelled',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('cleans completed business docs context through CLI', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    seedBusinessDocsPreview(String(project.result.data?.id))
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    db.update(businessDocGenerationTasks)
      .set({ status: 'saved', updatedAt: now })
      .where(eq(businessDocGenerationTasks.runId, String(started.result.data?.run.id)))
      .run()
    const completed = await runPlattyCommand([
      'business-docs',
      'status',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--json',
    ], { cwd: rootDir, db })
    expect(completed.exitCode).toBe(0)

    const command = await runPlattyCommand([
      'business-docs',
      'cleanup',
      '--project',
      'Commerce',
      '--run',
      String(started.result.data?.run.id),
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        run: {
          id: started.result.data?.run.id,
          status: 'completed',
        },
        cleanup: {
          bundlesDeleted: 0,
          pagesDeleted: 0,
          contextRetained: false,
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('validates required fields for business docs lifecycle commands', async () => {
    await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })

    for (const command of ['status', 'resume', 'cancel', 'cleanup']) {
      const missingRun = await runPlattyCommand([
        'business-docs',
        command,
        '--project',
        'Commerce',
        '--json',
      ], { cwd: rootDir, db })
      expect(missingRun.exitCode).toBe(2)
      expect(missingRun.result).toMatchObject({
        ok: false,
        errors: [{ code: 'BUSINESS_DOCS_RUN_REQUIRED' }],
      })
    }

    const missingTask = await runPlattyCommand([
      'business-docs',
      'tasks',
      'retry',
      '--project',
      'Commerce',
      '--json',
    ], { cwd: rootDir, db })
    expect(missingTask.exitCode).toBe(2)
    expect(missingTask.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_TASK_REQUIRED' }],
    })
  })

  it('validates a business docs run with a JSON envelope', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const runId = String(started.result.data?.run.id)
    seedBusinessDocument(projectId, {
      id: 'business:orders-br',
      type: 'br',
      scopeId: 'epic:orders',
      sourceRunId: runId,
      withLinkedItem: true,
    })

    const command = await runPlattyCommand([
      'business-docs',
      'validate',
      '--project',
      'Commerce',
      '--run',
      runId,
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        run: { id: runId },
        summary: {
          fatalCount: expect.any(Number),
          warningCount: expect.any(Number),
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('reviews run coverage and item source links', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    const started = await runPlattyCommand(['business-docs', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })
    const runId = String(started.result.data?.run.id)
    seedBusinessDocument(projectId, {
      id: 'business:orders-design',
      type: 'design',
      scopeId: 'epic:orders',
      sourceRunId: runId,
      withLinkedItem: true,
    })

    const command = await runPlattyCommand([
      'business-docs',
      'review',
      '--project',
      'Commerce',
      '--run',
      runId,
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        run: { id: runId },
        documents: {
          activeDocumentCount: 1,
          byType: { design: 1 },
        },
        items: {
          total: 1,
          linkedToSource: 1,
          unlinked: 0,
        },
        coverage: {
          requiredEpicCount: 1,
          missingByEpic: expect.any(Array),
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('shows one generated business document with item source links', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    const documentId = seedBusinessDocument(projectId, {
      id: 'business:orders-show',
      type: 'design',
      scopeId: 'epic:orders',
      sourceRunId: 'run:manual',
      withLinkedItem: true,
    })

    const command = await runPlattyCommand([
      'business-docs',
      'document',
      'show',
      '--project',
      'Commerce',
      '--document',
      documentId,
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        document: {
          id: documentId,
          type: 'design',
          content: { type: 'design' },
        },
        items: [
          expect.objectContaining({
            content: { sourceRef: 'source_document_1' },
            sourceDocumentLinks: [
              expect.objectContaining({ documentId: 'doc:orders-api' }),
            ],
          }),
        ],
      },
      warnings: [],
      errors: [],
    })
  })

  it('previews business-docs sync with a JSON envelope and optional doc sync plan', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsSyncFixture(projectId)

    const command = await runPlattyCommand([
      'business-docs',
      'sync',
      'preview',
      '--project',
      'Commerce',
      '--doc-sync-plan-id',
      'plan:docs',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        docSyncPlanId: 'plan:docs',
        summary: expect.objectContaining({
          stale: 1,
        }),
      },
      warnings: [],
      errors: [],
    })
  })

  it('starts business-docs sync with a JSON envelope and sync mode', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsSyncFixture(projectId)

    const command = await runPlattyCommand([
      'business-docs',
      'sync',
      'start',
      '--project',
      'Commerce',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        mode: 'created',
        run: {
          status: 'running',
        },
        preview: {
          summary: expect.objectContaining({
            stale: 1,
          }),
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('shows stale freshness for a business document in one CLI read', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsSyncFixture(projectId)
    await runPlattyCommand(['business-docs', 'sync', 'start', '--project', 'Commerce', '--json'], { cwd: rootDir, db })

    const command = await runPlattyCommand([
      'business-docs',
      'document',
      'show',
      '--project',
      'Commerce',
      '--document',
      'doc:orders-br',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(0)
    expect(command.result).toMatchObject({
      ok: true,
      data: {
        document: {
          id: 'doc:orders-br',
          status: 'active',
          validity: 'stale',
          documentSourceHash: 'old-business-source',
          staticSnapshotId: 'snapshot:old',
        },
        freshness: {
          state: 'stale',
          reason: 'source_changed',
        },
      },
      warnings: [],
      errors: [],
    })
  })

  it('does not show technical documents through the business-docs document command', async () => {
    const project = await runPlattyCommand(['project', 'create', 'Commerce', '--json'], { cwd: rootDir, db })
    const projectId = String(project.result.data?.id)
    seedBusinessDocsPreview(projectId)
    db.insert(documents).values({
      id: 'doc:technical-show',
      projectId,
      type: 'screen_spec',
      track: 'technical',
      scope: 'screen_spec',
      scopeId: 'doc:technical-show',
      status: 'active',
      validity: 'fresh',
      summary: 'Technical screen spec',
      content: { id: 'doc:technical-show' },
      rawLlmOutput: '',
      updatedBy: 'system',
      updatedAt: now,
    }).run()

    const command = await runPlattyCommand([
      'business-docs',
      'document',
      'show',
      '--project',
      'Commerce',
      '--document',
      'doc:technical-show',
      '--json',
    ], { cwd: rootDir, db })

    expect(command.exitCode).toBe(2)
    expect(command.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_DOCUMENT_NOT_FOUND' }],
    })
  })

  it('returns structured errors for unknown nested business-docs commands', async () => {
    const unknownTasks = await runPlattyCommand(['business-docs', 'tasks', 'publish', '--json'], { cwd: rootDir, db })
    expect(unknownTasks.exitCode).toBe(2)
    expect(unknownTasks.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_UNKNOWN_COMMAND', message: 'Unknown business-docs command: tasks publish' }],
    })

    const unknownContext = await runPlattyCommand(['business-docs', 'context', 'publish', '--json'], { cwd: rootDir, db })
    expect(unknownContext.exitCode).toBe(2)
    expect(unknownContext.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_UNKNOWN_COMMAND', message: 'Unknown business-docs command: context publish' }],
    })
  })

  it('requires an explicit or current project before starting', async () => {
    const command = await runPlattyCommand(['business-docs', 'start', '--json'], { cwd: rootDir, db })

    expect(command.exitCode).toBe(2)
    expect(command.result).toMatchObject({
      ok: false,
      errors: [{ code: 'PROJECT_NOT_SELECTED', message: 'No Platty project is selected' }],
      nextAction: {
        type: 'select_project',
        command: ['platty', 'project', 'list'],
      },
    })
  })

  it('returns a structured error for unknown business-docs subcommands', async () => {
    const command = await runPlattyCommand(['business-docs', 'publish', '--json'], { cwd: rootDir, db })

    expect(command.exitCode).toBe(2)
    expect(command.result).toMatchObject({
      ok: false,
      errors: [{ code: 'BUSINESS_DOCS_UNKNOWN_COMMAND', message: 'Unknown business-docs command: publish' }],
    })
  })

  it('keeps business-docs CLI dispatch isolated from provider and legacy LLM modules', () => {
    const commandPath = join(process.cwd(), 'src/commands/business-docs.ts')
    expect(existsSync(commandPath)).toBe(true)
    const source = readFileSync(commandPath, 'utf8')

    expect(source).not.toMatch(/provider-readiness|model-registry|runProviderCommand/)
    expect(source).not.toMatch(/@\/cli\/commands\/provider|\.\/commands\/provider/)
    expect(source).not.toMatch(/@\/pipeline_modules\/(?:legacy_generation\/)?build_business_docs\/(?:index|builders|prompts|f\d|.*llm)/)
  })
})

function seedBusinessDocsPreview(projectId: string): void {
  db.insert(epics).values({
    id: 'epic:orders',
    projectId,
    name: 'Orders',
    abbr: 'ORD',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run()

  db.insert(documents).values({
    id: 'doc:orders-api',
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'api_spec',
    scopeId: 'doc:orders-api',
    status: 'active',
    validity: 'fresh',
    summary: 'Orders API',
    content: { id: 'doc:orders-api', title: 'Orders API' },
    rawLlmOutput: '',
    updatedBy: 'system',
    updatedAt: now,
  }).run()

  db.insert(epicDocumentLinks).values({
    epicId: 'epic:orders',
    documentId: 'doc:orders-api',
    documentType: 'api_spec',
    role: 'primary',
    reason: 'test link',
    confidence: 'high',
    createdAt: now,
  }).run()
}

function seedBusinessDocsSyncFixture(projectId: string): void {
  seedBusinessDocsPreview(projectId)
  db.update(documents)
    .set({
      documentSourceHash: 'api-source-v2',
      contentHash: 'api-content-v2',
      staticSnapshotId: 'snapshot:new',
    })
    .where(eq(documents.id, 'doc:orders-api'))
    .run()
  db.insert(staticMerkleSnapshots).values([
    {
      id: 'snapshot:old',
      projectId,
      snapshotKind: 'project',
      analysisBranch: 'main',
      sourceCommit: 'commit:old',
      repoCommitPinsJson: [],
      rootHash: 'old-root',
      hashSetJson: {},
      reasonInputsJson: {},
      createdAt: '2026-06-07T00:00:00.000Z',
    },
    {
      id: 'snapshot:new',
      projectId,
      snapshotKind: 'project',
      analysisBranch: 'main',
      sourceCommit: 'commit:new',
      repoCommitPinsJson: [],
      rootHash: 'new-root',
      hashSetJson: {},
      reasonInputsJson: {},
      createdAt: now,
    },
  ]).run()
  db.insert(docSyncPlans).values({
    id: 'plan:docs',
    projectId,
    fromSnapshotId: 'snapshot:old',
    toSnapshotId: 'snapshot:new',
    status: 'applied',
    countsJson: {},
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(docSyncCandidates).values({
    id: 'candidate:orders-api',
    planId: 'plan:docs',
    phase: 'technical',
    kind: 'stale',
    status: 'staged',
    targetJson: { track: 'technical', type: 'api_spec', scope: 'api_spec', scopeId: 'doc:orders-api' },
    oldHash: 'api-source-v1',
    newHash: 'api-source-v2',
    reasonInputsJson: {},
    decision: null,
    rationale: 'source changed',
    createdAt: now,
    updatedAt: now,
  }).run()
  seedBusinessDocument(projectId, {
    id: 'doc:orders-br',
    type: 'br',
    scopeId: 'epic:orders',
    documentSourceHash: 'old-business-source',
    staticSnapshotId: 'snapshot:old',
  })
}

function seedBusinessDocument(
  projectId: string,
  input: {
    id: string
    type: 'design' | 'data_dictionary' | 'br' | 'ucl' | 'ucs' | 'glossary'
    scopeId: string
    scope?: 'epic' | 'project'
    sourceRunId?: string
    documentSourceHash?: string
    staticSnapshotId?: string
    withLinkedItem?: boolean
  },
): string {
  db.insert(documents).values({
    id: input.id,
    projectId,
    type: input.type,
    track: 'business',
    scope: input.scope ?? 'epic',
    scopeId: input.scopeId,
    status: 'active',
    validity: 'fresh',
    summary: input.type,
    content: { type: input.type },
    rawLlmOutput: '',
    contentHash: `hash:${input.id}`,
    staticSnapshotId: input.staticSnapshotId,
    documentSourceHash: input.documentSourceHash,
    sourceRunId: input.sourceRunId,
    updatedBy: 'system',
    updatedAt: now,
  }).run()
  if (input.withLinkedItem) {
    const itemId = `${input.id}:item:1`
    db.insert(documentItems).values({
      id: itemId,
      documentId: input.id,
      projectId,
      itemType: `${input.type}_item`,
      stableKey: `${input.type}:item:1`,
      ordinal: 1,
      title: `${input.type} item`,
      summary: `${input.type} item summary`,
      content: { sourceRef: 'source_document_1' },
      contentHash: `hash:${itemId}`,
      status: 'active',
      createdBy: 'llm',
      updatedBy: 'llm',
      updatedAt: now,
    }).run()
    db.insert(documentItemDocumentLinks).values({
      fromItemId: itemId,
      toDocumentId: 'doc:orders-api',
      linkType: 'source_document',
      role: 'primary',
      createdBy: 'llm',
      createdAt: now,
    }).run()
  }
  return input.id
}

function documentForTask(
  task: {
    taskType: string
    documentType: string
    scope: 'epic' | 'project' | 'use_case'
    scopeId: string
  },
  evidenceIds: string[],
  contextPages: Array<{ page?: { content?: Record<string, unknown> } }> = [],
) {
  return {
    schemaVersion: 'business-doc.v1',
    documentType: task.documentType,
    scope: task.scope,
    scopeId: task.scopeId,
    title: `${task.taskType} title`,
    summary: `${task.taskType} summary`,
    content: {
      taskType: task.taskType,
      body: `${task.taskType} body`,
      // synthetic placeholder carries no source-backed core items — declare the gap so v3 (EMPTY_CORE_ITEMS) accepts it honestly
      evidence_gaps: ['synthetic CLI test document — no source-backed items'],
    },
    evidenceIds: evidenceIds.slice(0, 1),
    items: [
      {
        itemType: itemTypeForDocument(task.documentType),
        stableKey: `${task.taskType}:cli-submit`,
        ordinal: 1,
        title: `${task.taskType} item`,
        summary: `${task.taskType} item summary.`,
        content: itemContentForTask(task, contextPages),
        evidenceIds: evidenceIds.slice(0, 1),
      },
    ],
  }
}

function itemTypeForDocument(documentType: string): string {
  if (documentType === 'design') return 'design_component'
  if (documentType === 'data_dictionary') return 'data_entity'
  if (documentType === 'ucl') return 'use_case'
  if (documentType === 'ucs') return 'use_case_spec'
  if (documentType === 'glossary') return 'glossary_term'
  return 'business_rule'
}

function itemContentForTask(
  task: { taskType: string; documentType: string },
  contextPages: Array<{ page?: { content?: Record<string, unknown> } }>,
) {
  const sourceRefs = sourceRefsFromContextPages(contextPages)
  const clusterIds = clusterIdsFromContextPages(contextPages)
  const sourceMapping = [
    {
      sourceRef: sourceRefs[0] ?? 'source_document_1',
      role: 'primary',
      reason: 'CLI source evidence.',
    },
  ]
  if (task.documentType === 'design') {
    return {
      component: `${task.taskType} component`,
      responsibility: 'Persist source-backed business document decisions.',
      flow: ['Read source evidence.', 'Write a canonical business document.'],
      integration_points: ['Platty CLI submit'],
      source_mapping: sourceMapping,
      relationConfidence: 'direct_call_proven',
    }
  }
  if (task.documentType === 'data_dictionary') {
    return {
      entity: `${task.taskType} entity`,
      fields: [{ name: 'status', meaning: 'Document generation status.', source_mapping: sourceMapping }],
      states: ['pending', 'saved'],
    }
  }
  if (task.documentType === 'ucl') {
    return {
      name: `${task.taskType} use case`,
      goal: 'Generate source-backed business docs.',
      sourceClusterIds: clusterIds.length > 0 ? clusterIds : ['cluster:cli-submit'],
      coverageRelation: 'owned_by_epic',
      ownedByEpic: true,
      primarySourceRefs: sourceRefs.length > 0 ? sourceRefs.slice(0, 3) : ['source_document_1'],
      supportingSourceRefs: [],
      crossEpicSourceRefs: [],
      source_mapping: sourceMapping,
    }
  }
  if (task.documentType === 'ucs') {
    return {
      actor: 'CLI worker',
      trigger: 'A leased task is ready.',
      preconditions: ['A business docs run is active.'],
      main_success_flow: ['Read context.', 'Submit a source-backed document.'],
      alternatives: [],
      exceptions: [],
      business_rules: ['Submitted items must map to source evidence.'],
      source_mapping: sourceMapping,
      uncertainty: [],
    }
  }
  if (task.documentType === 'glossary') {
    return {
      term: `${task.taskType} term`,
      canonical_term: `${task.taskType} term`,
      definition: 'A source-backed term generated for CLI runner verification.',
      termType: 'process',
      aliases: [],
      synonyms: [],
      candidate_aliases: [],
      antonyms: [],
      contrast_terms: [],
      related_terms: [],
      signals: ['cli submit'],
      source_mapping: sourceMapping,
      ambiguity: { status: 'none', candidates: [] },
    }
  }
  return {
    earsPattern: 'event_driven',
    condition: 'When the CLI submits a business doc',
    rule: 'the system shall persist the submitted source-backed item',
    outcome: 'the document is saved with source links',
    ownership: 'owned_by_epic',
    source_mapping: sourceMapping,
  }
}

function evidenceIdsFromBundle(bundle: {
  pages?: Array<{ evidenceIds?: string[] }>
}): string[] {
  return bundle.pages?.flatMap((page) => page.evidenceIds ?? []) ?? []
}

function evidenceIdsFromContextPages(pages: Array<{ page?: { evidenceIds?: string[] } }>): string[] {
  return pages.flatMap((page) => page.page?.evidenceIds ?? [])
}

function sourceRefsFromContextPages(pages: Array<{ page?: { content?: Record<string, unknown> } }>): string[] {
  return uniqueStrings(pages.flatMap((page) => collectStringValues(page.page?.content, 'sourceRef')))
}

function clusterIdsFromContextPages(pages: Array<{ page?: { content?: Record<string, unknown> } }>): string[] {
  return uniqueStrings(pages.flatMap((page) => collectStringValues(page.page?.content, 'clusterId')))
}

function collectStringValues(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((entry) => collectStringValues(entry, key))
  const record = value as Record<string, unknown>
  return [
    ...(typeof record[key] === 'string' ? [record[key]] : []),
    ...Object.entries(record)
      .filter(([childKey]) => childKey !== key)
      .flatMap(([, child]) => collectStringValues(child, key)),
  ]
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}
