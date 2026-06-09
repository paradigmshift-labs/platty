/**
 * build_models 오케스트레이터 테스트
 * SOT: specs/build_models/specs/orchestrator/spec.md
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import { eq } from 'drizzle-orm'
import { createTestDb, type DB } from '../../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/index.js'
import { models as modelsTable } from '@/db/schema/build_models.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import type {
  ModelRaw,
  BuildModelsAdapter,
  SchemaFile,
  SchemaChunk,
} from '@/pipeline_modules/build_models/types.js'
import type { SchemaSource } from '@/db/schema/json_types/schema_source.js'
import { runBuildModels } from '@/pipeline_modules/build_models/index.js'
import { PipelineError, AbortError } from '@/infra/errors.js'
import * as f5Module from '@/pipeline_modules/build_models/f5_upsert_models.js'

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const PROJ_ID = 'proj_test'
const REPO_ID = 'repo_test'
const REPO_PATH = '/test/repo'

// ─── Fixture helpers ───────────────────────────────────────────────────────────

function makeModel(name: string): ModelRaw {
  return {
    name, table_name: name.toLowerCase(), comment: '', fields: [], relations: [],
    source_file: null, line_start: null, line_end: null, is_deprecated: false,
  }
}

function makeDslAdapter(models: ModelRaw[]): BuildModelsAdapter {
  return {
    orm: 'prisma', strategy: 'dsl-parse',
    ensureReady: vi.fn().mockResolvedValue(undefined),
    collectNames: vi.fn().mockReturnValue({ enumNames: new Set(), modelNames: new Set(), compositeTypeNames: new Set() }),
    prepareChunks: vi.fn().mockImplementation((files: SchemaFile[]) => [{ files, orm: 'prisma' }] as SchemaChunk[]),
    parseChunk: vi.fn().mockResolvedValue(models),
  }
}

function makeGraphAdapter(models: ModelRaw[]): BuildModelsAdapter {
  return {
    orm: 'typeorm', strategy: 'graph-query',
    queryFromGraph: vi.fn().mockResolvedValue(models),
  }
}

function makeRegistry(entries: [string, BuildModelsAdapter][]): Map<string, () => BuildModelsAdapter> {
  return new Map(entries.map(([orm, adapter]) => [orm, () => adapter]))
}

// ─── DB seed helpers ───────────────────────────────────────────────────────────

function seedProject(db: DB): void {
  db.insert(projects).values({ id: PROJ_ID, name: 'Test Project' }).run()
}

function seedRepo(
  db: DB,
  schemaSources: SchemaSource[] | null = null,
  lastSyncedCommit: string | null = null,
): void {
  db.insert(repositories).values({
    id: REPO_ID, projectId: PROJ_ID, name: 'test-repo',
    repoPath: REPO_PATH,
    schemaSources: schemaSources ?? undefined,
    lastSyncedCommit: lastSyncedCommit ?? undefined,
  }).run()
}

function seedBuildGraphDone(db: DB): void {
  db.insert(repositoryPhaseStatus).values({
    repositoryId: REPO_ID, phase: 'build_graph',
    builtAt: new Date().toISOString(), validity: 'fresh',
    updatedAt: new Date().toISOString(),
  }).run()
}

function getModels(db: DB) {
  return db.select().from(modelsTable).where(eq(modelsTable.repositoryId, REPO_ID)).all()
}

function seedExistingModel(db: DB, name = 'User', orm = 'prisma'): void {
  db.insert(modelsTable).values({
    id: `${REPO_ID}:${name}`,
    repositoryId: REPO_ID,
    name,
    tableName: name.toLowerCase(),
    fields: [],
    relations: [],
    orm,
    validity: 'fresh',
  }).run()
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('runBuildModels', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // TC#1
  it('TC#1: Prisma happy path → modelsCount>0, upsertedCount>0, errors=[]', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [{ orm: 'prisma', schema_paths: ['prisma/schema.prisma'], provider: null, label: 'main' }])

    vi.spyOn(fs, 'readFileSync').mockReturnValue('model User { id String @id }')

    const prismaModels = [makeModel('User'), makeModel('Post')]
    const registry = makeRegistry([['prisma', makeDslAdapter(prismaModels)]])

    const result = await runBuildModels({ repoId: REPO_ID, db, _adapterRegistry: registry })

    expect(result.modelsCount).toBe(2)
    expect(result.upsertedCount).toBe(2)
    expect(result.errors).toHaveLength(0)
    expect(result.skippedFiles).toHaveLength(0)

    // DB에 모델 저장됨
    const dbModels = getModels(db)
    expect(dbModels).toHaveLength(2)
  })

  // TC#2
  it('TC#2: TypeORM repo, build_graph 완료 → modelsCount>0, upsertedCount>0', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [{ orm: 'typeorm', schema_paths: [], provider: null, label: 'main' }])
    seedBuildGraphDone(db)

    const typeormModels = [makeModel('Order'), makeModel('Product')]
    const registry = makeRegistry([['typeorm', makeGraphAdapter(typeormModels)]])

    const result = await runBuildModels({ repoId: REPO_ID, db, _adapterRegistry: registry })

    expect(result.modelsCount).toBe(2)
    expect(result.upsertedCount).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  // TC#3
  it('TC#3: schemaSources=null → 기존 models orphaned, repository_phase_status 갱신', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, null) // schemaSources=null
    seedExistingModel(db)

    const result = await runBuildModels({ repoId: REPO_ID, db })

    expect(result.modelsCount).toBe(0)
    expect(result.upsertedCount).toBe(0)
    expect(result.orphanedCount).toBe(1)
    expect(result.skippedFiles).toHaveLength(0)
    expect(getModels(db)[0]!.validity).toBe('orphaned')

    const phaseStatus = db.select().from(repositoryPhaseStatus)
      .where(eq(repositoryPhaseStatus.repositoryId, REPO_ID))
      .all()
    expect(phaseStatus).toHaveLength(1)
    expect(phaseStatus[0]!.phase).toBe('build_models')
    expect(phaseStatus[0]!.validity).toBe('fresh')
  })

  // TC#4
  it('TC#4: repository 없음 → PipelineError throw', async () => {
    const db = createTestDb()
    seedProject(db)
    // repo NOT seeded

    await expect(runBuildModels({ repoId: 'nonexistent', db }))
      .rejects.toThrow(PipelineError)
  })

  // TC#5
  it('TC#5: Prisma + TypeORM 혼합 → 두 ORM 모델 합산, F5 2회 호출 (ORM별)', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [
      { orm: 'prisma', schema_paths: ['prisma/schema.prisma'], provider: null, label: 'main' },
      { orm: 'typeorm', schema_paths: [], provider: null, label: 'main' },
    ])
    seedBuildGraphDone(db)

    vi.spyOn(fs, 'readFileSync').mockReturnValue('model User {}')

    const prismaModels = [makeModel('User')]
    const typeormModels = [makeModel('Order')]
    const registry = makeRegistry([
      ['prisma', makeDslAdapter(prismaModels)],
      ['typeorm', makeGraphAdapter(typeormModels)],
    ])

    const result = await runBuildModels({ repoId: REPO_ID, db, _adapterRegistry: registry })

    expect(result.modelsCount).toBe(2)
    expect(result.upsertedCount).toBe(2)

    // DB에 두 ORM 모델 모두 저장
    const dbModels = getModels(db)
    expect(dbModels).toHaveLength(2)
    const names = dbModels.map(m => m.name)
    expect(names).toContain('User')
    expect(names).toContain('Order')
  })

  // TC#6
  it('TC#6: F4 error verdict (FK_MISMATCH) → errors 포함, F5 정상 실행, upsertedCount>0', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [{ orm: 'prisma', schema_paths: ['prisma/schema.prisma'], provider: null, label: 'main' }])

    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')

    // User에 relations.fk_fields=['userId'] 있지만 fields에 userId 없음 → FK_MISMATCH(error)
    const userModel: ModelRaw = {
      name: 'User', table_name: 'users', comment: '',
      fields: [{ name: 'id', type: 'String', nullable: false, primary: true, unique: false, line: 1 }],
      relations: [{
        name: 'posts', target_model: 'Post', type: 'oneToMany',
        fk_fields: ['nonExistentFk'],  // 존재하지 않는 FK 필드
        line: 2,
      }],
      source_file: null, line_start: null, line_end: null, is_deprecated: false,
    }
    const postModel: ModelRaw = {
      name: 'Post', table_name: 'posts', comment: '',
      fields: [{ name: 'id', type: 'String', nullable: false, primary: true, unique: false, line: 1 }],
      relations: [],
      source_file: null, line_start: null, line_end: null, is_deprecated: false,
    }
    const registry = makeRegistry([['prisma', makeDslAdapter([userModel, postModel])]])

    const result = await runBuildModels({ repoId: REPO_ID, db, _adapterRegistry: registry })

    expect(result.errors.length).toBeGreaterThan(0) // FK_MISMATCH error
    expect(result.upsertedCount).toBeGreaterThan(0) // F5 정상 실행
  })

  // TC#7
  it('TC#7: signal.aborted → AbortError throw', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [{ orm: 'prisma', schema_paths: ['prisma/schema.prisma'], provider: null, label: 'main' }])

    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')

    const controller = new AbortController()
    controller.abort()

    const registry = makeRegistry([['prisma', makeDslAdapter([makeModel('User')])]])

    await expect(
      runBuildModels({ repoId: REPO_ID, db, signal: controller.signal, _adapterRegistry: registry })
    ).rejects.toThrow(AbortError)

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.repoId, REPO_ID)).get()
    expect(run?.status).toBe('cancelled')

    const phase = db.select().from(repositoryPhaseStatus)
      .where(eq(repositoryPhaseStatus.repositoryId, REPO_ID))
      .get()
    expect(phase?.phase).toBe('build_models')
    expect(phase?.status).toBe('cancelled')
  })

  // TC#8
  it('TC#8: TypeORM, build_graph 미완료 → PipelineError throw', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [{ orm: 'typeorm', schema_paths: [], provider: null, label: 'main' }])
    // build_graph phase_status NOT seeded

    const registry = makeRegistry([['typeorm', makeGraphAdapter([makeModel('Order')])]])

    await expect(
      runBuildModels({ repoId: REPO_ID, db, _adapterRegistry: registry })
    ).rejects.toThrow(PipelineError)

    await expect(
      runBuildModels({ repoId: REPO_ID, db, _adapterRegistry: registry })
    ).rejects.toThrow(/build_graph not completed/)
  })

  // TC#9
  it('TC#9: 모든 source 파싱 실패 → 기존 models orphaned, skippedFiles 비어있지 않음', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [{ orm: 'prisma', schema_paths: ['prisma/schema.prisma'], provider: null, label: 'main' }])
    seedExistingModel(db)

    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('ENOENT') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const registry = makeRegistry([['prisma', makeDslAdapter([])]])

    const result = await runBuildModels({ repoId: REPO_ID, db, _adapterRegistry: registry })

    expect(result.upsertedCount).toBe(0)
    expect(result.orphanedCount).toBe(1)
    expect(result.skippedFiles.length).toBeGreaterThan(0)
    expect(getModels(db)[0]!.validity).toBe('orphaned')

    const phaseStatus = db.select().from(repositoryPhaseStatus)
      .where(eq(repositoryPhaseStatus.repositoryId, REPO_ID))
      .all()
    expect(phaseStatus).toHaveLength(1)
    expect(phaseStatus[0]!.phase).toBe('build_models')
    expect(phaseStatus[0]!.validity).toBe('fresh')
  })

  // TC#10
  it('TC#10: Prisma 완료 후 TypeORM 시작 전 abort → Prisma 모델 DB 유지, AbortError throw', async () => {
    const db = createTestDb()
    seedProject(db)
    seedRepo(db, [
      { orm: 'prisma', schema_paths: ['prisma/schema.prisma'], provider: null, label: 'main' },
      { orm: 'typeorm', schema_paths: [], provider: null, label: 'main' },
    ])
    seedBuildGraphDone(db)

    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')

    const controller = new AbortController()

    const prismaModels = [makeModel('User')]
    const typeormModels = [makeModel('Order')]
    const registry = makeRegistry([
      ['prisma', makeDslAdapter(prismaModels)],
      ['typeorm', makeGraphAdapter(typeormModels)],
    ])

    // 첫 번째 upsertModels (Prisma) 완료 후 controller 중단
    const originalUpsertModels = f5Module.upsertModels
    vi.spyOn(f5Module, 'upsertModels').mockImplementation(async (db, repoId, orm, models, commit, signal) => {
      const result = await originalUpsertModels(db, repoId, orm, models, commit, signal)
      controller.abort()  // Prisma 완료 후 abort
      return result
    })

    await expect(
      runBuildModels({ repoId: REPO_ID, db, signal: controller.signal, _adapterRegistry: registry })
    ).rejects.toThrow(AbortError)

    // Prisma 모델은 DB에 남아있음
    const dbModels = getModels(db)
    expect(dbModels).toHaveLength(1)
    expect(dbModels[0].name).toBe('User')
  })
})
