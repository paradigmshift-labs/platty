import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as schema from '@/db/schema/index.js'
import type { DB } from '@/db/client.js'
import { getMigrationsPath } from '@/db/paths.js'
import { projects, repositories, projectPhaseStatus, repositoryPhaseStatus, type Repository } from '@/db/schema/core.js'
import { codeEdges, codeNodes, fileCache } from '@/db/schema/code_graph.js'
import { entryPoints, codeBundles, frameworkDetections } from '@/db/schema/build_route.js'
import { models } from '@/db/schema/build_models.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import { serviceMapEdges, serviceMapNodes } from '@/db/schema/build_service_map.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import { staticMerkleSnapshots, syncStaticMapRuns, type StaticMapRunStatus } from '@/db/schema/sync.js'
import { getHeadCommit } from '@/pipeline_modules/build_graph/git_helpers.js'
import { runBuildGraph } from '@/pipeline_modules/build_graph/index.js'
import { runBuildModels } from '@/pipeline_modules/build_models/index.js'
import { runBuildRoute } from '@/pipeline_modules/build_route/index.js'
import { runBuildRelations } from '@/pipeline_modules/build_relations/index.js'
import { runBuildServiceMap } from '@/pipeline_modules/build_service_map/index.js'
import { hashValue } from './hash.js'

export type SyncDb = DB
type SyncTx = Parameters<Parameters<SyncDb['transaction']>[0]>[0]

export interface StaticMapRepoPin {
  repoId: string
  analysisBranch: string
  sourceCommit: string
  analysisWorktreePath: string
}

export interface StaticMapSnapshotInput {
  rootHash: string
  hashSet: Record<string, unknown>
  reasonInputs: Record<string, unknown>
}

export interface StaticMapStageContext {
  db: SyncDb
  stagingDb: SyncDb
  projectId: string
  runId: string
  stagingDbPath: string
  repoPins: StaticMapRepoPin[]
}

export interface StaticMapRepoStageContext extends StaticMapStageContext {
  repo: Repository
  repoPin: StaticMapRepoPin
}

export interface StaticMapApplyContext extends StaticMapStageContext {
  tx: SyncTx
  snapshotId: string
  snapshot: StaticMapSnapshotInput
}

export interface StaticMapHooks {
  getRepoPin?: (repo: Repository) => Promise<string | null> | string | null
  initializeStagingDb?: (context: StaticMapStageContext) => Promise<void> | void
  runBuildGraph?: (context: StaticMapRepoStageContext) => Promise<void> | void
  runBuildModels?: (context: StaticMapRepoStageContext) => Promise<void> | void
  runBuildRoute?: (context: StaticMapRepoStageContext) => Promise<void> | void
  runBuildRelations?: (context: StaticMapRepoStageContext) => Promise<void> | void
  runBuildServiceMap?: (context: StaticMapRepoStageContext) => Promise<void> | void
  buildMerkleSnapshot?: (context: StaticMapStageContext) => Promise<StaticMapSnapshotInput> | StaticMapSnapshotInput
  applyCanonicalStaticMap?: (context: StaticMapApplyContext) => void
}

export interface SyncStaticMapInput {
  db: SyncDb
  projectId: string
  stagingRoot: string
  keepStagingDb?: boolean
  hooks?: StaticMapHooks
}

export interface SyncStaticMapResult {
  runId: string
  projectId: string
  status: 'applied'
  snapshotId: string
  stagingDbPath: string
}

export class SyncStaticMapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SyncStaticMapError'
  }
}

const ACTIVE_STATUSES: StaticMapRunStatus[] = ['pending', 'running', 'validating', 'applying']
const STATIC_REPO_PHASES = ['build_graph', 'build_models', 'build_route', 'build_relations'] as const
const STATIC_PROJECT_PHASES = ['build_service_map'] as const

