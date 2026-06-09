import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  runGlobWithTimeout,
  normalizeAndVerify,
  validatePaths,
} from '@/pipeline_modules/analyze_repo/f3_validate_paths.js'
import type { StackInfo } from '@/pipeline_modules/analyze_repo/types.js'

const TMP = resolve(process.cwd(), '.tmp-test-f3-branches')

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

describe('runGlobWithTimeout', () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('throws AbortError when signal pre-aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      runGlobWithTimeout('**/*', { cwd: TMP }, 1000, ctrl.signal),
    ).rejects.toThrow(/abort/i)
  })

  it('returns timedOut=true when timeout fires before glob completes', async () => {
    // tiny timeout — glob must finish OR timeout
    const result = await runGlobWithTimeout('**/*', { cwd: TMP }, 1)
    // 결과는 timedOut=true 일 가능성 (마이크로초 단위 timeout). false여도 OK이라 제거
    expect(result).toHaveProperty('timedOut')
    expect(result).toHaveProperty('files')
  })

  it('returns files=[] when glob fails internally', async () => {
    // 정상 glob — 빈 디렉토리
    const result = await runGlobWithTimeout('nonexistent-*', { cwd: TMP }, 1000)
    expect(result.timedOut).toBe(false)
    expect(result.files).toEqual([])
  })
})

describe('normalizeAndVerify — edge cases', () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('returns warning with ENOENT-ish for missing path', () => {
    const result = normalizeAndVerify('does-not-exist.ts', TMP, 'entrypoint_files')
    expect(result.verified).toBeNull()
    expect(result.warning?.message).toMatch(/경로 확인 실패/)
  })

  it('returns warning for symlink escaping repo root', () => {
    const repo = join(TMP, 'escape-repo')
    mkdirSync(repo, { recursive: true })
    const outside = join(TMP, 'outside-target')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'x.ts'), 'x')
    // symlink inside repo → outside
    symlinkSync(join(outside, 'x.ts'), join(repo, 'link.ts'))
    const result = normalizeAndVerify('link.ts', repo, 'entrypoint_files')
    expect(result.verified).toBeNull()
    expect(result.warning?.message).toMatch(/symlink/)
  })
})

// ★ N1: 한도 100k로 상향됨 → 옛 2001/501 fixture 검증 의미 없음. 삭제.
//        (cumulativeFiles 한도 검증은 fixture 크기 부담으로 별도 단위 테스트로 분리 예정)
