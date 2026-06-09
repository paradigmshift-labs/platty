import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import fg from 'fast-glob'
import {
  runGlobWithTimeout,
  validatePaths,
} from '@/pipeline_modules/analyze_repo/f3_validate_paths.js'
import type { StackInfo } from '@/pipeline_modules/analyze_repo/types.js'

vi.mock('fast-glob', () => ({ default: vi.fn() }))

const fgMock = vi.mocked(fg)
const TMP = resolve(process.cwd(), '.tmp-test-f3-glob')

function mkRepo(name: string, files: Record<string, string> = {}): string {
  const repoPath = join(TMP, name)
  rmSync(repoPath, { recursive: true, force: true })
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return repoPath
}

const baseStack = (overrides: Partial<StackInfo> = {}): StackInfo => ({
  type: 'backend',
  language: 'typescript',
  framework: 'nestjs',
  schema_sources: [],
  routing_files: [],
  entrypoint_files: [],
  path_aliases: {},
  base_url: null,
  routing_libs: [],
  custom_decorators: {},
  ...overrides,
})

describe('runGlobWithTimeout with mocked fast-glob', () => {
  afterEach(() => {
    vi.useRealTimers()
    fgMock.mockReset()
  })

  it('returns files when fast-glob resolves before timeout', async () => {
    fgMock.mockResolvedValueOnce(['src/main.ts'])

    await expect(runGlobWithTimeout('src/**/*.ts', { cwd: TMP }, 1000)).resolves.toEqual({
      files: ['src/main.ts'],
      timedOut: false,
    })
  })

  it('rejects when fast-glob rejects before timeout', async () => {
    fgMock.mockRejectedValueOnce(new Error('glob failed'))

    await expect(runGlobWithTimeout('src/**/*.ts', { cwd: TMP }, 1000)).rejects.toThrow('glob failed')
  })

  it('returns timedOut=true when fast-glob never settles', async () => {
    vi.useFakeTimers()
    fgMock.mockReturnValueOnce(new Promise(() => undefined))

    const result = runGlobWithTimeout('src/**/*.ts', { cwd: TMP }, 10)
    await vi.advanceTimersByTimeAsync(11)

    await expect(result).resolves.toEqual({ files: [], timedOut: true })
  })

  it('rejects when the signal aborts after glob starts', async () => {
    fgMock.mockReturnValueOnce(new Promise(() => undefined))
    const ctrl = new AbortController()

    const result = runGlobWithTimeout('src/**/*.ts', { cwd: TMP }, 1000, ctrl.signal)
    ctrl.abort()

    await expect(result).rejects.toThrow(/abort/i)
  })
})