export async function syncStaticMap(input: SyncStaticMapInput): Promise<SyncStaticMapResult> {
  const repos = input.db.select()
    .from(repositories)
    .where(and(eq(repositories.projectId, input.projectId), isNull(repositories.deletedAt)))
    .all()
  const missingRepo = repos.find((repo) => !repo.analysisBranch || !repo.analysisWorktreePath)
  if (missingRepo) {
    throw new SyncStaticMapError(
      'SYNC_STATIC_MAP_REPO_NOT_READY',
      `Repository ${missingRepo.id} must have analysisBranch and analysisWorktreePath before sync_static_map.`,
    )
  }
  if (repos.length === 0) {
    throw new SyncStaticMapError('SYNC_STATIC_MAP_REPO_NOT_READY', `Project ${input.projectId} has no repositories.`)
  }

  const activeRun = input.db
    .select()
    .from(syncStaticMapRuns)
    .where(eq(syncStaticMapRuns.projectId, input.projectId))
    .all()
    .find((run) => ACTIVE_STATUSES.includes(run.status))
  if (activeRun) {
    throw new SyncStaticMapError('SYNC_STATIC_MAP_ACTIVE_RUN_EXISTS', `Project ${input.projectId} already has an active static-map run.`)
  }

  mkdirSync(input.stagingRoot, { recursive: true })
  const runId = `static_map_run:${nanoid()}`
  const snapshotId = `static_merkle:${nanoid()}`
  const stagingDbPath = join(input.stagingRoot, `${runId.replace(/[^a-zA-Z0-9_-]/g, '_')}.sqlite`)
  let stagingSqlite: Database.Database | null = null

  input.db.insert(syncStaticMapRuns).values({
    id: runId,
    projectId: input.projectId,
    status: 'pending',
    currentStep: 'created',
    stagingDbPath,
  }).run()

  try {
    patchRun(input.db, runId, { status: 'running', currentStep: 'capture_repo_pins' })
    const repoPins = await captureRepoPins(repos, input.hooks)
    patchRun(input.db, runId, { repoPinsJson: repoPins.map(repoPinToJson), currentStep: 'initialize_staging_db' })
    const staging = openStagingDb(stagingDbPath)
    stagingSqlite = staging.sqlite

    const context: StaticMapStageContext = {
      db: input.db,
      stagingDb: staging.db,
      projectId: input.projectId,
      runId,
      stagingDbPath,
      repoPins,
    }

    initializeDefaultStagingDb(context, repos)
    await input.hooks?.initializeStagingDb?.(context)
    await runRepoStage('build_graph', repos, repoPins, context, input.hooks?.runBuildGraph ?? runBuildGraphForStaticMap)
    await runRepoStage('build_models', repos, repoPins, context, input.hooks?.runBuildModels ?? runBuildModelsForStaticMap)
    await runRepoStage('build_route', repos, repoPins, context, input.hooks?.runBuildRoute ?? runBuildRouteForStaticMap)
    await runRepoStage('build_relations', repos, repoPins, context, input.hooks?.runBuildRelations ?? runBuildRelationsForStaticMap)
    await runRepoStage('build_service_map', repos, repoPins, context, input.hooks?.runBuildServiceMap ?? runBuildServiceMapForStaticMap)

    patchRun(input.db, runId, { status: 'validating', currentStep: 'build_merkle_snapshot' })
    const snapshot = await buildSnapshot(context, input.hooks)

    patchRun(input.db, runId, { status: 'applying', currentStep: 'apply_canonical_static_map' })
    input.db.transaction((tx) => {
      const applyContext: StaticMapApplyContext = {
        ...context,
        tx,
        snapshotId,
        snapshot,
      }
      ;(input.hooks?.applyCanonicalStaticMap ?? applyCanonicalStaticMapFromStaging)(applyContext)
      tx.insert(staticMerkleSnapshots).values({
        id: snapshotId,
        projectId: input.projectId,
        snapshotKind: 'project',
        analysisBranch: null,
        sourceCommit: null,
        repoCommitPinsJson: repoPins.map(repoPinToJson),
        rootHash: snapshot.rootHash,
        hashSetJson: snapshot.hashSet,
        reasonInputsJson: snapshot.reasonInputs,
        createdByRunId: runId,
      }).run()
      tx.update(syncStaticMapRuns)
        .set({
          status: 'applied',
          currentStep: 'applied',
          snapshotId,
          updatedAt: now(),
        })
        .where(eq(syncStaticMapRuns.id, runId))
        .run()
    })

    stagingSqlite.close()
    stagingSqlite = null
    if (!input.keepStagingDb) {
      deleteStagingDbFiles(stagingDbPath)
    }

    return {
      runId,
      projectId: input.projectId,
      status: 'applied',
      snapshotId,
      stagingDbPath,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    patchRun(input.db, runId, {
      status: 'failed',
      currentStep: 'failed',
      errorMessage: message,
    })
    throw new SyncStaticMapError(
      error instanceof SyncStaticMapError ? error.code : 'SYNC_STATIC_MAP_APPLY_FAILED',
      message,
    )
  } finally {
    if (stagingSqlite?.open) stagingSqlite.close()
  }
}

async function captureRepoPins(repos: Repository[], hooks?: StaticMapHooks): Promise<StaticMapRepoPin[]> {
  const pins: StaticMapRepoPin[] = []
  for (const repo of repos) {
    const sourceCommit = hooks?.getRepoPin
      ? await hooks.getRepoPin(repo)
      : getHeadCommit(repo.analysisWorktreePath ?? '')
    if (!sourceCommit) {
      throw new SyncStaticMapError('SYNC_STATIC_MAP_REPO_PIN_FAILED', `Could not capture source commit for repository ${repo.id}.`)
    }
    pins.push({
      repoId: repo.id,
      analysisBranch: repo.analysisBranch ?? '',
      sourceCommit,
      analysisWorktreePath: repo.analysisWorktreePath ?? '',
    })
  }
  return pins
}

async function runRepoStage(
  step: string,
  repos: Repository[],
  repoPins: StaticMapRepoPin[],
  context: StaticMapStageContext,
  hook: ((context: StaticMapRepoStageContext) => Promise<void> | void) | undefined,
): Promise<void> {
  patchRun(context.db, context.runId, { currentStep: step })
  for (const repo of repos) {
    const repoPin = repoPins.find((pin) => pin.repoId === repo.id)
    if (!repoPin) throw new SyncStaticMapError('SYNC_STATIC_MAP_REPO_PIN_FAILED', `Missing repo pin for repository ${repo.id}.`)
    await hook?.({ ...context, repo, repoPin })
  }
}

async function buildSnapshot(context: StaticMapStageContext, hooks?: StaticMapHooks): Promise<StaticMapSnapshotInput> {
  if (hooks?.buildMerkleSnapshot) return hooks.buildMerkleSnapshot(context)
  const snapshot = buildDefaultMerkleSnapshot(context)
  return snapshot
}

function openStagingDb(path: string): { sqlite: Database.Database; db: SyncDb } {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: getMigrationsPath() })
  return { sqlite, db }
}

