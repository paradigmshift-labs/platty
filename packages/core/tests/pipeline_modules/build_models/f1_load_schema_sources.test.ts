import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { loadSchemaSources, assertWithinRepoPath } from '@/pipeline_modules/build_models/f1_load_schema_sources.js'
import type { BuildModelsAdapter } from '@/pipeline_modules/build_models/types.js'
import type { SchemaSource } from '@/db/schema/json_types/schema_source.js'

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

const REPO_PATH = '/repo/myproject'

function makeDslAdapter(): BuildModelsAdapter {
  return { orm: 'prisma', strategy: 'dsl-parse' }
}

function makeGraphAdapter(): BuildModelsAdapter {
  return { orm: 'typeorm', strategy: 'graph-query' }
}

function makeRegistry(entries: [string, () => BuildModelsAdapter][] = []): Map<string, () => BuildModelsAdapter> {
  return new Map(entries)
}

function makeSource(orm: string, paths: string[] = [], label = 'main'): SchemaSource {
  return { orm, schema_paths: paths, provider: null, label }
}

function makeRepo(schemaSources: SchemaSource[] | null, repoPath = REPO_PATH) {
  return { id: 'repo1', repoPath, schemaSources }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('loadSchemaSources', () => {
  // TC#1 — schemaSources=null → []
  it('TC#1: schemaSources=null → [] 반환', () => {
    const repo = makeRepo(null)
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)
    expect(result).toEqual([])
  })

  // TC#2 — schemaSources=[] → []
  it('TC#2: schemaSources=[] → [] 반환', () => {
    const repo = makeRepo([])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)
    expect(result).toEqual([])
  })

  // TC#3 — prisma DSL happy path
  it('TC#3: prisma dsl-parse happy path → LoadedSource 1개, absolutePaths 설정', () => {
    const repo = makeRepo([makeSource('prisma', ['prisma/schema.prisma'])])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(1)
    expect(result[0].strategy).toBe('dsl-parse')
    expect(result[0].absolutePaths).toHaveLength(1)
    expect(result[0].absolutePaths[0]).toBe(path.join(REPO_PATH, 'prisma/schema.prisma'))
    expect(result[0].adapter.orm).toBe('prisma')
  })

  it('TC#3b: sourceRoot repo → schema_paths are resolved from analysisRoot', () => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-model-monorepo-'))
    fs.mkdirSync(path.join(repoPath, 'apps/api/prisma'), { recursive: true })
    fs.writeFileSync(path.join(repoPath, 'apps/api/prisma/schema.prisma'), 'model User { id String @id }')
    const repo = {
      ...makeRepo([makeSource('prisma', ['prisma/schema.prisma'])], repoPath),
      sourceRoot: 'apps/api',
      analysisWorktreePath: null,
    }
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(1)
    expect(result[0].absolutePaths).toEqual([
      path.join(repoPath, 'apps/api/prisma/schema.prisma'),
    ])
  })

  // TC#4 — typeorm graph-query → absolutePaths=[]
  it('TC#4: typeorm graph-query → LoadedSource 1개, absolutePaths=[]', () => {
    const repo = makeRepo([makeSource('typeorm', [])])
    const registry = makeRegistry([['typeorm', makeGraphAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(1)
    expect(result[0].strategy).toBe('graph-query')
    expect(result[0].absolutePaths).toEqual([])
  })

  // TC#5 — 미지원 ORM → skip + warn
  it('TC#5: 미지원 ORM "mongodb" → [] + warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = makeRepo([makeSource('mongodb', [])])
    const registry = makeRegistry([])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  // TC#6 — DSL schema_paths 빈 배열 → skip + warn
  it('TC#6: prisma schema_paths=[] → [] + warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = makeRepo([makeSource('prisma', [])])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  // TC#7 — [prisma, typeorm] 두 개 → 2개 순서 보존
  it('TC#7: [prisma, typeorm] → LoadedSource 2개, 순서 보존', () => {
    const repo = makeRepo([
      makeSource('prisma', ['prisma/schema.prisma']),
      makeSource('typeorm', []),
    ])
    const registry = makeRegistry([
      ['prisma', makeDslAdapter],
      ['typeorm', makeGraphAdapter],
    ])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(2)
    expect(result[0].adapter.orm).toBe('prisma')
    expect(result[1].adapter.orm).toBe('typeorm')
  })

  // TC#8 — prisma 두 개 (multi-schema)
  it('TC#8: prisma 두 개 (multi-schema) → LoadedSource 2개', () => {
    const repo = makeRepo([
      makeSource('prisma', ['prisma/main.prisma'], 'main'),
      makeSource('prisma', ['prisma/analytics.prisma'], 'analytics'),
    ])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(2)
    expect(result[0].source.label).toBe('main')
    expect(result[1].source.label).toBe('analytics')
  })

  // TC#9 — 상대경로 → path.join(repoPath, p)
  it('TC#9: 상대경로 → absolutePaths = path.join(repoPath, p)', () => {
    const repo = makeRepo([makeSource('prisma', ['./prisma/schema.prisma'])])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result[0].absolutePaths[0]).toBe(path.join(REPO_PATH, './prisma/schema.prisma'))
  })

  // TC#10 — 이미 절대경로이고 repoPath 내부 → 그대로 통과
  it('TC#10: repoPath 내부 절대경로 → 그대로 absolutePaths에 포함', () => {
    const absPath = `${REPO_PATH}/prisma/schema.prisma`
    const repo = makeRepo([makeSource('prisma', [absPath])])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result[0].absolutePaths[0]).toBe(absPath)
  })

  // TC#11 — ../../etc/passwd (상대경로 traversal) → skip + warn
  it('TC#11: "../../etc/passwd" 상대경로 Path Traversal → skip + warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = makeRepo([makeSource('prisma', ['../../etc/passwd'])])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  // TC#12 — 절대경로이나 repoPath 외부 → skip + warn
  it('TC#12: repoPath 외부 절대경로 /etc/passwd → skip + warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = makeRepo([makeSource('prisma', ['/etc/passwd'])])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  // TC#13 — 복수 경로 중 하나가 traversal → source 전체 skip
  it('TC#13: 복수 경로 중 하나 traversal → source 전체 skip', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repo = makeRepo([makeSource('prisma', ['prisma/schema.prisma', '../../etc/passwd'])])
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('TC#14: DSL glob schema_paths → 실제 파일 목록으로 확장', () => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-model-glob-'))
    fs.mkdirSync(path.join(repoPath, 'src/cats/schemas'), { recursive: true })
    fs.mkdirSync(path.join(repoPath, 'src/event/schemas'), { recursive: true })
    fs.writeFileSync(path.join(repoPath, 'src/cats/schemas/cat.schema.ts'), 'export class Cat {}')
    fs.writeFileSync(path.join(repoPath, 'src/event/schemas/event.schema.ts'), 'export class Event {}')

    const repo = makeRepo([makeSource('mongoose', ['src/**/*.schema.ts'])], repoPath)
    const registry = makeRegistry([['mongoose', () => ({ orm: 'mongoose', strategy: 'dsl-parse' })]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(1)
    expect(result[0].absolutePaths).toEqual([
      path.join(repoPath, 'src/cats/schemas/cat.schema.ts'),
      path.join(repoPath, 'src/event/schemas/event.schema.ts'),
    ])
  })

  it('TC#14b: 절대 glob schema_paths → repoPath cwd 없이 실제 파일 목록으로 확장', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-model-absolute-glob-repo-'))
    const schemaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-model-absolute-glob-schema-'))
    fs.writeFileSync(path.join(schemaRoot, 'schema.prisma'), 'model User { id String @id }')

    const repo = makeRepo([makeSource('prisma', [path.join(schemaRoot, '*.prisma')])], repoPath)
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('TC#15: prisma schema_paths가 디렉터리면 하위 .prisma 파일로 확장', () => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-model-prisma-folder-'))
    fs.mkdirSync(path.join(repoPath, 'src/prisma/schema'), { recursive: true })
    fs.writeFileSync(path.join(repoPath, 'src/prisma/schema/schema.prisma'), 'datasource db { provider = "postgresql" }')
    fs.writeFileSync(path.join(repoPath, 'src/prisma/schema/user.prisma'), 'model User { id String @id }')
    fs.writeFileSync(path.join(repoPath, 'src/prisma/schema/README.md'), 'ignore me')

    const repo = makeRepo([makeSource('prisma', ['./src/prisma/schema'])], repoPath)
    const registry = makeRegistry([['prisma', makeDslAdapter]])
    const result = loadSchemaSources(repo, registry)

    expect(result).toHaveLength(1)
    expect(result[0].absolutePaths).toEqual([
      path.join(repoPath, 'src/prisma/schema/schema.prisma'),
      path.join(repoPath, 'src/prisma/schema/user.prisma'),
    ])
  })
})

describe('assertWithinRepoPath', () => {
  it('repoPath 내부 경로 → true', () => {
    expect(assertWithinRepoPath('/repo', '/repo/src/file.ts')).toBe(true)
  })

  it('repoPath와 동일 경로 → true', () => {
    expect(assertWithinRepoPath('/repo', '/repo')).toBe(true)
  })

  it('repoPath 외부 경로 → false', () => {
    expect(assertWithinRepoPath('/repo', '/etc/passwd')).toBe(false)
  })

  it('null byte 포함 경로 → false', () => {
    expect(assertWithinRepoPath('/repo', '/repo/file\x00.ts')).toBe(false)
  })

  it('부모 디렉토리 탈출 → false', () => {
    expect(assertWithinRepoPath('/repo', '/repo/../etc/passwd')).toBe(false)
  })
})
