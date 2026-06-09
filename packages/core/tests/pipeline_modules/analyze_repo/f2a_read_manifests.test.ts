import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readManifests } from '@/pipeline_modules/analyze_repo/f2a_read_manifests.js'

/**
 * f2a_read_manifests 시나리오 (spec §4 — 16 시나리오 100%):
 *
 *  M1  package.json + tsconfig.json     → 둘 다 객체
 *  M2  package.json만                   → tsconfig=null
 *  M3  pubspec.yaml만                   → packageJson=null
 *  M4  go.mod만                         → otherManifests=['go.mod']
 *  M5  매니페스트 0개                   → 모두 null
 *  M6  malformed JSON                   → packageJson=null (no throw)
 *  M7  tsconfig with comments (JSON5)   → 관대 파싱 통과
 *  M8  tsconfig extends 1단계           → base의 paths/baseUrl 머지
 *  M9  package.json BOM                 → BOM 제거 후 파싱
 *  M10 package.json 1MB 초과            → null (방어)
 *  M11 복수 매니페스트                  → 모두 채워짐
 *  M12 symlink 매니페스트               → realpath 통과
 *  M13 Python 복수 매니페스트           → otherManifests 3개
 *  M14 tsconfig with no extends key     → 정상 (extends 분기 X)
 *  M15 tsconfig extends 순환            → depth limit 5 후 null
 *  M16 tsconfig extends 외부 경로       → path_safety reject → null
 */

const TMP_ROOT = resolve(process.cwd(), '.tmp-test-read-manifests')

function mkRepo(name: string, files: Record<string, string>): string {
  const repoPath = join(TMP_ROOT, name)
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return repoPath
}