function initializeDefaultStagingDb(context: StaticMapStageContext, repos: Repository[]): void {
  const project = context.db.select().from(projects).where(eq(projects.id, context.projectId)).get()
  if (project) context.stagingDb.insert(projects).values(project).run()
  context.stagingDb.insert(pipelineRuns).values({
    id: context.runId,
    projectId: context.projectId,
    repoId: null,
    kind: 'sync',
    status: 'running',
    triggeredBy: 'sync_auto',
    totalSteps: 5,
    completedSteps: 0,
  }).run()
  for (const repo of repos) {
    const repoPin = context.repoPins.find((pin) => pin.repoId === repo.id)
    context.stagingDb.insert(repositories).values({
      ...repo,
      lastSyncedCommit: repoPin?.sourceCommit ?? repo.lastSyncedCommit,
    }).run()
  }
  const repoIds = repos.map((repo) => repo.id)
  if (repoIds.length > 0) {
    const repoStatuses = context.db
      .select()
      .from(repositoryPhaseStatus)
      .where(inArray(repositoryPhaseStatus.repositoryId, repoIds))
      .all()
    insertRows(context.stagingDb, repositoryPhaseStatus, repoStatuses)
  }
  const projectStatuses = context.db
    .select()
    .from(projectPhaseStatus)
    .where(eq(projectPhaseStatus.projectId, context.projectId))
    .all()
  insertRows(context.stagingDb, projectPhaseStatus, projectStatuses)
}

async function runBuildGraphForStaticMap(context: StaticMapRepoStageContext): Promise<void> {
  await runBuildGraph({ repoId: context.repo.id, parentRunId: context.runId, triggeredBy: 'sync_auto' }, context.stagingDb).completion
}

async function runBuildModelsForStaticMap(context: StaticMapRepoStageContext): Promise<void> {
  await runBuildModels({ repoId: context.repo.id, db: context.stagingDb, parentRunId: context.runId })
}

async function runBuildRouteForStaticMap(context: StaticMapRepoStageContext): Promise<void> {
  await runBuildRoute({
    db: context.stagingDb,
    repoId: context.repo.id,
    parentRunId: context.runId,
  })
}

async function runBuildRelationsForStaticMap(context: StaticMapRepoStageContext): Promise<void> {
  await runBuildRelations({ db: context.stagingDb, repoId: context.repo.id, parentRunId: context.runId })
}

async function runBuildServiceMapForStaticMap(context: StaticMapRepoStageContext): Promise<void> {
  // Run project-scoped (no repoId). build_service_map is a project-level phase; passing repoId routes
  // its phase-status write to repository_phase_status and leaves project_phase_status.build_service_map
  // at the stale value seeded from canonical. Since build_relations is freshly rebuilt (newer built_at),
  // the project service-map phase then looks older than its upstream, so `docs start` fails its freshness
  // precondition until a manual `platty run`. Writing the project phase here keeps the normal
  // run → sync static-map → docs flow working without that extra step. The service-map content is
  // project-wide either way; only the phase-status target changes.
  await runBuildServiceMap({
    db: context.stagingDb,
    projectId: context.projectId,
    parentRunId: context.runId,
    opts: { includeDocumentFacts: false },
  })
}

