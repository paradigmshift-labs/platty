import { execFile, execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { migrateDb, openPlattyDb, schema, type DB } from '@platty/core'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const cliPath = resolve(repoRoot, 'packages/cli/dist/main.js')
const fixtureRoot = resolve(repoRoot, 'packages/cli/tests/fixtures/repo-topology-sync')

let workspace: string | null = null

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true })
  workspace = null
})

describe('repo topology sync CLI E2E', () => {
  it('keeps an existing EPIC when backend additions stay below restructure thresholds', async () => {
    const { env, projectId } = await prepareTopologyProject()

    withDb(env.PLATTY_HOME, (db) => {
      seedBackendAdditionDocSync(db, projectId, [['doc:users', 'route:users', 'POST /users', 'Create users.']])
    })

    const started = await runJson(['epics', 'sync', 'start', '--doc-sync-plan-id', 'plan:topology'], { cwd: workspace!, env })
    const task = await leaseOnlyTask(env, String(started.data.runId))
    await submitAssignments(env, task, [assignmentToExisting('doc:users', 'user_management')])

    const next = await runJson(['epics', 'sync', 'worker', 'next', '--run-id', String(started.data.runId), '--worker-id', 'worker:e2e'], { cwd: workspace!, env })
    expect(next.data).toMatchObject({
      type: 'task',
      task: {
        taskType: 'epic_sync_cross_links',
        targetKey: 'sync:cross_links:1',
      },
    })
  }, 30_000)

  it('routes overloaded existing EPICs to a split/merge restructure review task', async () => {
    const { env, projectId } = await prepareTopologyProject()

    withDb(env.PLATTY_HOME, (db) => {
      seedBackendAdditionDocSync(db, projectId)
    })

    const preview = await runJson(['epics', 'sync', 'preview', '--doc-sync-plan-id', 'plan:topology'], { cwd: workspace, env })
    expect(preview.data).toMatchObject({
      docSyncPlanId: 'plan:topology',
      counts: { new: 4, changed: 0, deleted: 0 },
    })

    const started = await runJson(['epics', 'sync', 'start', '--doc-sync-plan-id', 'plan:topology'], { cwd: workspace, env })
    const runId = String(started.data.runId)
    const task = await leaseOnlyTask(env, runId)
    await submitAssignments(env, task, ['doc:users', 'doc:roles', 'doc:permissions', 'doc:invitations']
      .map((documentId) => assignmentToExisting(documentId, 'user_management')))

    const next = await runJson(['epics', 'sync', 'worker', 'next', '--run-id', runId, '--worker-id', 'worker:e2e'], { cwd: workspace, env })
    expect(next.data).toMatchObject({
      type: 'task',
      task: {
        taskType: 'epic_sync_restructure',
        targetKey: 'sync:restructure:1',
      },
      agentInput: {
        context: {
          restructureReasons: [
            expect.objectContaining({ code: 'BACKEND_APIS_EXPAND_SINGLE_EPIC', epicStableKey: 'user_management' }),
          ],
        },
      },
    })
    expect(next.data.agentInput.context.impactedCards.map((card: { documentId: string }) => card.documentId).sort()).toEqual([
      'doc:invitations',
      'doc:permissions',
      'doc:roles',
      'doc:users',
    ])
    expect(JSON.stringify(next.data.agentInput.outputSchema)).toContain('split_epic')
    expect(JSON.stringify(next.data.agentInput.outputSchema)).toContain('merge_epics')

    const splitPath = join(workspace!, 'split-result.json')
    writeFileSync(splitPath, JSON.stringify({
      actions: [{
        type: 'split_epic',
        sourceEpicStableKey: 'user_management',
        newEpics: [
          {
            stableKey: 'user_profile_management',
            name: 'User Profile Management',
            abbr: 'UPM',
            summary: 'Manage user records and user profile operations.',
          },
          {
            stableKey: 'access_control_management',
            name: 'Access Control Management',
            abbr: 'ACM',
            summary: 'Manage roles, permissions, and invitations.',
          },
        ],
        moves: [
          {
            documentId: 'doc:existing-users',
            documentType: 'api_spec',
            fromEpicStableKey: 'user_management',
            toEpicStableKey: 'user_profile_management',
            role: 'owner',
            reason: 'Existing user listing stays with user profile management.',
          },
          {
            documentId: 'doc:users',
            documentType: 'api_spec',
            fromEpicStableKey: 'user_management',
            toEpicStableKey: 'user_profile_management',
            role: 'owner',
            reason: 'User creation belongs with user profile management.',
          },
          {
            documentId: 'doc:roles',
            documentType: 'api_spec',
            fromEpicStableKey: 'user_management',
            toEpicStableKey: 'access_control_management',
            role: 'owner',
            reason: 'Role creation belongs with access control.',
          },
          {
            documentId: 'doc:permissions',
            documentType: 'api_spec',
            fromEpicStableKey: 'user_management',
            toEpicStableKey: 'access_control_management',
            role: 'owner',
            reason: 'Permission creation belongs with access control.',
          },
          {
            documentId: 'doc:invitations',
            documentType: 'api_spec',
            fromEpicStableKey: 'user_management',
            toEpicStableKey: 'access_control_management',
            role: 'owner',
            reason: 'Invitations belong with access control onboarding.',
          },
        ],
        reason: 'Backend APIs reveal user profile and access control as separate capabilities.',
      }],
    }), 'utf8')
    await runJson([
      'epics',
      'sync',
      'tasks',
      'submit',
      '--task-id',
      next.data.task.taskId,
      '--lease-token',
      next.data.task.leaseToken,
      '--input',
      splitPath,
    ], { cwd: workspace!, env })

    const draft = await runJson(['epics', 'sync', 'draft', 'show', '--run-id', runId], { cwd: workspace!, env })
    expect(draft.data.plan.epics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stableKey: 'user_profile_management',
        status: 'needs_review',
        apiLinks: expect.arrayContaining([
          expect.objectContaining({ apiDocId: 'doc:existing-users' }),
          expect.objectContaining({ apiDocId: 'doc:users' }),
        ]),
      }),
      expect.objectContaining({
        stableKey: 'access_control_management',
        status: 'needs_review',
        apiLinks: expect.arrayContaining([
          expect.objectContaining({ apiDocId: 'doc:roles' }),
          expect.objectContaining({ apiDocId: 'doc:permissions' }),
          expect.objectContaining({ apiDocId: 'doc:invitations' }),
        ]),
      }),
    ]))
  }, 30_000)

  it('applies a merge restructure action and then continues to cross-link review', async () => {
    const { env, projectId } = await prepareTopologyProject()

    withDb(env.PLATTY_HOME, (db) => {
      seedExistingRoleEpic(db, projectId)
      seedBackendAdditionDocSync(db, projectId)
    })

    const started = await runJson(['epics', 'sync', 'start', '--doc-sync-plan-id', 'plan:topology'], { cwd: workspace!, env })
    const runId = String(started.data.runId)
    const task = await leaseOnlyTask(env, runId)
    await submitAssignments(env, task, ['doc:users', 'doc:roles', 'doc:permissions', 'doc:invitations']
      .map((documentId) => assignmentToExisting(documentId, 'user_management')))

    const restructure = await runJson(['epics', 'sync', 'worker', 'next', '--run-id', runId, '--worker-id', 'worker:e2e'], { cwd: workspace!, env })
    const mergePath = join(workspace!, 'merge-result.json')
    writeFileSync(mergePath, JSON.stringify({
      actions: [{
        type: 'merge_epics',
        sourceEpicStableKeys: ['user_management', 'role_management'],
        targetEpic: {
          stableKey: 'identity_access_management',
          name: 'Identity Access Management',
          abbr: 'IAM',
          summary: 'Manage users, roles, permissions, and invitations.',
        },
        moves: [
          moveToMerged('doc:existing-users', 'user_management'),
          moveToMerged('doc:legacy-roles', 'role_management'),
          moveToMerged('doc:users', 'user_management'),
          moveToMerged('doc:roles', 'user_management'),
          moveToMerged('doc:permissions', 'user_management'),
          moveToMerged('doc:invitations', 'user_management'),
        ],
        reason: 'Backend APIs show identity and access management are one operational capability.',
      }],
    }), 'utf8')
    await runJson([
      'epics',
      'sync',
      'tasks',
      'submit',
      '--task-id',
      restructure.data.task.taskId,
      '--lease-token',
      restructure.data.task.leaseToken,
      '--input',
      mergePath,
    ], { cwd: workspace!, env })

    const draft = await runJson(['epics', 'sync', 'draft', 'show', '--run-id', runId], { cwd: workspace!, env })
    expect(draft.data.plan.epics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stableKey: 'identity_access_management',
        status: 'needs_review',
        apiLinks: expect.arrayContaining([
          expect.objectContaining({ apiDocId: 'doc:existing-users' }),
          expect.objectContaining({ apiDocId: 'doc:legacy-roles' }),
          expect.objectContaining({ apiDocId: 'doc:users' }),
        ]),
      }),
    ]))

    const next = await runJson(['epics', 'sync', 'worker', 'next', '--run-id', runId, '--worker-id', 'worker:e2e'], { cwd: workspace!, env })
    expect(next.data.task.taskType).toBe('epic_sync_cross_links')
  }, 30_000)

  it('opens merge review when a newly added frontend screen spans multiple existing backend EPICs', async () => {
    const { env, projectId } = await prepareTopologyProject()

    withDb(env.PLATTY_HOME, (db) => {
      seedExistingBackendEpics(db, projectId)
      seedFrontendScreenDocSync(db, projectId)
      seedFrontendScreenServiceMap(db, projectId)
    })

    const started = await runJson(['epics', 'sync', 'start', '--doc-sync-plan-id', 'plan:topology'], { cwd: workspace!, env })
    const runId = String(started.data.runId)
    const task = await leaseOnlyTask(env, runId)
    await submitAssignments(env, task, [{
      documentId: 'doc:admin-console-screen',
      documentType: 'screen_spec',
      action: 'assign_existing',
      epicStableKey: 'users',
      role: 'primary',
      confidence: 'medium',
      reason: 'Admin console starts from user administration but spans related access APIs.',
      newEpic: null,
    }])

    const next = await runJson(['epics', 'sync', 'worker', 'next', '--run-id', runId, '--worker-id', 'worker:e2e'], { cwd: workspace!, env })
    expect(next.data).toMatchObject({
      task: { taskType: 'epic_sync_restructure' },
      agentInput: {
        context: {
          restructureReasons: [
            expect.objectContaining({
              code: 'FRONTEND_SCREEN_SPANS_MULTIPLE_EPICS',
              documentId: 'doc:admin-console-screen',
              connectedEpicStableKeys: ['permissions', 'roles', 'users'],
            }),
          ],
          topologyLinks: expect.arrayContaining([
            expect.objectContaining({ sourceDocumentId: 'doc:admin-console-screen', targetDocumentId: 'doc:users-api' }),
            expect.objectContaining({ sourceDocumentId: 'doc:admin-console-screen', targetDocumentId: 'doc:roles-api' }),
            expect.objectContaining({ sourceDocumentId: 'doc:admin-console-screen', targetDocumentId: 'doc:permissions-api' }),
          ]),
        },
      },
    })
  }, 30_000)

  it('allows a restructure worker to choose no_change and then proceeds to cross-link review', async () => {
    const { env, projectId } = await prepareTopologyProject()

    withDb(env.PLATTY_HOME, (db) => {
      seedBackendAdditionDocSync(db, projectId)
    })

    const started = await runJson(['epics', 'sync', 'start', '--doc-sync-plan-id', 'plan:topology'], { cwd: workspace!, env })
    const runId = String(started.data.runId)
    const task = await leaseOnlyTask(env, runId)
    await submitAssignments(env, task, ['doc:users', 'doc:roles', 'doc:permissions', 'doc:invitations']
      .map((documentId) => assignmentToExisting(documentId, 'user_management')))

    const restructure = await runJson(['epics', 'sync', 'worker', 'next', '--run-id', runId, '--worker-id', 'worker:e2e'], { cwd: workspace!, env })
    const noChangePath = join(workspace!, 'no-change-result.json')
    writeFileSync(noChangePath, JSON.stringify({
      actions: [{ type: 'no_change', reason: 'The current EPIC remains coherent after review.' }],
    }), 'utf8')
    await runJson([
      'epics',
      'sync',
      'tasks',
      'submit',
      '--task-id',
      restructure.data.task.taskId,
      '--lease-token',
      restructure.data.task.leaseToken,
      '--input',
      noChangePath,
    ], { cwd: workspace!, env })

    const next = await runJson(['epics', 'sync', 'worker', 'next', '--run-id', runId, '--worker-id', 'worker:e2e'], { cwd: workspace!, env })
    expect(next.data.task.taskType).toBe('epic_sync_cross_links')
  }, 30_000)
})

