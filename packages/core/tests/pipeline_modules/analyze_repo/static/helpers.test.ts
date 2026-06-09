import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'

import { isUnsafePath, DANGEROUS_KEYS, rejectDangerousKeys, assertNoDangerousKeys } from '@/pipeline_modules/analyze_repo/static/helpers/path_safety.js'
import { extractPathAliases, extractBaseUrl } from '@/pipeline_modules/analyze_repo/static/helpers/tsconfig.js'
import { extractIntegrations } from '@/pipeline_modules/analyze_repo/static/helpers/integrations_map.js'
import { extractRoutingLibs } from '@/pipeline_modules/analyze_repo/static/helpers/routing_libs.js'
import { safeGlob, globHasAny, MAX_GLOB_RESULTS } from '@/pipeline_modules/analyze_repo/static/helpers/glob.js'
import * as globHelpers from '@/pipeline_modules/analyze_repo/static/helpers/glob.js'
import { grepFiles, grepHasAny } from '@/pipeline_modules/analyze_repo/static/helpers/grep.js'
import type { ManifestSet } from '@/pipeline_modules/analyze_repo/types.js'

const TMP = resolve(process.cwd(), '.tmp-test-helpers')

function mkRepo(name: string, files: Record<string, string> = {}): string {
  const repoPath = join(TMP, name)
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return repoPath
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

// ────────────────────────────────────────
// path_safety
// ────────────────────────────────────────

describe('isUnsafePath', () => {
  it('rejects path traversal', () => {
    expect(isUnsafePath('../etc')).toBe(true)
    expect(isUnsafePath('foo/../bar')).toBe(true)
    expect(isUnsafePath('foo/..\\bar')).toBe(true)
  })
  it('rejects absolute paths', () => {
    expect(isUnsafePath('/etc/passwd')).toBe(true)
    expect(isUnsafePath('C:\\Windows')).toBe(true)
  })
  it('rejects URL schemes', () => {
    expect(isUnsafePath('http://evil')).toBe(true)
    expect(isUnsafePath('file:///etc')).toBe(true)
    expect(isUnsafePath('data:text/x')).toBe(true)
  })
  it('rejects control chars', () => {
    expect(isUnsafePath('foo\nbar')).toBe(true)
    expect(isUnsafePath('foo\x00bar')).toBe(true)
    expect(isUnsafePath('foo\x7fbar')).toBe(true)
  })
  it('rejects too long', () => {
    expect(isUnsafePath('x'.repeat(501))).toBe(true)
  })
  it('rejects non-string', () => {
    expect(isUnsafePath(null)).toBe(true)
    expect(isUnsafePath(123)).toBe(true)
    expect(isUnsafePath(undefined)).toBe(true)
  })
  it('accepts safe relative paths', () => {
    expect(isUnsafePath('src/main.ts')).toBe(false)
    expect(isUnsafePath('src/**/*.controller.ts')).toBe(false)
    expect(isUnsafePath('@/*')).toBe(false)
  })
  it('accepts empty string (caller responsibility)', () => {
    expect(isUnsafePath('')).toBe(false)
  })
})

describe('DANGEROUS_KEYS', () => {
  it('contains __proto__ / constructor / prototype', () => {
    expect(DANGEROUS_KEYS.has('__proto__')).toBe(true)
    expect(DANGEROUS_KEYS.has('constructor')).toBe(true)
    expect(DANGEROUS_KEYS.has('prototype')).toBe(true)
    expect(DANGEROUS_KEYS.has('safe_key')).toBe(false)
  })
})

describe('rejectDangerousKeys (Zod superRefine)', () => {
  // Note: Zod의 z.record는 __proto__를 자동 strip — superRefine까지 도달 안 함.
  // 이 헬퍼는 raw object를 superRefine에서 직접 검증할 때 (이중 안전망) 동작.
  it('flags nested constructor on raw object passed via superRefine', () => {
    const schema = z
      .object({ data: z.unknown() })
      .superRefine((d, ctx) => rejectDangerousKeys(d.data, ctx))
    const malicious = JSON.parse('{"data":{"a":{"constructor":"evil"}}}')
    const result = schema.safeParse(malicious)
    expect(result.success).toBe(false)
  })
  it('passes safe data', () => {
    const schema = z
      .object({ data: z.unknown() })
      .superRefine((d, ctx) => rejectDangerousKeys(d.data, ctx))
    const result = schema.safeParse({ data: { a: { b: { c: 'safe' } } } })
    expect(result.success).toBe(true)
  })
})

describe('assertNoDangerousKeys (throw)', () => {
  it('throws on __proto__ from JSON.parse', () => {
    const malicious = JSON.parse('{"__proto__":{"x":1}}')
    expect(() => assertNoDangerousKeys(malicious)).toThrow()
  })
  it('throws on nested prototype key', () => {
    const malicious = JSON.parse('{"a":{"prototype":"evil"}}')
    expect(() => assertNoDangerousKeys(malicious)).toThrow()
  })
  it('passes on safe', () => {
    expect(() => assertNoDangerousKeys({ a: { b: 1 } })).not.toThrow()
  })
})

// ────────────────────────────────────────
// tsconfig helpers
// ────────────────────────────────────────

describe('extractPathAliases', () => {
  it('extracts paths first array element', () => {
    const r = extractPathAliases({ compilerOptions: { paths: { '@/*': ['src/*'] } } })
    expect(r).toEqual({ '@/*': 'src/*' })
  })
  it('returns {} when tsconfig=null', () => {
    expect(extractPathAliases(null)).toEqual({})
  })
  it('rejects dangerous keys', () => {
    const r = extractPathAliases({ compilerOptions: { paths: { constructor: ['x'], '@/*': ['src/*'] } } })
    expect(r).not.toHaveProperty('constructor')
    expect(r).toEqual({ '@/*': 'src/*' })
  })
  it('returns {} when paths is missing or malformed', () => {
    expect(extractPathAliases({ compilerOptions: {} })).toEqual({})
    expect(extractPathAliases({ compilerOptions: { paths: 'bad' as unknown as Record<string, string[]> } })).toEqual({})
  })
  it('rejects unsafe path values', () => {
    const r = extractPathAliases({ compilerOptions: { paths: { '@/*': ['../../../etc'] } } })
    expect(r).toEqual({})
  })
  it('skips empty value arrays', () => {
    const r = extractPathAliases({ compilerOptions: { paths: { '@/*': [] } } })
    expect(r).toEqual({})
  })
  it('skips oversized alias keys, non-array values, and non-string first values', () => {
    const r = extractPathAliases({
      compilerOptions: {
        paths: {
          ['x'.repeat(201)]: ['src/*'],
          '@bad': 'src/*' as unknown as string[],
          '@num': [123] as unknown as string[],
          '@ok': ['src/*'],
        },
      },
    })
    expect(r).toEqual({ '@ok': 'src/*' })
  })
})

describe('extractBaseUrl', () => {
  it('extracts string baseUrl', () => {
    expect(extractBaseUrl({ compilerOptions: { baseUrl: 'src' } })).toBe('src')
  })
  it('returns null when missing', () => {
    expect(extractBaseUrl({ compilerOptions: {} })).toBeNull()
    expect(extractBaseUrl(null)).toBeNull()
  })
  it('rejects unsafe baseUrl', () => {
    expect(extractBaseUrl({ compilerOptions: { baseUrl: '../../etc' } })).toBeNull()
    expect(extractBaseUrl({ compilerOptions: { baseUrl: 'http://evil' } })).toBeNull()
    expect(extractBaseUrl({ compilerOptions: { baseUrl: '/etc' } })).toBeNull()
  })
  it('rejects empty or non-string baseUrl', () => {
    expect(extractBaseUrl({ compilerOptions: { baseUrl: '' } })).toBeNull()
    expect(extractBaseUrl({ compilerOptions: { baseUrl: 123 as unknown as string } })).toBeNull()
  })
})

// ────────────────────────────────────────
// integrations_map
// ────────────────────────────────────────

function manifestsWith(deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): ManifestSet {
  return {
    packageJson: { dependencies: deps, devDependencies: devDeps },
    pubspecYaml: null,
    tsconfig: null,
    otherManifests: [],
  }
}

describe('extractIntegrations', () => {
  it('maps firebase / stripe / sentry', () => {
    const r = extractIntegrations(manifestsWith({ 'firebase-admin': '^12', stripe: '^10', '@sentry/node': '^8' }))
    expect(r).toEqual(['firebase', 'sentry', 'stripe'])
  })
  it('dedupes (firebase + firebase-admin → 1 entry)', () => {
    const r = extractIntegrations(manifestsWith({ firebase: '^10', 'firebase-admin': '^12' }))
    expect(r).toEqual(['firebase'])
  })
  it('returns [] for no matches', () => {
    expect(extractIntegrations(manifestsWith({ lodash: '^4' }))).toEqual([])
  })
  it('handles pubspec deps', () => {
    const r = extractIntegrations({
      packageJson: null,
      pubspecYaml: { dependencies: { firebase_core: '^2', flutter_bloc: '^8', dio: '^5' } },
      tsconfig: null,
      otherManifests: [],
    })
    expect(r.sort()).toEqual(['bloc', 'firebase', 'http'])
  })
  it('handles absent manifests and skips sensitive-looking dependency keys', () => {
    expect(extractIntegrations({
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: [],
    })).toEqual([])
    expect(extractIntegrations({
      packageJson: { dependencies: { 'https://example.com/firebase': '^1', stripe: '^10' } },
      pubspecYaml: { dependencies: { 'sk_live_secret': '^1', dio: '^5' } },
      tsconfig: null,
      otherManifests: [],
    })).toEqual(['http', 'stripe'])
  })
  it('handles package and pubspec manifests with missing dependency maps', () => {
    expect(extractIntegrations({
      packageJson: {},
      pubspecYaml: {},
      tsconfig: null,
      otherManifests: [],
    })).toEqual([])
  })
})

// ────────────────────────────────────────
// routing_libs
// ────────────────────────────────────────

describe('extractRoutingLibs', () => {
  it('flutter + go_router', () => {
    const r = extractRoutingLibs('flutter', {
      packageJson: null,
      pubspecYaml: { dependencies: { flutter: {}, go_router: '^12.0.0' } },
      tsconfig: null,
      otherManifests: [],
    })
    expect(r).toEqual(['go_router'])
  })
  it('flutter + get/auto_route/beamer', () => {
    const r = extractRoutingLibs('flutter', {
      packageJson: null,
      pubspecYaml: {
        dependencies: {
          flutter: {},
          get: '^4.6.6',
          auto_route: '^9.2.2',
          beamer: '^1.6.2',
        },
      },
      tsconfig: null,
      otherManifests: [],
    })
    expect(r).toEqual(['get', 'auto_route', 'beamer'])
  })
  it('flutter + flutter_modular', () => {
    const r = extractRoutingLibs('flutter', {
      packageJson: null,
      pubspecYaml: { dependencies: { flutter: {}, flutter_modular: '^6' } },
      tsconfig: null,
      otherManifests: [],
    })
    expect(r).toEqual(['flutter_modular'])
  })
  it('flutter Navigator (no router lib) → []', () => {
    const r = extractRoutingLibs('flutter', {
      packageJson: null,
      pubspecYaml: { dependencies: { flutter: {} } },
      tsconfig: null,
      otherManifests: [],
    })
    expect(r).toEqual([])
  })
  it('flutter without pubspec dependencies → []', () => {
    expect(extractRoutingLibs('flutter', {
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: [],
    })).toEqual([])
  })
  it('react + react-router-dom@^6', () => {
    const r = extractRoutingLibs('react', manifestsWith({ react: '^18', 'react-router-dom': '^6.0.0' }))
    expect(r).toContain('react-router-dom@^6')
  })
  it('react + react-router package preserves package name', () => {
    const r = extractRoutingLibs('react', manifestsWith({ react: '^19', 'react-router': '^0.0.0-experimental' }))
    expect(r).toContain('react-router@^0')
  })
  it('react + tanstack', () => {
    const r = extractRoutingLibs('react', manifestsWith({ react: '^18', '@tanstack/react-router': '^1' }))
    expect(r).toContain('@tanstack/react-router')
  })
  it('vue + vue-router@^4', () => {
    const r = extractRoutingLibs('vue', manifestsWith({ vue: '^3', 'vue-router': '^4.0.0' }))
    expect(r).toContain('vue-router@^4')
  })
  it('vue and react router versions without numeric major fall back to raw package names', () => {
    expect(extractRoutingLibs('vue', manifestsWith({ vue: '^3', 'vue-router': 'workspace:*' }))).toEqual(['vue-router'])
    expect(extractRoutingLibs('nextjs', manifestsWith({
      react: '^18',
      'react-router-dom': 5 as unknown as string,
      'react-router': '1000.0.0',
      wouter: '^3',
    }))).toEqual(['react-router-dom', 'react-router', 'wouter'])
  })
  it('svelte kit and missing package.json are handled explicitly', () => {
    expect(extractRoutingLibs('svelte', manifestsWith({ '@sveltejs/kit': '^2' }))).toEqual(['@sveltejs/kit'])
    expect(extractRoutingLibs('react', {
      packageJson: null,
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: [],
    })).toEqual([])
  })
  it('uses devDependencies when dependencies are absent', () => {
    expect(extractRoutingLibs('react', {
      packageJson: { devDependencies: { 'react-router-dom': '^6' } },
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: [],
    })).toEqual(['react-router-dom@^6'])
    expect(extractRoutingLibs('react', {
      packageJson: {},
      pubspecYaml: null,
      tsconfig: null,
      otherManifests: [],
    })).toEqual([])
  })
  it('handles abnormal version (workspace:*) gracefully', () => {
    const r = extractRoutingLibs('react', manifestsWith({ react: '^18', 'react-router-dom': 'workspace:*' }))
    // 매칭 안 되어 raw name만, 또는 빈
    expect(r.some(x => x.includes('react-router-dom'))).toBe(true)
  })
  it('framework=other → []', () => {
    expect(extractRoutingLibs('other', manifestsWith({ 'react-router-dom': '^6' }))).toEqual([])
  })
  it('framework=null → []', () => {
    expect(extractRoutingLibs(null, manifestsWith({ 'react-router-dom': '^6' }))).toEqual([])
  })
})

// ────────────────────────────────────────
// glob
// ────────────────────────────────────────

describe('safeGlob', () => {
  it('matches files', async () => {
    const repo = mkRepo('glob1', {
      'src/a.controller.ts': '// a',
      'src/b.controller.ts': '// b',
      'src/other.ts': '// not',
    })
    const r = await safeGlob('src/**/*.controller.ts', repo)
    expect(r.matches.sort()).toEqual(['src/a.controller.ts', 'src/b.controller.ts'])
    expect(r.truncated).toBe(false)
  })
  it('truncates beyond MAX_RESULTS', async () => {
    const repo = mkRepo('glob2', {})
    const files: Record<string, string> = {}
    for (let i = 0; i < MAX_GLOB_RESULTS + 5; i++) {
      files[`src/f${i}.ts`] = '// x'
    }
    for (const [rel, content] of Object.entries(files)) {
      const full = join(repo, rel)
      mkdirSync(resolve(full, '..'), { recursive: true })
      writeFileSync(full, content)
    }
    const r = await safeGlob('src/**/*.ts', repo)
    expect(r.matches.length).toBe(MAX_GLOB_RESULTS)
    expect(r.truncated).toBe(true)
  })

  it('globHasAny returns false for no match', async () => {
    const repo = mkRepo('glob3', {})
    expect(await globHasAny('src/**/*.ts', repo)).toBe(false)
  })
})

// ────────────────────────────────────────
// grep
// ────────────────────────────────────────

describe('grepFiles', () => {
  it('finds files containing pattern', async () => {
    const repo = mkRepo('grep1', {
      'lib/router.dart': "import 'package:go_router/go_router.dart';\nfinal router = GoRouter(routes: [/*...*/]);",
      'lib/main.dart': "void main() {}",
    })
    const r = await grepFiles('lib/**/*.dart', 'GoRouter(', repo)
    expect(r).toEqual(['lib/router.dart'])
  })
  it('grepHasAny boolean', async () => {
    const repo = mkRepo('grep2', {
      'src/x.ts': "import { applyDecorators } from '@nestjs/common';",
    })
    expect(await grepHasAny('src/**/*.ts', 'applyDecorators', repo)).toBe(true)
    expect(await grepHasAny('src/**/*.ts', 'nonexistent', repo)).toBe(false)
  })
  it('accepts RegExp patterns and skips oversized files', async () => {
    const repo = mkRepo('grep2b', {
      'src/ok.ts': 'const Wrapped = withAuth(Component)',
      'src/large.ts': `withAuth(${ 'x'.repeat(300 * 1024) })`,
    })
    expect(await grepFiles('src/**/*.ts', /\bwithAuth\s*\(/, repo)).toEqual(['src/ok.ts'])
  })
  it('throws AbortError when aborted after glob and before file reads', async () => {
    const repo = mkRepo('grep2c', { 'src/ok.ts': 'applyDecorators()' })
    const ctrl = new AbortController()
    const spy = vi.spyOn(globHelpers, 'safeGlob').mockImplementation(async () => {
      ctrl.abort()
      return { matches: ['src/ok.ts'], truncated: false }
    })
    await expect(grepFiles('src/**/*.ts', 'applyDecorators', repo, ctrl.signal)).rejects.toThrow(/abort/i)
    spy.mockRestore()
  })
  it('skips unreadable files while continuing grep', async () => {
    const repo = mkRepo('grep3', {
      'src/secret.ts': 'applyDecorators()',
      'src/ok.ts': 'plain text',
    })
    const unreadable = join(repo, 'src/secret.ts')
    chmodSync(unreadable, 0o000)
    try {
      expect(await grepFiles('src/**/*.ts', 'applyDecorators', repo)).toEqual([])
    } finally {
      chmodSync(unreadable, 0o644)
    }
  })
})