describe('validatePaths with mocked glob boundaries', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    fgMock.mockReset()
    rmSync(TMP, { recursive: true, force: true })
  })

  it('sanitizes non-array and oversized stack fields without dropping the pipeline result', async () => {
    const repo = mkRepo('sanitize')
    fgMock.mockResolvedValue([])
    const stack = baseStack({
      routing_files: ['src/a.ts', 1 as unknown as string],
      entrypoint_files: Array.from({ length: 51 }, (_, i) => `src/e${i}.ts`),
      schema_sources: 'invalid' as unknown as StackInfo['schema_sources'],
    })

    const result = await validatePaths(repo, stack)

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'routing_files', severity: 'low' }),
      expect.objectContaining({ field: 'entrypoint_files', severity: 'medium' }),
      expect.objectContaining({ field: 'schema_sources', severity: 'medium' }),
    ]))
  })

  it('truncates schema source lists and schema path lists before globbing', async () => {
    const repo = mkRepo('schema-truncate')
    const stack = baseStack({
      schema_sources: Array.from({ length: 21 }, (_, i) => ({
        orm: 'prisma',
        provider: 'postgresql',
        label: `schema-${i}`,
        schema_paths: i === 0
          ? Array.from({ length: 51 }, (_, j) => `prisma/schema-${j}.prisma`)
          : [`prisma/schema-${i}.prisma`],
      })),
    })
    fgMock.mockResolvedValue([])

    const result = await validatePaths(repo, stack)

    expect(fgMock).toHaveBeenCalledTimes(50 + 19)
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'schema_sources', message: expect.stringContaining('schema_sources가') }),
      expect.objectContaining({ field: 'schema_sources', message: expect.stringContaining('schema_paths가') }),
    ]))
  })

  it('rejects dangerous schema, route, and entrypoint patterns before globbing', async () => {
    const repo = mkRepo('dangerous-patterns')
    const stack = baseStack({
      schema_sources: [{
        orm: 'prisma',
        provider: 'postgresql',
        label: 'main',
        schema_paths: ['../schema.prisma', '/schema.prisma', 'schema\u0000.prisma'],
      }],
      routing_files: ['../routes.ts'],
      entrypoint_files: ['/main.ts', 'src/main\u0000.ts'],
    })

    const result = await validatePaths(repo, stack)

    expect(fgMock).not.toHaveBeenCalled()
    expect(result.warnings.filter((warning) => warning.message.includes('위험한 패턴'))).toHaveLength(6)
  })

  it('drops paths that escape the repo even if glob returns them for a safe pattern', async () => {
    const repo = mkRepo('escaped-glob-result')
    fgMock.mockResolvedValueOnce(['../outside.ts'])

    const result = await validatePaths(repo, baseStack({ routing_files: ['src/**/*.ts'] }))

    expect(result.routing_files_found).toEqual([])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'routing_files', message: expect.stringContaining('경로 탈출') }),
    ]))
  })

  it('records circular symlink failures while normalizing glob results', async () => {
    const repo = mkRepo('eloop-glob-result')
    fgMock.mockResolvedValueOnce(['src/link.ts'])
    const realpath = vi.spyOn(fs, 'realpathSync')
    realpath.mockImplementationOnce((target) => target.toString())
    realpath.mockImplementationOnce(() => {
      const err = new Error('too many symbolic links') as NodeJS.ErrnoException
      err.code = 'ELOOP'
      throw err
    })

    const result = await validatePaths(repo, baseStack({ routing_files: ['src/**/*.ts'] }))

    expect(result.routing_files_found).toEqual([])
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'routing_files', message: expect.stringContaining('ELOOP') }),
    ]))
    realpath.mockRestore()
  })

  it('records glob timeout warnings and keeps missing-entrypoint warnings suppressed after truncation', async () => {
    const repo = mkRepo('truncate', { 'src/a.ts': '' })
    const files = Array.from({ length: 100_001 }, () => 'src/a.ts')
    const realpath = vi.spyOn(fs, 'realpathSync')
    realpath.mockImplementation((target) => target.toString())
    fgMock.mockResolvedValueOnce(files)
    fgMock.mockResolvedValueOnce([])

    const result = await validatePaths(repo, baseStack({
      routing_files: ['src/**/*.ts'],
      entrypoint_files: ['src/main.ts'],
    }))

    expect(result.routing_files_found).toHaveLength(100_000)
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'routing_files', message: expect.stringContaining('5000개를 초과') }),
      expect.objectContaining({ field: 'routing_files', message: expect.stringContaining('누적 파일 수') }),
    ]))
    expect(result.warnings.some((warning) => warning.message === 'entrypoint 파일을 찾을 수 없습니다')).toBe(false)
    realpath.mockRestore()
  })

  it('records timeout warnings for path globs', async () => {
    vi.useFakeTimers()
    const repo = mkRepo('timeout')
    fgMock.mockReturnValueOnce(new Promise(() => undefined))

    const resultPromise = validatePaths(repo, baseStack({ routing_files: ['src/**/*.ts'] }))
    await vi.advanceTimersByTimeAsync(10_001)
    const result = await resultPromise

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'routing_files', message: expect.stringContaining('타임아웃') }),
    ]))
  })

  it('handles custom decorator mapping defaults and repo-root wrapper paths', async () => {
    const repo = mkRepo('custom-decorators')
    const result = await validatePaths(repo, baseStack({
      custom_decorators: {
        NoFile: { expands_to: ['Get'], dynamic: false, fallback_to_llm: false } as unknown as { file?: string },
        EmptyFile: { expands_to: ['Get'], file: '', dynamic: false, fallback_to_llm: false },
      },
    }))

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'custom_decorators', message: expect.stringContaining('repo 외부') }),
    ]))
  })

  it('ignores absent and malformed custom decorator maps', async () => {
    const repo = mkRepo('malformed-custom-decorators')

    const absent = await validatePaths(repo, baseStack({ custom_decorators: null as unknown as StackInfo['custom_decorators'] }))
    const malformed = await validatePaths(repo, baseStack({ custom_decorators: 'bad' as unknown as StackInfo['custom_decorators'] }))

    expect(absent.warnings.filter((warning) => warning.field === 'custom_decorators')).toEqual([])
    expect(malformed.warnings.filter((warning) => warning.field === 'custom_decorators')).toEqual([])
  })

})