async function prepareTopologyProject(): Promise<{ env: NodeJS.ProcessEnv; projectId: string }> {
  workspace = mkdtempSync(join(tmpdir(), 'platty-repo-topology-sync-'))
  const frontendRepo = copyFixtureRepo('frontend')
  const backendRepo = copyFixtureRepo('backend')
  const env = { ...process.env, PLATTY_HOME: join(workspace, '.platty') }

  await runJson(['init'], { cwd: workspace, env })
  const project = await runJson(['project', 'create', 'topology-beta'], { cwd: workspace, env })
  const projectId = String(project.data.id)
  await runJson(['project', 'use', projectId], { cwd: workspace, env })
  await runJson(['repo', 'add', frontendRepo, '--name', 'frontend'], { cwd: workspace, env })

  withDb(env.PLATTY_HOME, (db) => {
    seedExistingFrontendDocsAndEpic(db, projectId)
  })

  await runJson(['repo', 'add', backendRepo, '--name', 'backend'], { cwd: workspace, env })

  withDb(env.PLATTY_HOME, (db) => {
    expect(db.select().from(schema.documents).where(eq(schema.documents.id, 'doc:user-admin-screen')).get())
      .toMatchObject({ validity: 'fresh' })
  })

  return { env, projectId }
}

async function leaseOnlyTask(env: NodeJS.ProcessEnv, runId: string): Promise<{ taskId: string; leaseToken: string }> {
  const lease = await runJson(['epics', 'sync', 'tasks', 'lease', '--run-id', runId, '--limit', '1', '--worker-id', 'worker:e2e'], { cwd: workspace!, env })
  return lease.data.leasedTasks[0] as { taskId: string; leaseToken: string }
}