function applyCanonicalStaticMapFromStaging(context: StaticMapApplyContext): void {
  const repoIds = context.repoPins.map((pin) => pin.repoId)
  if (repoIds.length === 0) return

  const existingEntryPointIds = context.tx
    .select({ id: entryPoints.id })
    .from(entryPoints)
    .where(inArray(entryPoints.repoId, repoIds))
    .all()
    .map((row) => row.id)
  if (existingEntryPointIds.length > 0) {
    context.tx.delete(codeBundles).where(inArray(codeBundles.entryPointId, existingEntryPointIds)).run()
  }

  context.tx.delete(serviceMapEdges).where(eq(serviceMapEdges.projectId, context.projectId)).run()
  context.tx.delete(serviceMapNodes).where(eq(serviceMapNodes.projectId, context.projectId)).run()
  context.tx.delete(codeRelations).where(inArray(codeRelations.repoId, repoIds)).run()
  context.tx.delete(frameworkDetections).where(inArray(frameworkDetections.repoId, repoIds)).run()
  context.tx.delete(entryPoints).where(inArray(entryPoints.repoId, repoIds)).run()
  context.tx.delete(models).where(inArray(models.repositoryId, repoIds)).run()
  context.tx.delete(codeEdges).where(inArray(codeEdges.repoId, repoIds)).run()
  context.tx.delete(codeNodes).where(inArray(codeNodes.repoId, repoIds)).run()
  context.tx.delete(fileCache).where(inArray(fileCache.repoId, repoIds)).run()
  context.tx.delete(repositoryPhaseStatus).where(and(
    inArray(repositoryPhaseStatus.repositoryId, repoIds),
    inArray(repositoryPhaseStatus.phase, [...STATIC_REPO_PHASES]),
  )).run()
  context.tx.delete(projectPhaseStatus).where(and(
    eq(projectPhaseStatus.projectId, context.projectId),
    inArray(projectPhaseStatus.phase, [...STATIC_PROJECT_PHASES]),
  )).run()

  copyRows(context, fileCache, context.stagingDb.select().from(fileCache).where(inArray(fileCache.repoId, repoIds)).all())
  copyRows(context, codeNodes, context.stagingDb.select().from(codeNodes).where(inArray(codeNodes.repoId, repoIds)).all())
  copyCodeEdgesWithoutIds(context, context.stagingDb.select().from(codeEdges).where(inArray(codeEdges.repoId, repoIds)).all())
  copyRows(context, models, context.stagingDb.select().from(models).where(inArray(models.repositoryId, repoIds)).all())
  copyRows(context, entryPoints, context.stagingDb.select().from(entryPoints).where(inArray(entryPoints.repoId, repoIds)).all())
  copyRows(context, codeBundles, context.stagingDb.select().from(codeBundles).all())
  copyRows(context, frameworkDetections, context.stagingDb.select().from(frameworkDetections).where(inArray(frameworkDetections.repoId, repoIds)).all())
  copyRows(context, codeRelations, context.stagingDb.select().from(codeRelations).where(inArray(codeRelations.repoId, repoIds)).all())
  copyRows(context, serviceMapNodes, context.stagingDb.select().from(serviceMapNodes).where(eq(serviceMapNodes.projectId, context.projectId)).all())
  copyRows(context, serviceMapEdges, context.stagingDb.select().from(serviceMapEdges).where(eq(serviceMapEdges.projectId, context.projectId)).all())
  copyRows(context, repositoryPhaseStatus, context.stagingDb
    .select()
    .from(repositoryPhaseStatus)
    .where(and(
      inArray(repositoryPhaseStatus.repositoryId, repoIds),
      inArray(repositoryPhaseStatus.phase, [...STATIC_REPO_PHASES]),
    ))
    .all())
  copyRows(context, projectPhaseStatus, context.stagingDb
    .select()
    .from(projectPhaseStatus)
    .where(and(
      eq(projectPhaseStatus.projectId, context.projectId),
      inArray(projectPhaseStatus.phase, [...STATIC_PROJECT_PHASES]),
    ))
    .all())
}

