/**
 * PrismaAdapter 야생 스키마 E2E 테스트
 *
 * 실제 오픈소스 프로젝트의 Prisma 스키마를 파싱하여 파서 견고성 검증.
 * fixtures/ 하위 디렉터리를 자동 탐색 — 새 픽스처 추가 시 테스트 코드 수정 불필요.
 *
 * 픽스처 다운로드: npx tsx scripts/download-prisma-fixtures.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaAdapter } from '@/pipeline_modules/build_models/adapters/prisma.js'
import type { ModelRaw } from '@/pipeline_modules/build_models/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// M5: tests/pipeline_modules/build_models/e2e/fixtures → tests/fixtures/corpus/repo/orm-e2e
const FIXTURES_DIR = join(process.cwd(), 'tests/fixtures/corpus/repo/orm-e2e')
void __dirname

interface FixtureMeta {
  source: string
  description: string
  downloadedAt: string
  expectedModelCount: number | null
  expectedEnumCount: number | null
}

const fixtureNames = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort()

if (fixtureNames.length === 0) {
  throw new Error(
    'E2E 픽스처 없음. 먼저 실행: npx tsx scripts/download-prisma-fixtures.ts',
  )
}

// ─── 단일 adapter 인스턴스 (tree-sitter 파서 공유) ────────────────────────────

const adapter = new PrismaAdapter()

beforeAll(async () => {
  await adapter.ensureReady()
}, 30_000)

// ─── 픽스처별 테스트 ──────────────────────────────────────────────────────────

describe.each(fixtureNames)('PrismaAdapter E2E — %s', (name) => {
  const fixturePath = join(FIXTURES_DIR, name)
  let meta: FixtureMeta
  let models: ModelRaw[]
  let parseError: Error | null = null
  let parseMs: number

  beforeAll(async () => {
    meta = JSON.parse(readFileSync(join(fixturePath, 'meta.json'), 'utf-8'))

    const schemaFiles = readdirSync(fixturePath)
      .filter(f => f.endsWith('.prisma'))
      .map(f => ({
        path: join(fixturePath, f),
        content: readFileSync(join(fixturePath, f), 'utf-8'),
      }))

    if (schemaFiles.length === 0) {
      throw new Error(`No .prisma files in ${fixturePath}`)
    }

    const t0 = Date.now()
    try {
      const ctx = adapter.collectNames(schemaFiles)
      const chunks = adapter.prepareChunks(schemaFiles)
      const results = await Promise.all(chunks.map(chunk => adapter.parseChunk(chunk, ctx)))
      models = results.flat()
    } catch (err) {
      parseError = err as Error
      models = []
    }
    parseMs = Date.now() - t0
  }, 60_000)

  it('파싱 성공 (예외 없음)', () => {
    expect(parseError, parseError?.message).toBeNull()
  })

  it('모델 1개 이상 추출', () => {
    expect(models.length).toBeGreaterThan(0)
  })

  it('모든 모델에 name, table_name, fields, relations 존재', () => {
    for (const m of models) {
      expect(m.name, `model.name 누락`).toBeTruthy()
      expect(m.table_name, `${m.name}.table_name 누락`).toBeTruthy()
      expect(Array.isArray(m.fields), `${m.name}.fields 배열 아님`).toBe(true)
      expect(Array.isArray(m.relations), `${m.name}.relations 배열 아님`).toBe(true)
    }
  })

  it('관계 있는 모델의 fk_fields는 배열이거나 undefined', () => {
    for (const m of models) {
      for (const r of m.relations) {
        if (r.fk_fields !== undefined) {
          expect(Array.isArray(r.fk_fields), `${m.name}.${r.name}.fk_fields 배열 아님`).toBe(true)
        }
      }
    }
  })

  it('파싱 시간 5s 이내', () => {
    expect(parseMs).toBeLessThan(5_000)
  })

  it('expectedModelCount 일치 (meta에 설정된 경우)', () => {
    if (meta.expectedModelCount != null) {
      expect(models.length).toBe(meta.expectedModelCount)
    } else {
      console.log(`  [${name}] 모델 ${models.length}개, 소요 ${parseMs}ms — meta.json에 expectedModelCount 추가 가능`)
    }
  })
})
