/**
 * runBuildGraph orchestrator 추가 단위 테스트
 *
 * 통합 테스트(m3-build-graph.test.ts)가 핵심 흐름 8개를 커버.
 * 여기선 분기 보강:
 *   - Dart language 분기 (DartParserAdapter)
 *   - completion이 throw → run.finish('failed') 분기
 *   - REPO_DELETED 검증
 *   - signal 옵션 받지만 본문 미사용 (smoke)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import * as schema from '@/db/schema/index.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { fileCache } from '@/db/schema/code_graph.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import { runBuildGraph, BuildGraphError } from '@/pipeline_modules/build_graph/index.js'

type DB = ReturnType<typeof drizzle<typeof schema>>

function createDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

function makeRepo(db: DB, repoPath: string, opts: { language?: 'typescript' | 'dart'; framework?: string } = {}): string {
  const now = new Date().toISOString()
  db.insert(projects).values({ id: 'p', name: 'p', createdAt: now, updatedAt: now }).run()
  const repoId = 'r1'
  db.insert(repositories)
    .values({
      id: repoId,
      projectId: 'p',
      name: 'r',
      repoPath,
      language: opts.language ?? 'typescript',
      framework: (opts.framework ?? 'nestjs') as 'nestjs',
      pathAliases: { '@/*': '*' },
      baseUrl: 'src',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db.insert(repositoryPhaseStatus)
    .values({
      repositoryId: repoId,
      phase: 'analyze_repo',
      builtAt: now,
      validity: 'fresh',
      confirmedAt: now,
      updatedAt: now,
    })
    .run()
  return repoId
}

function gitInitCommit(dir: string): void {
  execSync('git init -q && git config user.email t@t.t && git config user.name t', { cwd: dir })
  execSync('git add -A && git commit -q -m init --allow-empty', { cwd: dir })
}

describe('runBuildGraph — 분기 보강', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sdd-orch-'))
  })

  it('Dart language 분기 — DartParserAdapter 사용', async () => {
    // pubspec.yaml + lib/*.dart
    writeFileSync(join(tmp, 'pubspec.yaml'), 'name: hello\n')
    mkdirSync(join(tmp, 'lib'), { recursive: true })
    writeFileSync(
      join(tmp, 'lib/main.dart'),
      `class App { void run() { print('hi'); } }\n`,
    )
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, tmp, { language: 'dart', framework: 'flutter' })
    const { completion } = runBuildGraph({ repoId }, db)
    const result = await completion

    expect(result.files_count).toBeGreaterThan(0)
    expect(result.pending_edges).toBe(0)
  })

  it('Dart package name 없음 — pubspec read 실패해도 graph build는 진행한다', async () => {
    mkdirSync(join(tmp, 'lib'), { recursive: true })
    writeFileSync(
      join(tmp, 'lib/main.dart'),
      `class App { void run() { print('hi'); } }\n`,
    )
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, tmp, { language: 'dart', framework: 'flutter' })
    const { completion } = runBuildGraph({ repoId }, db)
    const result = await completion

    expect(result.files_count).toBeGreaterThan(0)
    expect(result.pending_edges).toBe(0)
  })

  it('signal 옵션 — abort되면 cancelled로 종료한다', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const x = 1\n')
    gitInitCommit(tmp)
    const db = createDb()
    const repoId = makeRepo(db, tmp)
    const ctrl = new AbortController()
    ctrl.abort()
    const { completion } = runBuildGraph({ repoId, signal: ctrl.signal }, db)
    await expect(completion).rejects.toThrow('aborted')
  })

  it('completion 내부 throw → run.finish(failed) → status="failed"', async () => {
    // 1만개 초과 파일을 만들어 F1에서 throw 유도하는 대신,
    // 더 단순하게 — repoPath 자체가 invalid (file이 아니라 비-디렉토리) → F1이 throw
    writeFileSync(join(tmp, 'not-a-dir.txt'), 'oops')
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, join(tmp, 'not-a-dir.txt'))
    const { runId, completion } = runBuildGraph({ repoId }, db)

    await expect(completion).rejects.toThrow()

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('failed')
    expect(run?.errorMessage).toBeTruthy()
  })

  it('NOT_ANALYZED — analyze_repo phase가 confirm되지 않으면 시작을 차단한다', () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const x = 1\n')
    gitInitCommit(tmp)
    const db = createDb()
    const repoId = makeRepo(db, tmp)
    db.update(repositoryPhaseStatus)
      .set({ confirmedAt: null })
      .where(eq(repositoryPhaseStatus.repositoryId, repoId))
      .run()

    expect(() => runBuildGraph({ repoId }, db)).toThrow(BuildGraphError)
    try {
      runBuildGraph({ repoId }, db)
    } catch (e) {
      expect((e as BuildGraphError).code).toBe('NOT_ANALYZED')
    }
  })

  it('BUILD_IN_FLIGHT — running build_graph run이 있으면 중복 시작을 차단한다', () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const x = 1\n')
    gitInitCommit(tmp)
    const db = createDb()
    const repoId = makeRepo(db, tmp)
    db.insert(pipelineRuns).values({
      id: 'running-build-graph',
      projectId: 'p',
      repoId,
      kind: 'build_graph',
      status: 'running',
      totalSteps: 7,
      completedSteps: 0,
    } as never).run()

    expect(() => runBuildGraph({ repoId }, db)).toThrow(BuildGraphError)
    try {
      runBuildGraph({ repoId }, db)
    } catch (e) {
      expect((e as BuildGraphError).code).toBe('BUILD_IN_FLIGHT')
    }
  })

  it('phase_status row 이미 존재 → UPDATE (UPSERT 분기)', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const x = 1\n')
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, tmp)

    // 1차 실행
    await runBuildGraph({ repoId }, db).completion

    // 2차 실행 — UPDATE 분기 도달
    await runBuildGraph({ repoId }, db).completion

    const phaseRow = db
      .select()
      .from(repositoryPhaseStatus)
      .where(eq(repositoryPhaseStatus.phase, 'build_graph'))
      .get()
    expect(phaseRow).toBeDefined()
    expect(phaseRow!.validity).toBe('fresh')
  })

  it('source file content hash를 file_cache에 upsert한다', async () => {
    const sourcePath = join(tmp, 'a.ts')
    writeFileSync(sourcePath, 'export const x = 1\n')
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, tmp)

    await runBuildGraph({ repoId }, db).completion
    const first = db
      .select()
      .from(fileCache)
      .where(eq(fileCache.filePath, 'a.ts'))
      .get()

    writeFileSync(sourcePath, 'export const x = 2\n')
    await runBuildGraph({ repoId }, db).completion
    const rows = db.select().from(fileCache).where(eq(fileCache.filePath, 'a.ts')).all()

    expect(first?.repoId).toBe(repoId)
    expect(first?.fileHash).toMatch(/^[a-f0-9]{64}$/)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.fileHash).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[0]!.fileHash).not.toBe(first!.fileHash)
  })

  it('REPO_DELETED — soft-deleted repo 호출 시 REPO_NOT_FOUND', () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const x = 1\n')
    gitInitCommit(tmp)
    const db = createDb()
    const repoId = makeRepo(db, tmp)
    const now = new Date().toISOString()
    // soft delete
    db.update(repositories).set({ deletedAt: now }).where(eq(repositories.id, repoId)).run()
    expect(() => runBuildGraph({ repoId }, db)).toThrow(BuildGraphError)
    try {
      runBuildGraph({ repoId }, db)
    } catch (e) {
      expect((e as BuildGraphError).code).toBe('REPO_NOT_FOUND')
    }
  })

  it('language=null fallback — typescript로 진행', async () => {
    writeFileSync(join(tmp, 'a.ts'), 'export const x = 1\n')
    gitInitCommit(tmp)

    const db = createDb()
    const now = new Date().toISOString()
    db.insert(projects).values({ id: 'p', name: 'p', createdAt: now, updatedAt: now }).run()
    db.insert(repositories)
      .values({
        id: 'r1',
        projectId: 'p',
        name: 'r',
        repoPath: tmp,
        // language 미설정
        createdAt: now,
        updatedAt: now,
      })
      .run()
    db.insert(repositoryPhaseStatus)
      .values({ repositoryId: 'r1', phase: 'analyze_repo', builtAt: now, validity: 'fresh', confirmedAt: now, updatedAt: now })
      .run()

    const { completion } = runBuildGraph({ repoId: 'r1' }, db)
    const r = await completion
    expect(r.files_count).toBeGreaterThan(0)
  })
})