function buildDefaultMerkleSnapshot(context: StaticMapStageContext): StaticMapSnapshotInput {
  const repoIds = context.repoPins.map((pin) => pin.repoId)
  const fileRows = context.stagingDb.select().from(fileCache).where(inArray(fileCache.repoId, repoIds)).all()
  const nodeRows = context.stagingDb.select().from(codeNodes).where(inArray(codeNodes.repoId, repoIds)).all()
  const edgeRows = context.stagingDb.select().from(codeEdges).where(inArray(codeEdges.repoId, repoIds)).all()
  const modelRows = context.stagingDb.select().from(models).where(inArray(models.repositoryId, repoIds)).all()
  const entryPointRows = context.stagingDb.select().from(entryPoints).where(inArray(entryPoints.repoId, repoIds)).all()
  // Filter bundles to this project's entry points. A no-op for staging DBs (single project), but
  // required when this snapshot builder is reused against the canonical DB (multi-project).
  const entryPointIdSet = new Set(entryPointRows.map((row) => row.id))
  const codeBundleRows = context.stagingDb.select().from(codeBundles).all()
    .filter((row) => entryPointIdSet.has(row.entryPointId))
  const frameworkRows = context.stagingDb.select().from(frameworkDetections).where(inArray(frameworkDetections.repoId, repoIds)).all()
  const relationRows = context.stagingDb.select().from(codeRelations).where(inArray(codeRelations.repoId, repoIds)).all()
  const serviceNodeRows = context.stagingDb.select().from(serviceMapNodes).where(eq(serviceMapNodes.projectId, context.projectId)).all()
  const serviceEdgeRows = context.stagingDb.select().from(serviceMapEdges).where(eq(serviceMapEdges.projectId, context.projectId)).all()

  const nodeHashes = hashRows(nodeRows, (row) => row.id, stableCodeNode)
  const edgeHashes = hashRows(edgeRows, (row) => `${row.sourceId}:${row.targetId ?? ''}:${row.relation}:${row.targetSpecifier ?? ''}:${row.targetSymbol ?? ''}:${row.firstArg ?? ''}:${row.literalArgs ?? ''}`, stableCodeEdge)
  const fileHashes = hashRows(fileRows, (row) => `${row.repoId}:${row.filePath}`, stableFileCache)
  const modelHashes = hashRows(modelRows, (row) => row.id, stableModel)
  const entryPointHashes = hashRows(entryPointRows, (row) => row.id, stableEntryPoint)
  const codeBundleHashes = hashRows(codeBundleRows, (row) => `${row.entryPointId}:${row.nodeId}`, stableCodeBundle)
  const frameworkHashes = hashRows(frameworkRows, (row) => `${row.repoId}:${row.framework}`, stableFrameworkDetection)
  const relationHashes = hashRows(relationRows, (row) => row.id, stableCodeRelation)
  const serviceNodeHashes = hashRows(serviceNodeRows, (row) => row.id, stableServiceMapNode)
  const serviceEdgeHashes = hashRows(serviceEdgeRows, serviceMapEdgeStableKey, stableServiceMapEdge)

  const nodeHashById = new Map(nodeHashes.map((entry) => [entry.key, entry.hash]))
  const modelHashById = new Map(modelHashes.map((entry) => [entry.key, entry.hash]))
  const relationHashById = new Map(relationHashes.map((entry) => [entry.key, entry.hash]))
  const serviceEdgeHashByKey = new Map(serviceEdgeHashes.map((entry) => [entry.key, entry.hash]))
  const routeDocumentSourceHashes = entryPointRows
    .map((entryPoint) => routeDocumentHashEntry({
      entryPoint,
      codeBundleRows,
      edgeRows,
      modelRows,
      relationRows,
      serviceEdgeRows,
      entryPointHash: entryPointHashes.find((entry) => entry.key === entryPoint.id)?.hash ?? hashValue(stableEntryPoint(entryPoint)),
      nodeHashById,
      relationHashById,
      modelHashById,
      serviceEdgeHashByKey,
    }))
    .sort(byKey)
  const modelDocumentSourceHashes = modelRows
    .map((model) => ({
      key: `model:${model.id}`,
      hash: modelHashById.get(model.id) ?? hashValue(stableModel(model)),
      target: {
        track: 'technical' as const,
        type: 'data_dictionary',
        scope: 'model',
        scopeId: model.id,
        repoId: model.repositoryId,
      },
    }))
    .sort(byKey)
  const technicalDocumentSourceHashes = [...routeDocumentSourceHashes, ...modelDocumentSourceHashes].sort(byKey)
  const businessDocumentSourceHashes = buildBusinessDocumentHashes({
    projectId: context.projectId,
    serviceNodeHashes,
    serviceEdgeHashes,
    technicalDocumentSourceHashes,
  })

  const tableHashes = {
    repoPins: hashValue(context.repoPins.map(repoPinToJson).sort((a, b) => String(a.repoId).localeCompare(String(b.repoId)))),
    files: hashValue(fileHashes),
    codeNodes: hashValue(nodeHashes),
    codeEdges: hashValue(edgeHashes),
    models: hashValue(modelHashes),
    entryPoints: hashValue(entryPointHashes),
    codeBundles: hashValue(codeBundleHashes),
    frameworkDetections: hashValue(frameworkHashes),
    codeRelations: hashValue(relationHashes),
    serviceMapNodes: hashValue(serviceNodeHashes),
    serviceMapEdges: hashValue(serviceEdgeHashes),
  }

  const hashSet = {
    tableHashes,
    routeDocumentSourceHashes,
    modelDocumentSourceHashes,
    technicalDocumentSourceHashes,
    businessDocumentSourceHashes,
    repoPins: context.repoPins.map(repoPinToJson),
  }
  const reasonInputs = {
    byKey: {
      ...Object.fromEntries(routeDocumentSourceHashes.map((entry) => [entry.key, { kind: 'entry_point', target: entry.target }])),
      ...Object.fromEntries(modelDocumentSourceHashes.map((entry) => [entry.key, { kind: 'model', target: entry.target }])),
      ...Object.fromEntries(businessDocumentSourceHashes.map((entry) => [entry.key, { kind: 'business', target: entry.target }])),
    },
    tableHashes,
  }
  return {
    rootHash: hashValue({ tableHashes, technicalDocumentSourceHashes, businessDocumentSourceHashes }),
    hashSet,
    reasonInputs,
  }
}

export interface EnsureCanonicalStaticSnapshotResult {
  snapshotId: string
  created: boolean
}

/**
 * Bootstrap a baseline Merkle snapshot directly from the canonical DB (no staging re-analysis,
 * no canonical churn). This lets first-time technical-doc generation stamp documents with a
 * documentSourceHash so the next sync can classify changes as `stale` rather than `stale_candidate`.
 * No-op (returns the latest existing snapshot) when the project already has one.
 */
