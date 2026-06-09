/**
 * 커버리지 보강 테스트 — 도달 어려운 catch/throw 분기 강제 검증
 *
 * 대상:
 *   - F6 persistGraph 에러 시 PRAGMA ON 복원 (finally 분기)
 *   - F7 outer try-catch (DB closed 등 — best-effort 0/false 반환)
 *   - F1 fs error 분기 (vi.spyOn으로 readFile/stat 강제 throw)
 *   - types.ts getLanguageConfig fallback (unknown language → typescript)
 *
 * F2 size limit (500K nodes, 2M edges)는 메모리 부담으로 보강 제외 — 라인 339-343 미커버 수용.
 */
import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as nodeFs from 'node:fs'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as schema from '@/db/schema/index.js'
import { persistGraph } from '@/pipeline_modules/build_graph/f6_persist_graph.js'
import {
  validateGraph,
  assertPendingZero,
  checkUnresolvedRatio,
} from '@/pipeline_modules/build_graph/f7_validate_graph.js'
import { getLanguageConfig } from '@/pipeline_modules/build_graph/types.js'
import { filterSafeFile } from '@/pipeline_modules/build_graph/f1_collect_source_files.js'

type DB = ReturnType<typeof drizzle<typeof schema>>

function createDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

// ────────────────────────────────────────────────
// F6 persistGraph — finally PRAGMA 복원
// ────────────────────────────────────────────────
describe('F6 persistGraph — finally PRAGMA 복원', () => {
  it('트랜잭션 내부 throw → PRAGMA foreign_keys=ON 복원', async () => {
    const db = createDb()
    // PK conflict 강제: 같은 id 두 번
    const node = {
      id: 'r1:a:f',
      repo_id: 'r1',
      type: 'function' as const,
      file_path: 'a',
      name: 'f',
      line_start: null,
      line_end: null,
      signature: null,
      exported: false,
      parse_status: 'ok' as const,
      is_test: false,
      test_type: null,
      is_async: false,
      jsdoc: null,
    }
    await expect(persistGraph('r1', [node, node], [], db)).rejects.toThrow()

    const rawSqlite = (db as unknown as { $client: { pragma: (s: string) => Array<{ foreign_keys: number }> } }).$client
    const fk = rawSqlite.pragma('foreign_keys')
    expect(fk[0].foreign_keys).toBe(1)
  })
})

// ────────────────────────────────────────────────
// F7 — best-effort error handling
// ────────────────────────────────────────────────
describe('F7 — best-effort error handling', () => {
  it('validateGraph: DB closed → best-effort {valid:false,...}', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: './src/db/migrations' })
    sqlite.close()

    const r = validateGraph('r1', 1, 0, db)
    expect(r.valid).toBe(false)
    expect(r.pending_edges).toBe(0)
  })

  it('assertPendingZero: DB closed → 0', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: './src/db/migrations' })
    sqlite.close()
    expect(assertPendingZero('r1', db)).toBe(0)
  })

  it('checkUnresolvedRatio: total=0 → warning=null', () => {
    const db = createDb()
    const r = checkUnresolvedRatio('r1', db)
    expect(r.warning).toBeNull()
    expect(r.total).toBe(0)
  })
})

// ────────────────────────────────────────────────
// types.ts getLanguageConfig fallback
// ────────────────────────────────────────────────
describe('getLanguageConfig fallback', () => {
  it('unknown language → typescript fallback', () => {
    const cfg = getLanguageConfig('unknown')
    expect(cfg.glob).toContain('**/*.{ts,tsx,js,jsx,mdx,vue,svelte,astro}')
  })

  it('null → typescript fallback', () => {
    const cfg = getLanguageConfig(null)
    expect(cfg.glob).toContain('**/*.{ts,tsx,js,jsx,mdx,vue,svelte,astro}')
  })

  it('dart → dart config', () => {
    const cfg = getLanguageConfig('dart')
    expect(cfg.glob).toBe('**/*.dart')
  })

  it('java → java config', () => {
    const cfg = getLanguageConfig('java')
    expect(cfg.glob).toBe('**/*.java')
    expect(cfg.testPattern.test('src/test/java/AppTest.java')).toBe(true)
  })

  it('kotlin → kotlin config', () => {
    const cfg = getLanguageConfig('kotlin')
    expect(cfg.glob).toBe('**/*.kt')
    expect(cfg.testPattern.test('src/test/kotlin/AppTest.kt')).toBe(true)
  })
})

// ────────────────────────────────────────────────
// F1 — fs error catch 분기 (vi.spyOn 활용)
// ────────────────────────────────────────────────
describe('F1 filterSafeFile — fs error catch 분기', () => {
  it('readFile 실패 → null', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-f1-rd-')))
    writeFileSync(join(tmp, 'a.ts'), 'x')

    const spy = vi.spyOn(nodeFs.promises, 'readFile').mockImplementationOnce(() => {
      const err = new Error('ENOENT') as Error & { code: string }
      err.code = 'ENOENT'
      return Promise.reject(err)
    })
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const r = await filterSafeFile(tmp, 'a.ts')
    expect(r).toBeNull()
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('stat 실패 → null', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-f1-st-')))
    writeFileSync(join(tmp, 'a.ts'), 'x')

    const spy = vi.spyOn(nodeFs.promises, 'stat').mockImplementationOnce(() => {
      const err = new Error('EACCES') as Error & { code: string }
      err.code = 'EACCES'
      return Promise.reject(err)
    })
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const r = await filterSafeFile(tmp, 'a.ts')
    expect(r).toBeNull()
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('realpath 실패 → null', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-f1-rp-')))
    writeFileSync(join(tmp, 'a.ts'), 'x')

    const spy = vi.spyOn(nodeFs.promises, 'realpath').mockImplementationOnce(() => {
      const err = new Error('EIO') as Error & { code: string }
      err.code = 'EIO'
      return Promise.reject(err)
    })
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const r = await filterSafeFile(tmp, 'a.ts')
    expect(r).toBeNull()
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
    consoleSpy.mockRestore()
  })

  it('fs 실패 객체에 code/message가 없어도 unknown으로 안전하게 skip', async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-f1-unknown-')))
    writeFileSync(join(tmp, 'a.ts'), 'x')
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const realpathSpy = vi.spyOn(nodeFs.promises, 'realpath').mockRejectedValueOnce({})
    expect(await filterSafeFile(tmp, 'a.ts')).toBeNull()
    realpathSpy.mockRestore()

    const statSpy = vi.spyOn(nodeFs.promises, 'stat').mockRejectedValueOnce({})
    expect(await filterSafeFile(tmp, 'a.ts')).toBeNull()
    statSpy.mockRestore()

    const readSpy = vi.spyOn(nodeFs.promises, 'readFile').mockRejectedValueOnce({})
    expect(await filterSafeFile(tmp, 'a.ts')).toBeNull()
    readSpy.mockRestore()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unknown'))
    consoleSpy.mockRestore()
  })
})
