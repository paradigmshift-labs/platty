import { describe, it, expect } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { createTestDb, type DB } from '../../server/helpers.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/index.js'
import { models as modelsTable } from '@/db/schema/build_models.js'
import type { ModelRaw, ModelField, ModelRelation } from '../../../src/pipeline_modules/build_models/types.js'
import { upsertModels, toModelId } from '../../../src/pipeline_modules/build_models/f5_upsert_models.js'
import { AbortError, PipelineError } from '../../../src/infra/errors.js'

// ── 상수 ──

const PROJ_ID = 'proj_test'
const REPO_ID = 'repo_test'

// ── Fixture helpers ──

function makeField(overrides: Partial<ModelField> & { name: string }): ModelField {
  return { type: 'String', nullable: false, primary: false, unique: false, line: 1, ...overrides }
}

function makeModel(overrides: Partial<ModelRaw> & { name: string }): ModelRaw {
  return {
    table_name: overrides.name.toLowerCase(),
    comment: '',
    fields: [makeField({ name: 'id', primary: true })],
    relations: [],
    source_file: 'schema.prisma',
    line_start: 1,
    line_end: 10,
    is_deprecated: false,
    ...overrides,
  }
}

// ── DB seed ──

function seedDb(db: DB): void {
  db.insert(projects).values({ id: PROJ_ID, name: 'Test' }).run()
  db.insert(repositories).values({
    id: REPO_ID,
    projectId: PROJ_ID,
    name: 'test-repo',
    repoPath: '/mock/repo',
  }).run()
}

function getModels(db: DB) {
  return db.select().from(modelsTable).where(eq(modelsTable.repositoryId, REPO_ID)).all()
}

function getPhaseStatus(db: DB) {
  return db
    .select()
    .from(repositoryPhaseStatus)
    .where(
      and(
        eq(repositoryPhaseStatus.repositoryId, REPO_ID),
        eq(repositoryPhaseStatus.phase, 'build_models'),
      ),
    )
    .all()
}

// ── Tests ──

describe('toModelId', () => {
  // TC#15
  it("toModelId('repo_abc', 'User') → 'repo_abc:User'", () => {
    expect(toModelId('repo_abc', 'User')).toBe('repo_abc:User')
  })

  // TC#16
  it('repoId가 다르면 id가 다름', () => {
    const a = toModelId('repo_abc', 'Order')
    const b = toModelId('repo_xyz', 'Order')
    expect(a).toBe('repo_abc:Order')
    expect(b).toBe('repo_xyz:Order')
    expect(a).not.toBe(b)
  })
})