export function ensureCanonicalStaticSnapshot(db: SyncDb, projectId: string): EnsureCanonicalStaticSnapshotResult {
  const existing = db.select()
    .from(staticMerkleSnapshots)
    .where(eq(staticMerkleSnapshots.projectId, projectId))
    .all()
    .sort((a, b) => `${b.createdAt}:${b.id}`.localeCompare(`${a.createdAt}:${a.id}`))[0]
  if (existing) return { snapshotId: existing.id, created: false }

  const repos = db.select()
    .from(repositories)
    .where(and(eq(repositories.projectId, projectId), isNull(repositories.deletedAt)))
    .all()
  const repoPins: StaticMapRepoPin[] = repos.map((repo) => ({
    repoId: repo.id,
    analysisBranch: repo.analysisBranch ?? '',
    sourceCommit: repo.lastSyncedCommit
      ?? (repo.analysisWorktreePath ? getHeadCommit(repo.analysisWorktreePath) : null)
      ?? 'unknown',
    analysisWorktreePath: repo.analysisWorktreePath ?? '',
  }))

  const snapshotId = `static_merkle:${nanoid()}`
  const context: StaticMapStageContext = {
    db,
    stagingDb: db,
    projectId,
    runId: `bootstrap:${snapshotId}`,
    stagingDbPath: '',
    repoPins,
  }
  const snapshot = buildDefaultMerkleSnapshot(context)
  db.insert(staticMerkleSnapshots).values({
    id: snapshotId,
    projectId,
    snapshotKind: 'project',
    analysisBranch: null,
    sourceCommit: null,
    repoCommitPinsJson: repoPins.map(repoPinToJson),
    rootHash: snapshot.rootHash,
    hashSetJson: snapshot.hashSet,
    reasonInputsJson: snapshot.reasonInputs,
    createdByRunId: null,
  }).run()
  return { snapshotId, created: true }
}

function deleteStagingDbFiles(path: string): void {
  rmSync(path, { force: true })
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
}

function patchRun(db: SyncDb, runId: string, patch: Partial<typeof syncStaticMapRuns.$inferInsert>): void {
  db.update(syncStaticMapRuns)
    .set({ ...patch, updatedAt: now() })
    .where(eq(syncStaticMapRuns.id, runId))
    .run()
}

function now(): string {
  return new Date().toISOString()
}

function repoPinToJson(pin: StaticMapRepoPin): Record<string, unknown> {
  return {
    repoId: pin.repoId,
    analysisBranch: pin.analysisBranch,
    sourceCommit: pin.sourceCommit,
    analysisWorktreePath: pin.analysisWorktreePath,
  }
}

function insertRows(db: SyncDb, table: unknown, rows: unknown[]): void {
  for (const row of rows) {
    db.insert(table as never).values(row as never).run()
  }
}

function copyRows(context: StaticMapApplyContext, table: unknown, rows: unknown[]): void {
  for (const row of rows) {
    context.tx.insert(table as never).values(row as never).run()
  }
}

function copyCodeEdgesWithoutIds(context: StaticMapApplyContext, rows: Array<typeof codeEdges.$inferSelect>): void {
  for (const row of rows) {
    const { id: _stagingId, ...value } = row
    context.tx.insert(codeEdges).values(value).run()
  }
}

function hashRows<T>(rows: T[], keyFor: (row: T) => string, stableFor: (row: T) => Record<string, unknown>): Array<{ key: string; hash: string }> {
  return rows
    .map((row) => {
      const stable = stableFor(row)
      return { key: keyFor(row), hash: hashValue(stable) }
    })
    .sort(byKey)
}