async function submitAssignments(
  env: NodeJS.ProcessEnv,
  task: { taskId: string; leaseToken: string },
  assignments: unknown[],
): Promise<void> {
  const resultPath = join(workspace!, 'assignment-result.json')
  writeFileSync(resultPath, JSON.stringify({ assignments }), 'utf8')
  await runJson([
    'epics',
    'sync',
    'tasks',
    'submit',
    '--task-id',
    task.taskId,
    '--lease-token',
    task.leaseToken,
    '--input',
    resultPath,
  ], { cwd: workspace!, env })
}

function assignmentToExisting(documentId: string, epicStableKey: string) {
  return {
    documentId,
    documentType: 'api_spec',
    action: 'assign_existing',
    epicStableKey,
    role: 'owner',
    confidence: 'high',
    reason: `${documentId} extends the existing ${epicStableKey} capability.`,
    newEpic: null,
  }
}

function moveToMerged(documentId: string, fromEpicStableKey: string) {
  return {
    documentId,
    documentType: 'api_spec',
    fromEpicStableKey,
    toEpicStableKey: 'identity_access_management',
    role: 'owner',
    reason: `${documentId} belongs in the merged identity access management EPIC.`,
  }
}

function copyFixtureRepo(name: 'frontend' | 'backend'): string {
  if (!workspace) throw new Error('workspace not initialized')
  const target = join(workspace, name)
  cpSync(join(fixtureRoot, name), target, { recursive: true })
  initGitRepo(target)
  return target
}