describe('upsertModels', () => {
  // TC#1
  it('신규 모델 3개 → upserted=3, orphaned=0, validity=fresh', async () => {
    const db = createTestDb()
    seedDb(db)

    const result = await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
      makeModel({ name: 'Order' }),
      makeModel({ name: 'Product' }),
    ], 'abc123')

    expect(result.upserted).toBe(3)
    expect(result.orphaned).toBe(0)

    const rows = getModels(db)
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.validity === 'fresh')).toBe(true)
    expect(rows.map(r => r.name).sort()).toEqual(['Order', 'Product', 'User'])
  })

  // TC#2
  it('기존 모델 필드 변경 후 재실행 → fields 갱신', async () => {
    const db = createTestDb()
    seedDb(db)

    const fields1 = [makeField({ name: 'id', primary: true })]
    await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User', fields: fields1 }),
    ], 'commit1')

    const fields2 = [
      makeField({ name: 'id', primary: true }),
      makeField({ name: 'email', type: 'String' }),
    ]
    const result = await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User', fields: fields2 }),
    ], 'commit2')

    expect(result.upserted).toBe(1)
    expect(result.orphaned).toBe(0)

    const rows = getModels(db)
    expect(rows).toHaveLength(1)
    const updatedRow = rows[0]!
    expect((updatedRow.fields as ModelField[]).length).toBe(2)
    expect(updatedRow.builtFromCommit).toBe('commit2')
  })

  // TC#3
  it('description이 있는 모델 재실행 → description 그대로 유지', async () => {
    const db = createTestDb()
    seedDb(db)

    // 최초 삽입
    await upsertModels(db, REPO_ID, 'prisma', [makeModel({ name: 'User' })], null)

    // description 직접 설정
    db.update(modelsTable)
      .set({ description: '사용자 관리 모델' })
      .where(eq(modelsTable.id, toModelId(REPO_ID, 'User')))
      .run()

    // 재실행
    await upsertModels(db, REPO_ID, 'prisma', [makeModel({ name: 'User' })], null)

    const rows = getModels(db)
    expect(rows[0]!.description).toBe('사용자 관리 모델')
  })

  // TC#4
  it('이전 3개 → 이번 2개 (1개 삭제) → orphaned=1, validity=orphaned (삭제 X)', async () => {
    const db = createTestDb()
    seedDb(db)

    await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
      makeModel({ name: 'Order' }),
      makeModel({ name: 'OldModel' }),
    ], null)

    const result = await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
      makeModel({ name: 'Order' }),
    ], null)

    expect(result.orphaned).toBe(1)

    const rows = getModels(db)
    expect(rows).toHaveLength(3) // 삭제 안 됨
    const oldRow = rows.find(r => r.name === 'OldModel')
    expect(oldRow!.validity).toBe('orphaned')
    const freshRows = rows.filter(r => r.validity === 'fresh')
    expect(freshRows).toHaveLength(2)
  })

  // TC#5
  it('prisma 모델 2개로 재실행 → prisma orphaned=1, typeorm 모델 validity 변경 없음', async () => {
    const db = createTestDb()
    seedDb(db)

    // prisma 모델 3개
    await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
      makeModel({ name: 'Order' }),
      makeModel({ name: 'Product' }),
    ], null)

    // typeorm 모델 2개
    await upsertModels(db, REPO_ID, 'typeorm', [
      makeModel({ name: 'TypeUser' }),
      makeModel({ name: 'TypeOrder' }),
    ], null)

    // prisma 모델 2개로 재실행 (Product 제거)
    const result = await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
      makeModel({ name: 'Order' }),
    ], null)

    expect(result.orphaned).toBe(1)

    // typeorm 모델은 여전히 fresh
    const typeormRows = db.select().from(modelsTable)
      .where(and(eq(modelsTable.repositoryId, REPO_ID), eq(modelsTable.orm, 'typeorm')))
      .all()
    expect(typeormRows.every(r => r.validity === 'fresh')).toBe(true)

    // prisma Product는 orphaned
    const productRow = db.select().from(modelsTable)
      .where(eq(modelsTable.id, toModelId(REPO_ID, 'Product')))
      .all()
    expect(productRow[0]!.validity).toBe('orphaned')
  })

  // TC#6
  it('models=[] → upserted=0, 기존 모두 orphaned', async () => {
    const db = createTestDb()
    seedDb(db)

    await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
      makeModel({ name: 'Order' }),
    ], null)

    const result = await upsertModels(db, REPO_ID, 'prisma', [], null)

    expect(result.upserted).toBe(0)
    expect(result.orphaned).toBe(2)

    const rows = getModels(db)
    expect(rows.every(r => r.validity === 'orphaned')).toBe(true)
  })

  // TC#7
  it('1000개 orphaned → 999개 chunk 분할 정상 처리', async () => {
    const db = createTestDb()
    seedDb(db)

    // 1000개 신규 삽입
    const bigList: ModelRaw[] = Array.from({ length: 1000 }, (_, i) =>
      makeModel({ name: `Model${i}` }),
    )
    await upsertModels(db, REPO_ID, 'prisma', bigList, null)

    // 모두 orphaned 처리
    const result = await upsertModels(db, REPO_ID, 'prisma', [], null)

    expect(result.orphaned).toBe(1000)
    const rows = getModels(db)
    expect(rows.every(r => r.validity === 'orphaned')).toBe(true)
  }, 10000)

  // TC#8
  it('signal.aborted=true → AbortError throw, DB 변경 없음', async () => {
    const db = createTestDb()
    seedDb(db)

    const signal = AbortSignal.abort()

    await expect(
      upsertModels(db, REPO_ID, 'prisma', [makeModel({ name: 'User' })], null, signal),
    ).rejects.toThrow(AbortError)

    const rows = getModels(db)
    expect(rows).toHaveLength(0)
  })

  it('트랜잭션 전 DB 접근 중 AbortError → AbortError 그대로 throw', async () => {
    const abortingDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            all: () => {
              throw new AbortError('Aborted')
            },
          }),
        }),
      }),
    } as unknown as DB

    await expect(
      upsertModels(abortingDb, REPO_ID, 'prisma', [makeModel({ name: 'User' })], null),
    ).rejects.toThrow(AbortError)
  })

  // TC#9
  it('DB 에러 (invalid repoId) → PipelineError throw', async () => {
    const db = createTestDb()
    seedDb(db)

    // 존재하지 않는 repoId → FK constraint violation
    await expect(
      upsertModels(db, 'nonexistent_repo_id', 'prisma', [makeModel({ name: 'User' })], null),
    ).rejects.toThrow(PipelineError)
  })

  // TC#10
  it('leaf helper does not write repository_phase_status directly', async () => {
    const db = createTestDb()
    seedDb(db)

    await upsertModels(db, REPO_ID, 'prisma', [makeModel({ name: 'User' })], 'abc')

    const status = getPhaseStatus(db)
    expect(status).toHaveLength(0)
  })

  // TC#11
  it('leaf helper leaves existing repository_phase_status untouched', async () => {
    const db = createTestDb()
    seedDb(db)

    db.insert(repositoryPhaseStatus).values({
      repositoryId: REPO_ID,
      phase: 'build_models',
      validity: 'stale',
      status: 'failed',
      builtFromCommit: 'old',
    }).run()

    await upsertModels(db, REPO_ID, 'prisma', [makeModel({ name: 'User' })], 'commit2')

    const status = getPhaseStatus(db)
    expect(status).toHaveLength(1)
    expect(status[0]!.validity).toBe('stale')
    expect(status[0]!.status).toBe('failed')
    expect(status[0]!.builtFromCommit).toBe('old')
  })

  // TC#12
  it('commit=null → built_from_commit=null', async () => {
    const db = createTestDb()
    seedDb(db)

    await upsertModels(db, REPO_ID, 'prisma', [makeModel({ name: 'User' })], null)

    const rows = getModels(db)
    expect(rows[0]!.builtFromCommit).toBeNull()
  })

  // TC#13
  it('동일 repoId, 다른 orm 각각 독립 upsert → 서로 영향 없음', async () => {
    const db = createTestDb()
    seedDb(db)

    await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
      makeModel({ name: 'Order' }),
    ], null)

    await upsertModels(db, REPO_ID, 'typeorm', [
      makeModel({ name: 'TypeUser' }),
    ], null)

    // prisma 재실행 (User만 유지)
    const prismaResult = await upsertModels(db, REPO_ID, 'prisma', [
      makeModel({ name: 'User' }),
    ], null)
    expect(prismaResult.orphaned).toBe(1) // Order만 orphaned

    // typeorm 모델은 영향 없음
    const typeormRows = db.select().from(modelsTable)
      .where(and(eq(modelsTable.repositoryId, REPO_ID), eq(modelsTable.orm, 'typeorm')))
      .all()
    expect(typeormRows[0]!.validity).toBe('fresh')

    // prisma Order는 orphaned
    const orderRow = db.select().from(modelsTable)
      .where(eq(modelsTable.id, toModelId(REPO_ID, 'Order')))
      .all()
    expect(orderRow[0]!.validity).toBe('orphaned')
  })

  // TC#14
  it('트랜잭션 원자성: upsert 실패 시 rollback → PipelineError throw', async () => {
    const db = createTestDb()
    seedDb(db)

    // DB 커넥션 종료 후 쿼리 → 전체 실패 (transaction 포함)
    ;(db.$client as import('better-sqlite3').Database).close()

    await expect(
      upsertModels(db, REPO_ID, 'prisma', [
        makeModel({ name: 'ModelA' }),
        makeModel({ name: 'ModelB' }),
        makeModel({ name: 'ModelC' }),
      ], null),
    ).rejects.toThrow(PipelineError)
  })
})
