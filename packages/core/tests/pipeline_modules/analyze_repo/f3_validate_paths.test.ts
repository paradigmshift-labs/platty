import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { validatePaths, normalizeAndVerify } from '@/pipeline_modules/analyze_repo/f3_validate_paths.js'
import type { StackInfo } from '@/pipeline_modules/analyze_repo/types.js'

const TMP = resolve(process.cwd(), '.tmp-test-validate-paths')

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

describe('validatePaths', () => {
  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  describe('input validation', () => {
    it('throws on empty repoPath', async () => {
      await expect(validatePaths('', baseStack())).rejects.toThrow(/INVALID_REPO_PATH/)
    })
  })

  describe('schema_sources', () => {
    it('finds matching schema files', async () => {
      const repo = mkRepo('schema-found', { 'prisma/schema.prisma': 'model User {}' })
      const stack = baseStack({
        schema_sources: [{ orm: 'prisma', provider: 'postgresql', schema_paths: ['prisma/schema.prisma'], label: 'main' }],
      })
      const result = await validatePaths(repo, stack)
      expect(result.schema_files_found).toContain('prisma/schema.prisma')
      expect(result.schema_files_missing).toEqual([])
    })

    it('reports missing schema files via warning', async () => {
      const repo = mkRepo('schema-missing')
      const stack = baseStack({
        schema_sources: [{ orm: 'prisma', provider: 'postgresql', schema_paths: ['prisma/schema.prisma'], label: 'main' }],
      })
      const result = await validatePaths(repo, stack)
      expect(result.schema_files_missing).toContain('prisma/schema.prisma')
      expect(result.warnings.some((w) => w.field === 'schema_sources' && w.message.includes('찾을 수 없'))).toBe(true)
    })
  })

  describe('routing_files / entrypoint_files', () => {
    it('finds routing files', async () => {
      const repo = mkRepo('routing-found', { 'src/router/index.ts': 'export {}' })
      const stack = baseStack({ routing_files: ['src/router/index.ts'] })
      const result = await validatePaths(repo, stack)
      expect(result.routing_files_found).toContain('src/router/index.ts')
    })

    it('finds entrypoint files', async () => {
      const repo = mkRepo('entry-found', { 'src/main.ts': 'export {}' })
      const stack = baseStack({ entrypoint_files: ['src/main.ts'] })
      const result = await validatePaths(repo, stack)
      expect(result.entrypoint_files_found).toContain('src/main.ts')
    })

    it('warns when entrypoint patterns specified but none found', async () => {
      const repo = mkRepo('entry-missing')
      const stack = baseStack({ entrypoint_files: ['src/main.ts'] })
      const result = await validatePaths(repo, stack)
      expect(result.entrypoint_files_found).toEqual([])
      expect(result.warnings.some((w) => w.field === 'entrypoint_files' && w.message.includes('찾을 수 없'))).toBe(true)
    })
  })

  describe('security — path traversal', () => {
    it('rejects "../../" pattern', async () => {
      const repo = mkRepo('security-1')
      const stack = baseStack({ entrypoint_files: ['../../etc/passwd'] })
      const result = await validatePaths(repo, stack)
      expect(result.warnings.some((w) => w.message.includes('위험한 패턴'))).toBe(true)
      expect(result.entrypoint_files_found).toEqual([])
    })

    it('rejects absolute path', async () => {
      const repo = mkRepo('security-2')
      const stack = baseStack({ entrypoint_files: ['/etc/passwd'] })
      const result = await validatePaths(repo, stack)
      expect(result.warnings.some((w) => w.message.includes('위험한 패턴'))).toBe(true)
    })
  })

  describe('input sanitization', () => {
    it('replaces non-array routing_files with [] + warning', async () => {
      const repo = mkRepo('sanitize-1')
      const stack = baseStack()
      ;(stack as unknown as Record<string, unknown>).routing_files = 'not-an-array'
      const result = await validatePaths(repo, stack)
      expect(result.warnings.some((w) => w.field === 'routing_files' && w.message.includes('배열이 아닙니다'))).toBe(true)
    })

    it('truncates arrays exceeding MAX_ARRAY_SIZE (50)', async () => {
      const repo = mkRepo('sanitize-2')
      const stack = baseStack({ routing_files: Array.from({ length: 60 }, (_, i) => `src/r${i}.ts`) })
      const result = await validatePaths(repo, stack)
      expect(result.warnings.some((w) => w.field === 'routing_files' && w.message.includes('초과'))).toBe(true)
    })
  })

})

describe('v2 보강 — V5 custom_decorators', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  it('V5: custom_decorators.file 누락 → medium 워닝', async () => {
    const repo = mkRepo('v5')
    const stack = baseStack({
      custom_decorators: {
        ApiGet: { expands_to: ['Get'], file: 'src/decorators/api-get.ts', dynamic: false, fallback_to_llm: false },
      },
    })
    const r = await validatePaths(repo, stack)
    expect(r.warnings.some((w) => w.field === 'custom_decorators' && w.severity === 'medium')).toBe(true)
  })

  it('V5: custom_decorators.file 존재 → 워닝 없음', async () => {
    const repo = mkRepo('v5b', { 'src/decorators/api-get.ts': '' })
    const stack = baseStack({
      custom_decorators: {
        ApiGet: { expands_to: ['Get'], file: 'src/decorators/api-get.ts', dynamic: false, fallback_to_llm: false },
      },
    })
    const r = await validatePaths(repo, stack)
    expect(r.warnings.filter((w) => w.field === 'custom_decorators')).toEqual([])
  })

  it('V5: custom_decorators.file 절대경로 → 위험 워닝', async () => {
    const repo = mkRepo('v5c')
    const stack = baseStack({
      custom_decorators: {
        Evil: { expands_to: ['Get'], file: '/etc/passwd', dynamic: false, fallback_to_llm: false },
      },
    })
    const r = await validatePaths(repo, stack)
    expect(r.warnings.some((w) => w.field === 'custom_decorators' && /위험/.test(w.message))).toBe(true)
  })
})

describe('normalizeAndVerify', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  it('returns relative path for valid file', () => {
    const repoPath = mkRepo('normal', { 'src/a.ts': 'x' })
    const result = normalizeAndVerify('src/a.ts', repoPath, 'entrypoint_files')
    expect(result.verified).toBe('src/a.ts')
    expect(result.warning).toBeUndefined()
  })

  it('returns warning for traversal escape', () => {
    const repoPath = mkRepo('escape')
    const result = normalizeAndVerify('../../etc/passwd', repoPath, 'entrypoint_files')
    expect(result.verified).toBeNull()
    expect(result.warning).toBeDefined()
  })
})