function routeDocumentHashEntry(input: {
  entryPoint: typeof entryPoints.$inferSelect
  codeBundleRows: Array<typeof codeBundles.$inferSelect>
  edgeRows: Array<typeof codeEdges.$inferSelect>
  modelRows: Array<typeof models.$inferSelect>
  relationRows: Array<typeof codeRelations.$inferSelect>
  serviceEdgeRows: Array<typeof serviceMapEdges.$inferSelect>
  entryPointHash: string
  nodeHashById: Map<string, string>
  relationHashById: Map<string, string>
  modelHashById: Map<string, string>
  serviceEdgeHashByKey: Map<string, string>
}): {
  key: string
  hash: string
  target: { track: 'technical'; type: string; scope: string; scopeId: string; repoId: string }
} {
  const reachableNodeIds = new Set(input.codeBundleRows
    .filter((row) => row.entryPointId === input.entryPoint.id)
    .map((row) => row.nodeId))
  reachableNodeIds.add(input.entryPoint.handlerNodeId)
  const reachableNodeHashes = Array.from(reachableNodeIds)
    .map((nodeId) => ({ key: nodeId, hash: input.nodeHashById.get(nodeId) ?? '' }))
    .filter((entry) => entry.hash)
    .sort(byKey)
  const reachableEdgeHashes = input.edgeRows
    .filter((row) => reachableNodeIds.has(row.sourceId) || (row.targetId ? reachableNodeIds.has(row.targetId) : false))
    .map((row) => ({ key: `${row.sourceId}:${row.targetId ?? ''}:${row.relation}:${row.targetSymbol ?? ''}`, hash: hashValue(stableCodeEdge(row)) }))
    .sort(byKey)
  const reachableRelations = input.relationRows
    .filter((row) => reachableNodeIds.has(row.sourceNodeId) || row.evidenceNodeIds.some((nodeId) => reachableNodeIds.has(nodeId)))
  const reachableRelationHashes = reachableRelations
    .map((row) => ({ key: row.id, hash: input.relationHashById.get(row.id) ?? hashValue(stableCodeRelation(row)) }))
    .sort(byKey)
  const relatedModelHashes = findRelatedModels(input.modelRows, reachableRelations)
    .map((model) => ({ key: model.id, hash: input.modelHashById.get(model.id) ?? hashValue(stableModel(model)) }))
    .sort(byKey)
  const serviceMapSourceType = entryPointServiceMapType(input.entryPoint)
  const relatedServiceMapEdgeHashes = input.serviceEdgeRows
    .filter((row) =>
      (row.sourceType === serviceMapSourceType && row.sourceId === input.entryPoint.id)
      || (row.targetType === serviceMapSourceType && row.targetId === input.entryPoint.id),
    )
    .map((row) => {
      const key = serviceMapEdgeStableKey(row)
      return { key, hash: input.serviceEdgeHashByKey.get(key) ?? hashValue(stableServiceMapEdge(row)) }
    })
    .sort(byKey)
  const target = entryPointTarget(input.entryPoint)
  const key = `${target.scope}:${input.entryPoint.id}`
  return {
    key,
    hash: hashValue({
      entryPointHash: input.entryPointHash,
      reachableNodeHashes,
      reachableEdgeHashes,
      reachableRelationHashes,
      relatedModelHashes,
      relatedServiceMapEdgeHashes,
    }),
    target,
  }
}

function findRelatedModels(
  modelRows: Array<typeof models.$inferSelect>,
  relationRows: Array<typeof codeRelations.$inferSelect>,
): Array<typeof models.$inferSelect> {
  const terms = new Set<string>()
  for (const relation of relationRows) {
    for (const value of [relation.target, relation.operation, relation.canonicalTarget]) {
      for (const term of tokenizeRelationTarget(value)) terms.add(term)
    }
    for (const value of Object.values(relation.payload ?? {})) {
      if (typeof value === 'string') {
        for (const term of tokenizeRelationTarget(value)) terms.add(term)
      }
    }
  }
  return modelRows.filter((model) => terms.has(model.name.toLowerCase()) || terms.has(model.tableName.toLowerCase()))
}

function tokenizeRelationTarget(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .filter(Boolean)
}

function entryPointTarget(entryPoint: typeof entryPoints.$inferSelect): {
  track: 'technical'
  type: string
  scope: string
  scopeId: string
  repoId: string
} {
  if (entryPoint.kind === 'page') {
    return { track: 'technical', type: 'screen_spec', scope: 'screen', scopeId: entryPoint.id, repoId: entryPoint.repoId }
  }
  if (entryPoint.kind === 'job') {
    return { track: 'technical', type: 'schedule_spec', scope: 'job', scopeId: entryPoint.id, repoId: entryPoint.repoId }
  }
  if (entryPoint.kind === 'event') {
    return { track: 'technical', type: 'event_spec', scope: 'event', scopeId: entryPoint.id, repoId: entryPoint.repoId }
  }
  return { track: 'technical', type: 'api_spec', scope: 'route', scopeId: entryPoint.id, repoId: entryPoint.repoId }
}

function entryPointServiceMapType(entryPoint: typeof entryPoints.$inferSelect): string {
  if (entryPoint.kind === 'page') return 'screen'
  if (entryPoint.kind === 'job') return 'job'
  if (entryPoint.kind === 'event') return 'event'
  return 'api'
}

function serviceMapEdgeStableKey(row: typeof serviceMapEdges.$inferSelect): string {
  return `${row.repoId}:${row.sourceType}:${row.sourceId}:${row.targetType}:${row.targetId}:${row.kind}:${row.canonicalTarget}`
}

function buildBusinessDocumentHashes(input: {
  projectId: string
  serviceNodeHashes: Array<{ key: string; hash: string }>
  serviceEdgeHashes: Array<{ key: string; hash: string }>
  technicalDocumentSourceHashes: Array<{ key: string; hash: string; target: unknown }>
}): Array<{
  key: string
  hash: string
  target: { track: 'business'; type: 'design'; scope: 'project'; scopeId: string }
}> {
  if (input.serviceNodeHashes.length === 0 && input.serviceEdgeHashes.length === 0 && input.technicalDocumentSourceHashes.length === 0) {
    return []
  }
  return [{
    key: `project:${input.projectId}:business`,
    hash: hashValue({
      serviceNodeHashes: input.serviceNodeHashes,
      serviceEdgeHashes: input.serviceEdgeHashes,
      technicalDocumentSourceHashes: input.technicalDocumentSourceHashes.map((entry) => ({ key: entry.key, hash: entry.hash })),
    }),
    target: { track: 'business', type: 'design', scope: 'project', scopeId: input.projectId },
  }]
}