function initGitRepo(path: string): void {
  execFileSync('git', ['init', '-q'], { cwd: path })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: path })
  execFileSync('git', ['add', '.'], { cwd: path })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: path })
}

function runJson(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ ok: boolean; data: any; warnings: unknown[]; errors: unknown[] }> {
  const finalArgs = [cliPath, ...args, '--json']
  return new Promise((resolvePromise, reject) => {
    execFile(process.execPath, finalArgs, {
      cwd: options.cwd,
      env: options.env,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 10,
    }, (error, stdout, stderr) => {
      let parsed: any = null
      try {
        parsed = JSON.parse(stdout)
      } catch (parseError) {
        reject(new Error(`Could not parse CLI JSON for ${args.join(' ')}: ${parseError instanceof Error ? parseError.message : String(parseError)}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
        return
      }
      if (error || parsed.ok === false) {
        reject(new Error(`CLI failed for ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
        return
      }
      resolvePromise(parsed)
    })
  })
}

function withDb(plattyHome: string, fn: (db: DB) => void): void {
  mkdirSync(plattyHome, { recursive: true })
  const opened = openPlattyDb({ databasePath: join(plattyHome, 'platty.db') })
  try {
    migrateDb(opened.db)
    fn(opened.db)
  } finally {
    opened.close()
  }
}

function seedExistingFrontendDocsAndEpic(db: DB, projectId: string): void {
  const now = '2026-06-11T00:00:00.000Z'
  db.insert(schema.documents).values([
    screenDoc(projectId, 'doc:user-admin-screen', 'screen:user-admin', 'User admin screen'),
    screenDoc(projectId, 'doc:user-profile-screen', 'screen:user-profile', 'User profile screen'),
    apiDoc(projectId, 'doc:existing-users', 'route:existing-users', 'GET /users', 'Lists users.'),
  ]).run()
  db.insert(schema.epics).values({
    id: 'epic:user-management',
    projectId,
    name: 'User Management',
    abbr: 'USR',
    description: 'User administration and profile management.',
    stableKey: 'user_management',
    summary: 'User administration and profile management.',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(schema.epicDocumentLinks).values([
    {
      epicId: 'epic:user-management',
      documentId: 'doc:existing-users',
      documentType: 'api_spec',
      role: 'owner',
      reason: 'Existing user API owns user management.',
      confidence: 'high',
      createdAt: now,
    },
    {
      epicId: 'epic:user-management',
      documentId: 'doc:user-admin-screen',
      documentType: 'screen_spec',
      role: 'primary',
      reason: 'Admin screen drives user management.',
      confidence: 'high',
      createdAt: now,
    },
  ]).run()
}

function seedBackendAdditionDocSync(
  db: DB,
  projectId: string,
  docs: ReadonlyArray<readonly [string, string, string, string]> = [
    ['doc:users', 'route:users', 'POST /users', 'Create users.'],
    ['doc:roles', 'route:roles', 'POST /roles', 'Create roles.'],
    ['doc:permissions', 'route:permissions', 'POST /permissions', 'Create permissions.'],
    ['doc:invitations', 'route:invitations', 'POST /invitations', 'Create invitations.'],
  ],
): void {
  db.insert(schema.documents).values(docs.map(([id, scopeId, title, summary]) => apiDoc(projectId, id, scopeId, title, summary))).run()
  db.insert(schema.docSyncPlans).values({
    id: 'plan:topology',
    projectId,
    toSnapshotId: 'snap:topology-backend',
    status: 'applied',
  }).run()
  db.insert(schema.docSyncCandidates).values(docs.map(([id, scopeId]) => ({
    id: `cand:${id}`,
    planId: 'plan:topology',
    phase: 'technical' as const,
    kind: 'new_document' as const,
    status: 'staged' as const,
    targetJson: { track: 'technical', type: 'api_spec', scope: 'route', scopeId },
    oldHash: null,
    newHash: `hash:${id}`,
    reasonInputsJson: {},
  }))).run()
}

function seedExistingRoleEpic(db: DB, projectId: string): void {
  const now = '2026-06-11T00:00:00.000Z'
  db.insert(schema.documents).values(apiDoc(projectId, 'doc:legacy-roles', 'route:legacy-roles', 'GET /roles', 'Lists legacy roles.')).run()
  db.insert(schema.epics).values({
    id: 'epic:role-management',
    projectId,
    name: 'Role Management',
    abbr: 'ROL',
    description: 'Role administration.',
    stableKey: 'role_management',
    summary: 'Role administration.',
    status: 'confirmed',
    source: 'build_epics',
    confidence: 'high',
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(schema.epicDocumentLinks).values({
    epicId: 'epic:role-management',
    documentId: 'doc:legacy-roles',
    documentType: 'api_spec',
    role: 'owner',
    reason: 'Legacy role API owns role management.',
    confidence: 'high',
    createdAt: now,
  }).run()
}

function seedExistingBackendEpics(db: DB, projectId: string): void {
  const now = '2026-06-11T00:00:00.000Z'
  const docs = [
    ['doc:users-api', 'route:users', 'POST /users', 'Create users.', 'users', 'Users', 'USR'],
    ['doc:roles-api', 'route:roles', 'POST /roles', 'Create roles.', 'roles', 'Roles', 'ROL'],
    ['doc:permissions-api', 'route:permissions', 'POST /permissions', 'Create permissions.', 'permissions', 'Permissions', 'PER'],
  ] as const
  db.insert(schema.documents).values(docs.map(([id, scopeId, title, summary]) => apiDoc(projectId, id, scopeId, title, summary))).run()
  db.insert(schema.epics).values(docs.map(([, , , summary, stableKey, name, abbr]) => ({
    id: `epic:${stableKey}`,
    projectId,
    name,
    abbr,
    description: summary,
    stableKey,
    summary,
    status: 'confirmed' as const,
    source: 'build_epics' as const,
    confidence: 'high' as const,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  }))).run()
  db.insert(schema.epicDocumentLinks).values(docs.map(([id, , , , stableKey]) => ({
    epicId: `epic:${stableKey}`,
    documentId: id,
    documentType: 'api_spec' as const,
    role: 'owner',
    reason: `${stableKey} owner API.`,
    confidence: 'high' as const,
    createdAt: now,
  }))).run()
}

function seedFrontendScreenDocSync(db: DB, projectId: string): void {
  db.insert(schema.documents).values(screenDoc(projectId, 'doc:admin-console-screen', 'screen:admin-console', 'Admin console screen')).run()
  db.insert(schema.docSyncPlans).values({
    id: 'plan:topology',
    projectId,
    toSnapshotId: 'snap:frontend-added',
    status: 'applied',
  }).run()
  db.insert(schema.docSyncCandidates).values({
    id: 'cand:admin-console-screen',
    planId: 'plan:topology',
    phase: 'technical',
    kind: 'new_document',
    status: 'staged',
    targetJson: { track: 'technical', type: 'screen_spec', scope: 'screen', scopeId: 'screen:admin-console' },
    oldHash: null,
    newHash: 'hash:admin-console-screen',
    reasonInputsJson: {},
  }).run()
}

function seedFrontendScreenServiceMap(db: DB, projectId: string): void {
  const repos = db.select().from(schema.repositories).all()
  const frontendRepoId = repos.find((repo) => repo.name === 'frontend')?.id
  const backendRepoId = repos.find((repo) => repo.name === 'backend')?.id
  if (!frontendRepoId || !backendRepoId) throw new Error('expected frontend/backend repos')
  db.insert(schema.serviceMapEdges).values([
    serviceMapCall(projectId, frontendRepoId, backendRepoId, 'users', 'route:users', 'POST /users'),
    serviceMapCall(projectId, frontendRepoId, backendRepoId, 'roles', 'route:roles', 'POST /roles'),
    serviceMapCall(projectId, frontendRepoId, backendRepoId, 'permissions', 'route:permissions', 'POST /permissions'),
  ]).run()
}

function serviceMapCall(
  projectId: string,
  frontendRepoId: string,
  backendRepoId: string,
  key: string,
  targetId: string,
  canonicalTarget: string,
) {
  return {
    id: `service-edge:admin-console:${key}`,
    projectId,
    repoId: frontendRepoId,
    sourceRepoId: frontendRepoId,
    targetRepoId: backendRepoId,
    runId: 'run:service-map:e2e',
    sourceType: 'screen' as const,
    sourceId: 'screen:admin-console',
    targetType: 'api' as const,
    targetId,
    kind: 'calls_api' as const,
    canonicalTarget,
    confidence: 'high' as const,
    source: 'deterministic' as const,
    evidence: { document_ids: ['doc:admin-console-screen'] },
  }
}

function screenDoc(projectId: string, id: string, scopeId: string, summary: string) {
  return {
    id,
    projectId,
    type: 'screen_spec',
    track: 'technical',
    scope: 'screen',
    scopeId,
    status: 'passed',
    validity: 'fresh',
    summary,
    content: {
      title: summary,
      summary,
      identity: { routePath: `/${scopeId.replace('screen:', '')}` },
      relation_evidence_checked: true,
    },
    rawLlmOutput: '{}',
    documentSourceHash: `hash:${id}:v1`,
    staticSnapshotId: 'snap:frontend',
  }
}

function apiDoc(projectId: string, id: string, scopeId: string, title: string, summary: string) {
  return {
    id,
    projectId,
    type: 'api_spec',
    track: 'technical',
    scope: 'route',
    scopeId,
    status: 'passed',
    validity: 'fresh',
    summary,
    content: {
      title,
      summary,
      identity: { method: 'POST', path: scopeId.replace('route:', '/') },
      relation_evidence_checked: true,
    },
    rawLlmOutput: '{}',
    documentSourceHash: `hash:${id}:v1`,
    staticSnapshotId: 'snap:frontend',
  }
}