describe('readManifests', () => {
  beforeAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
    mkdirSync(TMP_ROOT, { recursive: true })
  })

  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
  })

  // ── M1 ──
  it('M1: package.json + tsconfig.json — both parsed', () => {
    const repo = mkRepo('m1', {
      'package.json': JSON.stringify({ name: 'pkg', dependencies: { react: '^18.0.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'src' } }),
    })
    const r = readManifests(repo)
    expect(r.packageJson?.name).toBe('pkg')
    expect(r.packageJson?.dependencies?.react).toBe('^18.0.0')
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('src')
    expect(r.pubspecYaml).toBeNull()
    expect(r.otherManifests).toEqual([])
  })

  // ── M2 ──
  it('M2: package.json only — tsconfig=null', () => {
    const repo = mkRepo('m2', { 'package.json': '{"name":"pkg"}' })
    const r = readManifests(repo)
    expect(r.packageJson?.name).toBe('pkg')
    expect(r.tsconfig).toBeNull()
  })

  // ── M3 ──
  it('M3: pubspec.yaml only — packageJson=null, deps extracted', () => {
    const repo = mkRepo('m3', {
      'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  go_router: ^12.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
    })
    const r = readManifests(repo)
    expect(r.packageJson).toBeNull()
    expect(r.pubspecYaml?.name).toBe('app')
    expect(r.pubspecYaml?.dependencies).toHaveProperty('flutter')
    expect(r.pubspecYaml?.dependencies).toHaveProperty('go_router')
    expect(r.pubspecYaml?.dev_dependencies).toHaveProperty('flutter_test')
  })

  // ── M4 ──
  it('M4: go.mod only — otherManifests=["go.mod"]', () => {
    const repo = mkRepo('m4', { 'go.mod': 'module example.com/x\ngo 1.21\n' })
    const r = readManifests(repo)
    expect(r.packageJson).toBeNull()
    expect(r.tsconfig).toBeNull()
    expect(r.pubspecYaml).toBeNull()
    expect(r.otherManifests).toEqual(['go.mod'])
  })

  // ── M5 ──
  it('M5: empty repo — all null', () => {
    const repo = mkRepo('m5', {})
    const r = readManifests(repo)
    expect(r.packageJson).toBeNull()
    expect(r.tsconfig).toBeNull()
    expect(r.pubspecYaml).toBeNull()
    expect(r.otherManifests).toEqual([])
  })

  // ── M6 ──
  it('M6: malformed package.json — packageJson=null (no throw)', () => {
    const repo = mkRepo('m6', { 'package.json': '{not valid json' })
    const r = readManifests(repo)
    expect(r.packageJson).toBeNull()
  })

  // ── M7 ──
  it('M7: tsconfig with comments (JSONC) — parsed', () => {
    const repo = mkRepo('m7', {
      'tsconfig.json': '{\n  // comment\n  "compilerOptions": {\n    "baseUrl": "src", /* inline */\n  },\n}',
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('src')
  })

  // ── M8 ──
  it('M8: tsconfig extends 1-level — base merged', () => {
    const repo = mkRepo('m8', {
      'tsconfig.base.json': JSON.stringify({
        compilerOptions: { baseUrl: 'src', paths: { '@/*': ['*'] } },
      }),
      'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json' }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('src')
    expect(r.tsconfig?.compilerOptions?.paths).toEqual({ '@/*': ['*'] })
  })

  // ── M9 ──
  it('M9: package.json with BOM — stripped and parsed', () => {
    const repo = mkRepo('m9', {})
    writeFileSync(join(repo, 'package.json'), '﻿' + JSON.stringify({ name: 'bom-pkg' }))
    const r = readManifests(repo)
    expect(r.packageJson?.name).toBe('bom-pkg')
  })

  // ── M10 ──
  it('M10: package.json > 1MB — null (DoS defense)', () => {
    const big = 'x'.repeat(1024 * 1024 + 100)
    const repo = mkRepo('m10', { 'package.json': `{"name":"p","big":"${big}"}` })
    const r = readManifests(repo)
    expect(r.packageJson).toBeNull()
  })

  // ── M11 ──
  it('M11: package.json + pubspec.yaml + go.mod — all populated', () => {
    const repo = mkRepo('m11', {
      'package.json': '{"name":"a"}',
      'pubspec.yaml': 'name: b\n',
      'go.mod': 'module b\n',
    })
    const r = readManifests(repo)
    expect(r.packageJson?.name).toBe('a')
    expect(r.pubspecYaml?.name).toBe('b')
    expect(r.otherManifests).toEqual(['go.mod'])
  })

  // ── M12 ──
  it('M12: symlinked manifest — readable via realpath', () => {
    const targetDir = join(TMP_ROOT, 'm12-target')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'package.json'), '{"name":"linked"}')
    const repo = join(TMP_ROOT, 'm12-repo')
    mkdirSync(repo, { recursive: true })
    symlinkSync(join(targetDir, 'package.json'), join(repo, 'package.json'), 'file')
    const r = readManifests(repo)
    expect(r.packageJson?.name).toBe('linked')
  })

  // ── M13 ──
  it('M13: Python multiple manifests — all in otherManifests', () => {
    const repo = mkRepo('m13', {
      'requirements.txt': 'flask==2.0\n',
      'setup.py': 'from setuptools import setup\nsetup(name="x")\n',
      'pyproject.toml': '[project]\nname="x"\n',
    })
    const r = readManifests(repo)
    expect(r.otherManifests.sort()).toEqual(['pyproject.toml', 'requirements.txt', 'setup.py'])
  })

  // ── M14 ──
  it('M14: tsconfig with no extends — parsed normally', () => {
    const repo = mkRepo('m14', {
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'lib' } }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('lib')
    expect(r.tsconfig?.extends).toBeUndefined()
  })

  // ── M15 ──
  it('M15: tsconfig extends cycle — null after depth limit', () => {
    const repo = mkRepo('m15', {
      'tsconfig.json': JSON.stringify({ extends: './a.json' }),
      'a.json': JSON.stringify({ extends: './b.json' }),
      'b.json': JSON.stringify({ extends: './a.json' }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig).toBeNull()
  })

  // ── M16 ──
  it('M16: tsconfig extends external path — path_safety rejected → null', () => {
    const repo = mkRepo('m16', {
      'tsconfig.json': JSON.stringify({ extends: '../../etc/secrets' }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig).toBeNull()
  })

  it('M17: package.json parsed as non-object — packageJson=null', () => {
    const repo = mkRepo('m17', { 'package.json': 'null' })
    const r = readManifests(repo)
    expect(r.packageJson).toBeNull()
  })

  it('M18: malformed tsconfig — tsconfig=null (no throw)', () => {
    const repo = mkRepo('m18', { 'tsconfig.json': '{not valid json' })
    const r = readManifests(repo)
    expect(r.tsconfig).toBeNull()
  })

  it('M19: tsconfig parsed as non-object — tsconfig=null', () => {
    const repo = mkRepo('m19', { 'tsconfig.json': 'null' })
    const r = readManifests(repo)
    expect(r.tsconfig).toBeNull()
  })

  it('M20: tsconfig JSONC preserves escaped quotes and comment-like text inside strings', () => {
    const repo = mkRepo('m20', {
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": "src\\\\\\"//literal" } }',
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('src\\"//literal')
  })

  it.each([
    ['too long', 'a'.repeat(201)],
    ['control character', 'base\u0001'],
    ['backslash traversal', '..\\base'],
    ['absolute path', '/tmp/base'],
    ['URL scheme', 'https://example.test/tsconfig'],
  ])('M21: unsafe tsconfig extends %s — tsconfig=null', (_name, extendsValue) => {
    const repo = mkRepo(`m21-${_name.replace(/\W+/g, '-')}`, {
      'tsconfig.json': JSON.stringify({ extends: extendsValue }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig).toBeNull()
  })

  it('M21a: tsconfig extends chain beyond depth limit — tsconfig=null', () => {
    const repo = mkRepo('m21a', {
      'tsconfig.json': JSON.stringify({ extends: './a' }),
      'a.json': JSON.stringify({ extends: './b' }),
      'b.json': JSON.stringify({ extends: './c' }),
      'c.json': JSON.stringify({ extends: './d' }),
      'd.json': JSON.stringify({ extends: './e' }),
      'e.json': JSON.stringify({ compilerOptions: { baseUrl: 'src' } }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig).toBeNull()
  })

  it('M22: tsconfig extends without .json suffix — resolves and merges', () => {
    const repo = mkRepo('m22', {
      'base.json': JSON.stringify({ compilerOptions: { baseUrl: 'src' } }),
      'tsconfig.json': JSON.stringify({ extends: './base' }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('src')
  })

  it('M22a: tsconfig child compilerOptions override base while inheriting base paths', () => {
    const repo = mkRepo('m22a', {
      'base.json': JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { '@/*': ['*'] } } }),
      'tsconfig.json': JSON.stringify({ extends: './base', compilerOptions: { baseUrl: 'app' } }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('app')
    expect(r.tsconfig?.compilerOptions?.paths).toEqual({ '@/*': ['*'] })
  })

  it('M22b: tsconfig child paths override base paths', () => {
    const repo = mkRepo('m22b', {
      'base.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }),
      'tsconfig.json': JSON.stringify({
        extends: './base',
        compilerOptions: { paths: { '~/*': ['app/*'] } },
      }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.paths).toEqual({ '~/*': ['app/*'] })
  })

  it('M22c: tsconfig child compilerOptions work when base has none', () => {
    const repo = mkRepo('m22c', {
      'base.json': JSON.stringify({}),
      'tsconfig.json': JSON.stringify({ extends: './base', compilerOptions: { baseUrl: 'app' } }),
    })
    const r = readManifests(repo)
    expect(r.tsconfig?.compilerOptions?.baseUrl).toBe('app')
  })

  it('M23: pubspec dependency values strip single quotes', () => {
    const repo = mkRepo('m23', {
      'pubspec.yaml': "dependencies:\n  go_router: '^12.0.0'\n",
    })
    const r = readManifests(repo)
    expect(r.pubspecYaml?.dependencies?.go_router).toBe('^12.0.0')
  })

  it('M23a: pubspec name strips double quotes', () => {
    const repo = mkRepo('m23a', {
      'pubspec.yaml': 'name: "quoted_app"\n',
    })
    const r = readManifests(repo)
    expect(r.pubspecYaml?.name).toBe('quoted_app')
  })

  it('M24: pubspec inline dependency maps are tolerated as empty sections', () => {
    const repo = mkRepo('m24', {
      'pubspec.yaml': 'dependencies: {flutter: any}\n',
    })
    const r = readManifests(repo)
    expect(r.pubspecYaml?.dependencies).toEqual({})
  })

  it('M24a: pubspec ignores malformed top-level and out-of-section lines', () => {
    const repo = mkRepo('m24a', {
      'pubspec.yaml': 'not yaml\n  orphan: value\ndependencies:\n  - invalid\n  flutter:\n',
    })
    const r = readManifests(repo)
    expect(r.pubspecYaml?.dependencies).toEqual({ flutter: null })
  })

  it('M25: unexpected pubspec parser exceptions degrade to pubspecYaml=null', () => {
    const repo = mkRepo('m25', {
      'pubspec.yaml': 'boom: yes\n',
    })
    const trim = String.prototype.trim
    const spy = vi.spyOn(String.prototype, 'trim').mockImplementation(function trimWithFailure() {
      const value = String(this)
      if (value.includes('boom')) throw new Error('trim failed')
      return trim.call(this)
    })
    try {
      const r = readManifests(repo)
      expect(r.pubspecYaml).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
