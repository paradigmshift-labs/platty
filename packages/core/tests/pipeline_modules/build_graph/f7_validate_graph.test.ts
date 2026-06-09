/**
 * F7: validateGraph — V2 Drizzle 단위 테스트
 *
 * V1 시나리오 흡수 (.tmp-v1-tests/f7_validate_graph.test.ts):
 *   §1 assertPendingZero (5)
 *   §2 checkFileNodeCount (4)
 *   §3 checkUnresolvedRatio (5)
 *   §4 validateGraph e2e (10)
 *
 * 변환:
 *   - DbAdapter raw SQL → Drizzle (sync)
 *   - throw 금지 → best-effort 0/false 반환 (V1 동일)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import {
  assertPendingZero,
  checkFileNodeCount,
  checkUnresolvedRatio,
  validateGraph,
  PARSE_ERROR_RATIO_THRESHOLD,
  UNRESOLVED_RATIO_THRESHOLD,
} from '@/pipeline_modules/build_graph/f7_validate_graph.js'

type DB = ReturnType<typeof drizzle<typeof schema>>

function createTestDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

function seedRepo(db: DB, repoId = 'r1'): void {
  const now = new Date().toISOString()
  db.insert(projects).values({ id: 'p1', name: 'p', createdAt: now, updatedAt: now }).onConflictDoNothing().run()
  db.insert(repositories)
    .values({ id: repoId, projectId: 'p1', name: 'r', repoPath: '/tmp', createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run()
}

function insertNode(db: DB, repoId: string, id: string, type: 'file' | 'function' = 'function') {
  db.insert(codeNodes)
    .values({ id, repoId, type, filePath: 'a.ts', name: id })
    .run()
}

function insertEdge(db: DB, repoId: string, sourceId: string, status: 'pending' | 'resolved' | 'failed' | 'external') {
  db.insert(codeEdges)
    .values({ repoId, sourceId, targetId: null, relation: 'calls', resolveStatus: status })
    .run()
}

// ────────────────────────────────────────────────
// §1 assertPendingZero
// ────────────────────────────────────────────────
describe('§1 assertPendingZero', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    seedRepo(db)
  })

  it('1-1: pending 0건 → 0', () => {
    insertNode(db, 'r1', 'r1:a:f1')
    insertEdge(db, 'r1', 'r1:a:f1', 'resolved')
    expect(assertPendingZero('r1', db)).toBe(0)
  })

  it('1-2: pending 3건 → 3', () => {
    insertNode(db, 'r1', 'r1:a:f1')
    insertEdge(db, 'r1', 'r1:a:f1', 'pending')
    insertEdge(db, 'r1', 'r1:a:f1', 'pending')
    insertEdge(db, 'r1', 'r1:a:f1', 'pending')
    expect(assertPendingZero('r1', db)).toBe(3)
  })

  it('1-3: 빈 그래프 → 0', () => {
    expect(assertPendingZero('r1', db)).toBe(0)
  })

  it('1-4: 다른 repo의 pending은 카운트 X', () => {
    seedRepo(db, 'r2')
    insertNode(db, 'r2', 'r2:a:f1')
    insertEdge(db, 'r2', 'r2:a:f1', 'pending')
    expect(assertPendingZero('r1', db)).toBe(0)
  })

  it('1-5: 잘못된 repoId (빈 문자열) → 0 (best-effort)', () => {
    expect(assertPendingZero('', db)).toBe(0)
  })
})

// ────────────────────────────────────────────────
// §2 checkFileNodeCount
// ────────────────────────────────────────────────
describe('§2 checkFileNodeCount', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    seedRepo(db)
  })

  it('2-1: file 노드 1개 → valid=true', () => {
    insertNode(db, 'r1', 'r1:a', 'file')
    const r = checkFileNodeCount('r1', db)
    expect(r.count).toBe(1)
    expect(r.valid).toBe(true)
  })

  it('2-2: file 노드 5개 → valid=true', () => {
    for (let i = 0; i < 5; i++) insertNode(db, 'r1', `r1:a${i}`, 'file')
    const r = checkFileNodeCount('r1', db)
    expect(r.count).toBe(5)
    expect(r.valid).toBe(true)
  })

  it('2-3: file 노드 0개 (function만) → valid=false', () => {
    insertNode(db, 'r1', 'r1:a:f', 'function')
    const r = checkFileNodeCount('r1', db)
    expect(r.count).toBe(0)
    expect(r.valid).toBe(false)
  })

  it('2-4: 다른 repo의 file은 카운트 X', () => {
    seedRepo(db, 'r2')
    insertNode(db, 'r2', 'r2:a', 'file')
    const r = checkFileNodeCount('r1', db)
    expect(r.count).toBe(0)
    expect(r.valid).toBe(false)
  })
})

// ────────────────────────────────────────────────
// §3 checkUnresolvedRatio
// ────────────────────────────────────────────────
describe('§3 checkUnresolvedRatio', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    seedRepo(db)
    insertNode(db, 'r1', 'r1:a:f')
  })

  it('3-1: failed 0%, total 10 → warning=null', () => {
    for (let i = 0; i < 10; i++) insertEdge(db, 'r1', 'r1:a:f', 'resolved')
    const r = checkUnresolvedRatio('r1', db)
    expect(r.failed).toBe(0)
    expect(r.total).toBe(10)
    expect(r.warning).toBeNull()
  })

  it('3-2: failed 비율 = threshold 미만 (29%) → warning=null', () => {
    for (let i = 0; i < 7; i++) insertEdge(db, 'r1', 'r1:a:f', 'resolved')
    for (let i = 0; i < 3; i++) insertEdge(db, 'r1', 'r1:a:f', 'failed')
    const r = checkUnresolvedRatio('r1', db)
    expect(r.ratio).toBeLessThanOrEqual(UNRESOLVED_RATIO_THRESHOLD)
    expect(r.warning).toBeNull()
  })

  it('3-3: failed 비율 > threshold (40%) → warning 메시지', () => {
    for (let i = 0; i < 6; i++) insertEdge(db, 'r1', 'r1:a:f', 'resolved')
    for (let i = 0; i < 4; i++) insertEdge(db, 'r1', 'r1:a:f', 'failed')
    const r = checkUnresolvedRatio('r1', db)
    expect(r.ratio).toBeGreaterThan(UNRESOLVED_RATIO_THRESHOLD)
    expect(r.warning).toMatch(/40\.0%/)
    expect(r.warning).toMatch(/4\/10/)
  })

  it('3-4: 빈 그래프 → ratio=0, warning=null', () => {
    const r = checkUnresolvedRatio('r1', db)
    expect(r.total).toBe(0)
    expect(r.warning).toBeNull()
  })

  it('3-5: external/pending은 failed 카운트 X', () => {
    insertEdge(db, 'r1', 'r1:a:f', 'external')
    insertEdge(db, 'r1', 'r1:a:f', 'pending')
    insertEdge(db, 'r1', 'r1:a:f', 'failed')
    const r = checkUnresolvedRatio('r1', db)
    expect(r.failed).toBe(1)
    expect(r.total).toBe(3)
  })
})

// ────────────────────────────────────────────────
// §4 validateGraph e2e
// ────────────────────────────────────────────────
describe('§4 validateGraph e2e', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    seedRepo(db)
  })

  it('4-1: 정상 — pending=0 + file 노드 ≥ 1 + parse/unresolved 정상 → valid=true, warnings=[]', () => {
    insertNode(db, 'r1', 'r1:a', 'file')
    insertNode(db, 'r1', 'r1:a:f')
    insertEdge(db, 'r1', 'r1:a:f', 'resolved')
    const r = validateGraph('r1', 1, 0, db)
    expect(r.valid).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.pending_edges).toBe(0)
  })

  it('4-2: pending 잔류 → valid=false + 메시지 + pending_edges 카운트', () => {
    insertNode(db, 'r1', 'r1:a', 'file')
    insertNode(db, 'r1', 'r1:a:f')
    insertEdge(db, 'r1', 'r1:a:f', 'pending')
    insertEdge(db, 'r1', 'r1:a:f', 'pending')
    const r = validateGraph('r1', 1, 0, db)
    expect(r.valid).toBe(false)
    expect(r.pending_edges).toBe(2)
    expect(r.warnings[0]).toMatch(/pending edge 2건/)
  })

  it('4-3: file 노드 0개 → valid=false', () => {
    insertNode(db, 'r1', 'r1:a:f')
    const r = validateGraph('r1', 1, 0, db)
    expect(r.valid).toBe(false)
    expect(r.warnings.some((w) => w.includes('file 노드 0개'))).toBe(true)
  })

  it('4-4: parseRatio > threshold → warning', () => {
    insertNode(db, 'r1', 'r1:a', 'file')
    const r = validateGraph('r1', 10, 2, db) // 20% > 10%
    expect(r.warnings.some((w) => w.includes('파싱 실패율'))).toBe(true)
    // valid에 영향 X — file 노드 1개 있으므로 valid=true
    expect(r.valid).toBe(true)
  })

  it('4-5: parseRatio = threshold → warning 없음', () => {
    insertNode(db, 'r1', 'r1:a', 'file')
    const r = validateGraph('r1', 10, 1, db) // 10% = threshold (>가 아님)
    expect(r.warnings.some((w) => w.includes('파싱 실패율'))).toBe(false)
  })

  it('4-6: unresolved 비율 > threshold → warning', () => {
    insertNode(db, 'r1', 'r1:a', 'file')
    insertNode(db, 'r1', 'r1:a:f')
    for (let i = 0; i < 4; i++) insertEdge(db, 'r1', 'r1:a:f', 'failed')
    for (let i = 0; i < 6; i++) insertEdge(db, 'r1', 'r1:a:f', 'resolved')
    const r = validateGraph('r1', 1, 0, db)
    expect(r.warnings.some((w) => w.includes('해석 실패 edge 비율'))).toBe(true)
    expect(r.valid).toBe(true)
  })

  it('4-7: pending + file 0 + parseRatio 큼 → 다중 warnings 순서 (pending → file → parse)', () => {
    insertNode(db, 'r1', 'r1:a:f') // file 노드 없음
    insertEdge(db, 'r1', 'r1:a:f', 'pending')
    const r = validateGraph('r1', 10, 5, db)
    expect(r.warnings[0]).toMatch(/pending edge/)
    expect(r.warnings[1]).toMatch(/file 노드 0개/)
    expect(r.warnings[2]).toMatch(/파싱 실패율/)
    expect(r.valid).toBe(false)
  })

  it('4-8: repoId 빈 문자열 → valid=false, warnings=[empty repoId message]', () => {
    const r = validateGraph('', 1, 0, db)
    expect(r.valid).toBe(false)
    expect(r.warnings).toEqual(['repoId is empty'])
    expect(r.pending_edges).toBe(0)
  })

  it('4-9: totalFiles=0 (parse ratio 무시)', () => {
    insertNode(db, 'r1', 'r1:a', 'file')
    const r = validateGraph('r1', 0, 0, db)
    expect(r.warnings.some((w) => w.includes('파싱 실패율'))).toBe(false)
  })

  it('4-10: 임계값 상수 노출', () => {
    expect(PARSE_ERROR_RATIO_THRESHOLD).toBe(0.10)
    expect(UNRESOLVED_RATIO_THRESHOLD).toBe(0.30)
  })
})
