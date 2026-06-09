/**
 * F2: parseModels 테스트
 * SOT: specs/build_models/specs/f2_parse_models/spec.md
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import { parseModels } from '@/pipeline_modules/build_models/f2_parse_models.js'
import type {
  LoadedSource,
  ModelRaw,
  BuildModelsAdapter,
  SchemaFile,
  SchemaChunk,
} from '@/pipeline_modules/build_models/types.js'
import type { SchemaSource } from '@/db/schema/json_types/schema_source.js'

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const REPO_PATH = '/repo/myproject'
const REPO_ID = 'repo1'
const DB = null as any

// ─── Fixture helpers ───────────────────────────────────────────────────────────

function makeSource(orm: string, paths: string[] = []): SchemaSource {
  return { orm, schema_paths: paths, provider: null, label: 'main' }
}

function makeModel(name: string): ModelRaw {
  return {
    name,
    table_name: name.toLowerCase(),
    comment: '',
    fields: [],
    relations: [],
    source_file: null,
    line_start: null,
    line_end: null,
    is_deprecated: false,
  }
}

function makeDslAdapter(
  models: ModelRaw[] = [],
  options: { collectNamesThrows?: Error; parseChunkThrows?: Error } = {},
): BuildModelsAdapter {
  return {
    orm: 'prisma',
    strategy: 'dsl-parse',
    ensureReady: vi.fn().mockResolvedValue(undefined),
    collectNames: options.collectNamesThrows
      ? vi.fn().mockImplementation(() => { throw options.collectNamesThrows })
      : vi.fn().mockReturnValue({ enumNames: new Set(), modelNames: new Set(), compositeTypeNames: new Set() }),
    prepareChunks: vi.fn().mockImplementation((files: SchemaFile[]) =>
      [{ files, orm: 'prisma' }] as SchemaChunk[],
    ),
    parseChunk: options.parseChunkThrows
      ? vi.fn().mockRejectedValue(options.parseChunkThrows)
      : vi.fn().mockResolvedValue(models),
  }
}

function makeGraphAdapter(models: ModelRaw[] = [], throws?: Error): BuildModelsAdapter {
  return {
    orm: 'typeorm',
    strategy: 'graph-query',
    queryFromGraph: throws
      ? vi.fn().mockRejectedValue(throws)
      : vi.fn().mockResolvedValue(models),
  }
}

function makeDslLoaded(adapter: BuildModelsAdapter, absolutePaths: string[]): LoadedSource {
  return {
    source: makeSource('prisma', absolutePaths.map(p => path.relative(REPO_PATH, p))),
    adapter,
    strategy: 'dsl-parse',
    absolutePaths,
  }
}

function makeGraphLoaded(adapter: BuildModelsAdapter): LoadedSource {
  return {
    source: makeSource('typeorm', []),
    adapter,
    strategy: 'graph-query',
    absolutePaths: [],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('parseModels', () => {
  // TC#1
  it('TC#1: loaded=[] → { bySource: [], skippedFiles: [] }', async () => {
    const result = await parseModels([], DB, REPO_ID, REPO_PATH)
    expect(result).toEqual({ bySource: [], skippedFiles: [] })
  })

  // TC#2
  it('TC#2: prisma DSL happy path → bySource 1개, skippedFiles=[]', async () => {
    const models = [makeModel('User'), makeModel('Post')]
    const adapter = makeDslAdapter(models)
    const absPath = `${REPO_PATH}/prisma/schema.prisma`

    vi.spyOn(fs, 'readFileSync').mockReturnValue('model User {}')

    const loaded = [makeDslLoaded(adapter, [absPath])]
    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(1)
    expect(result.bySource[0].source.orm).toBe('prisma')
    expect(result.bySource[0].models).toHaveLength(2)
    expect(result.skippedFiles).toEqual([])
  })

  // TC#3
  it('TC#3: typeorm graph-query happy path → bySource 1개, skippedFiles=[]', async () => {
    const models = [makeModel('Order'), makeModel('Product')]
    const adapter = makeGraphAdapter(models)
    const loaded = [makeGraphLoaded(adapter)]
    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(1)
    expect(result.bySource[0].source.orm).toBe('typeorm')
    expect(result.bySource[0].models).toHaveLength(2)
    expect(result.skippedFiles).toEqual([])
  })

  // TC#4
  it('TC#4: prisma + typeorm 두 source → bySource 2개, 순서 유지', async () => {
    const prismaModels = [makeModel('User')]
    const typeormModels = [makeModel('Order')]

    vi.spyOn(fs, 'readFileSync').mockReturnValue('schema content')

    const prismaAdapter = makeDslAdapter(prismaModels)
    const typeormAdapter = makeGraphAdapter(typeormModels)

    const loaded = [
      makeDslLoaded(prismaAdapter, [`${REPO_PATH}/prisma/schema.prisma`]),
      makeGraphLoaded(typeormAdapter),
    ]
    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(2)
    expect(result.bySource[0].source.orm).toBe('prisma')
    expect(result.bySource[0].models).toHaveLength(1)
    expect(result.bySource[1].source.orm).toBe('typeorm')
    expect(result.bySource[1].models).toHaveLength(1)
    expect(result.skippedFiles).toEqual([])
  })

  // TC#5
  it('TC#5: 파일 읽기 실패 → skippedFiles=[상대경로], source bySource 미포함', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('ENOENT: no such file') })

    const adapter = makeDslAdapter([])
    const absPath = `${REPO_PATH}/prisma/schema.prisma`
    const loaded = [makeDslLoaded(adapter, [absPath])]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(0)
    expect(result.skippedFiles).toContain('prisma/schema.prisma')
  })

  // TC#6
  it('TC#6: parseChunk throw → skippedFiles=[파일 상대경로], source bySource 미포함', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(fs, 'readFileSync').mockReturnValue('schema content')

    const adapter = makeDslAdapter([], { parseChunkThrows: new Error('parse failed') })
    const absPath = `${REPO_PATH}/prisma/schema.prisma`
    const loaded = [makeDslLoaded(adapter, [absPath])]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(0)
    expect(result.skippedFiles).toContain('prisma/schema.prisma')
  })

  // TC#7
  it('TC#7: graph-query throw → skippedFiles=["[typeorm:graph-query]"], source 미포함', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const adapter = makeGraphAdapter([], new Error('DB error'))
    const loaded = [makeGraphLoaded(adapter)]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(0)
    expect(result.skippedFiles).toContain('[typeorm:graph-query]')
  })

  // TC#8
  it('TC#8: 501개 모델 → 500개 cap, skippedFiles=["__truncated__"]', async () => {
    const models = Array.from({ length: 501 }, (_, i) => makeModel(`Model${i}`))
    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const adapter = makeDslAdapter(models)
    const loaded = [makeDslLoaded(adapter, [`${REPO_PATH}/prisma/schema.prisma`])]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    const totalModels = result.bySource.reduce((sum, s) => sum + s.models.length, 0)
    expect(totalModels).toBe(500)
    expect(result.skippedFiles).toContain('__truncated__')
  })

  // TC#9
  it('TC#9: signal.aborted=true 루프 진입 전 → { bySource: [], skippedFiles: [] }', async () => {
    const controller = new AbortController()
    controller.abort()

    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')
    const adapter = makeDslAdapter([makeModel('User')])
    const loaded = [makeDslLoaded(adapter, [`${REPO_PATH}/prisma/schema.prisma`])]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH, controller.signal)

    expect(result.bySource).toHaveLength(0)
    expect(result.skippedFiles).toHaveLength(0)
  })

  // TC#10
  it('TC#10: src0 완료 후 signal.aborted → bySource=[src0], src1 미처리', async () => {
    const controller = new AbortController()

    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')

    const adapter0: BuildModelsAdapter = {
      orm: 'prisma',
      strategy: 'dsl-parse',
      ensureReady: vi.fn().mockResolvedValue(undefined),
      collectNames: vi.fn().mockReturnValue({
        enumNames: new Set(), modelNames: new Set(), compositeTypeNames: new Set(),
      }),
      prepareChunks: vi.fn().mockImplementation((files: SchemaFile[]) => [{ files, orm: 'prisma' }]),
      parseChunk: vi.fn().mockImplementation(async () => {
        controller.abort()
        return [makeModel('User')]
      }),
    }
    const queryFromGraphSpy = vi.fn().mockResolvedValue([makeModel('Order')])
    const adapter1: BuildModelsAdapter = {
      orm: 'typeorm',
      strategy: 'graph-query',
      queryFromGraph: queryFromGraphSpy,
    }

    const loaded = [
      makeDslLoaded(adapter0, [`${REPO_PATH}/prisma/schema.prisma`]),
      makeGraphLoaded(adapter1),
    ]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH, controller.signal)

    expect(result.bySource).toHaveLength(1)
    expect(result.bySource[0].source.orm).toBe('prisma')
    expect(queryFromGraphSpy).not.toHaveBeenCalled()
  })

  // TC#11
  it('TC#11: 두 source에서 동일 모델명 → 첫 번째 유지, 두 번째 중복 제외, 빈 source bySource에 포함', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')

    const prismaModels = [makeModel('User'), makeModel('Post')]
    const typeormModels = [makeModel('User')] // 중복

    const prismaAdapter = makeDslAdapter(prismaModels)
    const typeormAdapter = makeGraphAdapter(typeormModels)

    const loaded = [
      makeDslLoaded(prismaAdapter, [`${REPO_PATH}/prisma/schema.prisma`]),
      makeGraphLoaded(typeormAdapter),
    ]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(2)
    expect(result.bySource[0].models).toHaveLength(2) // User + Post
    expect(result.bySource[1].models).toHaveLength(0) // User 중복 제외 → 빈 source (F2-8)
  })

  // TC#12
  it('TC#12: collectNames throw → source bySource 미포함, skippedFiles=absolutePaths 상대경로', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')

    const adapter = makeDslAdapter([], { collectNamesThrows: new Error('collectNames failed') })
    const absPath = `${REPO_PATH}/prisma/schema.prisma`
    const loaded = [makeDslLoaded(adapter, [absPath])]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    expect(result.bySource).toHaveLength(0)
    expect(result.skippedFiles).toContain('prisma/schema.prisma')
  })

  // TC#13
  it('TC#13: prisma(500) + typeorm(100) → truncate 후 typeorm bySource 제외, skippedFiles=["__truncated__"]', async () => {
    const prismaModels = Array.from({ length: 500 }, (_, i) => makeModel(`PrismaModel${i}`))
    const typeormModels = Array.from({ length: 100 }, (_, i) => makeModel(`TypeormModel${i}`))

    vi.spyOn(fs, 'readFileSync').mockReturnValue('content')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const prismaAdapter = makeDslAdapter(prismaModels)
    const typeormAdapter = makeGraphAdapter(typeormModels)

    const loaded = [
      makeDslLoaded(prismaAdapter, [`${REPO_PATH}/prisma/schema.prisma`]),
      makeGraphLoaded(typeormAdapter),
    ]

    const result = await parseModels(loaded, DB, REPO_ID, REPO_PATH)

    const totalModels = result.bySource.reduce((sum, s) => sum + s.models.length, 0)
    expect(totalModels).toBe(500)

    const prismaEntry = result.bySource.find(s => s.source.orm === 'prisma')
    const typeormEntry = result.bySource.find(s => s.source.orm === 'typeorm')
    expect(prismaEntry).toBeDefined()
    expect(prismaEntry!.models).toHaveLength(500)
    expect(typeormEntry).toBeUndefined() // F2-8: truncate 후 models=0 entry 제외

    expect(result.skippedFiles).toContain('__truncated__')
  })
})