function stableFileCache(row: typeof fileCache.$inferSelect): Record<string, unknown> {
  return { repoId: row.repoId, filePath: row.filePath, fileHash: row.fileHash }
}

function stableCodeNode(row: typeof codeNodes.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    repoId: row.repoId,
    type: row.type,
    filePath: row.filePath,
    name: row.name,
    normalizedCodeHash: row.normalizedCodeHash,
    parentNodeId: row.parentNodeId,
    originKind: row.originKind,
    role: row.role,
    signature: row.signature,
    exported: row.exported,
    isDefaultExport: row.isDefaultExport,
    isAsync: row.isAsync,
    isTest: row.isTest,
    testType: row.testType,
    docComment: row.docComment,
    parseStatus: row.parseStatus,
  }
}

function stableCodeEdge(row: typeof codeEdges.$inferSelect): Record<string, unknown> {
  return {
    repoId: row.repoId,
    sourceId: row.sourceId,
    targetId: row.targetId,
    relation: row.relation,
    targetSpecifier: row.targetSpecifier,
    targetSymbol: row.targetSymbol,
    typeRefSubtype: row.typeRefSubtype,
    chainPath: row.chainPath,
    firstArg: row.firstArg,
    literalArgs: row.literalArgs,
    argExpressions: row.argExpressions,
    resolveStatus: row.resolveStatus,
    confidence: row.confidence,
    source: row.source,
  }
}

function stableModel(row: typeof models.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    name: row.name,
    tableName: row.tableName,
    comment: row.comment,
    fields: stripPositionalMetadata(row.fields),
    relations: stripPositionalMetadata(row.relations),
    isDeprecated: row.isDeprecated,
    sourceFile: row.sourceFile,
    orm: row.orm,
    validity: row.validity,
  }
}

// Model field/relation entries carry `line` numbers for editor navigation. Those shift
// whenever unrelated earlier content in the schema file moves (e.g. adding/removing another
// model), which would otherwise invalidate the document-source hash of every model below the
// edit and cascade into route hashes via relatedModelHashes. Exclude positional metadata so the
// hash reflects only the semantic shape of the model.
function stripPositionalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPositionalMetadata)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'line') continue
      out[key] = stripPositionalMetadata(inner)
    }
    return out
  }
  return value
}

function stableEntryPoint(row: typeof entryPoints.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    repoId: row.repoId,
    framework: row.framework,
    kind: row.kind,
    httpMethod: row.httpMethod,
    path: row.path,
    parentPath: row.parentPath,
    fullPath: row.fullPath,
    handlerNodeId: row.handlerNodeId,
    metadata: row.metadata,
    detectionSource: row.detectionSource,
    confidence: row.confidence,
    detectionEvidence: row.detectionEvidence,
    truncatedBy: row.truncatedBy,
  }
}

function stableCodeBundle(row: typeof codeBundles.$inferSelect): Record<string, unknown> {
  return { entryPointId: row.entryPointId, nodeId: row.nodeId, depth: row.depth, edgePath: row.edgePath }
}

function stableFrameworkDetection(row: typeof frameworkDetections.$inferSelect): Record<string, unknown> {
  return { repoId: row.repoId, framework: row.framework, detectedVia: row.detectedVia, evidence: row.evidence, active: row.active }
}

function stableCodeRelation(row: typeof codeRelations.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    repoId: row.repoId,
    sourceNodeId: row.sourceNodeId,
    kind: row.kind,
    target: row.target,
    operation: row.operation,
    canonicalTarget: row.canonicalTarget,
    payload: row.payload,
    evidenceNodeIds: row.evidenceNodeIds,
    confidence: row.confidence,
    unresolvedReason: row.unresolvedReason,
  }
}

function stableServiceMapNode(row: typeof serviceMapNodes.$inferSelect): Record<string, unknown> {
  return {
    projectId: row.projectId,
    repoId: row.repoId,
    type: row.type,
    nodeId: row.nodeId,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    canonicalKey: row.canonicalKey,
    label: row.label,
  }
}

function stableServiceMapEdge(row: typeof serviceMapEdges.$inferSelect): Record<string, unknown> {
  return {
    projectId: row.projectId,
    repoId: row.repoId,
    sourceRepoId: row.sourceRepoId,
    targetRepoId: row.targetRepoId,
    sourceNodeId: row.sourceNodeId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceLabel: row.sourceLabel,
    targetNodeId: row.targetNodeId,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    kind: row.kind,
    canonicalTarget: row.canonicalTarget,
    confidence: row.confidence,
    source: row.source,
    evidence: row.evidence,
    unresolvedReason: row.unresolvedReason,
  }
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key.localeCompare(b.key)
}
