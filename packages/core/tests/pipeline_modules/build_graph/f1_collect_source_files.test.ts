/**
 * F1: collectSourceFiles — 유닛 + 통합 테스트
 * SOT: specs/build_graph/specs/f1_collect_source_files/spec.md
 *      specs/build_graph/specs/f1_collect_source_files/tests.md
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  collectSourceFiles,
  validateRepoId,
  globSourceFiles,
  filterSafeFile,
  readFileContent,
  isInsideRepo,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_FILE_COUNT,
  BINARY_HEADER_SIZE,
} from '@/pipeline_modules/build_graph/f1_collect_source_files.js'
import { BuildGraphError, getLanguageConfig } from '@/pipeline_modules/build_graph/types.js'

// ────────────────────────────────────────────────
// 공통 헬퍼
// ────────────────────────────────────────────────
const TS_LANG = getLanguageConfig('typescript')
const DART_LANG = getLanguageConfig('dart')

function mkTmp(prefix = 'sdd-f1-'): string {
  // realpath로 macOS의 /var → /private/var 정규화 일치시킴
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return fs.realpathSync(dir)
}

function rm(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* noop */
  }
}

function write(p: string, content: string | Buffer = '') {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

function fakeBuffer(size: number, fill: number = 0x61): Buffer {
  return Buffer.alloc(size, fill) // 'a' (0x61) — null byte 없음
}

// ════════════════════════════════════════════════
// 유닛: validateRepoId
// ════════════════════════════════════════════════
describe('validateRepoId', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkTmp('sdd-f1-vp-')
  })
  afterEach(() => rm(tmp))

  it('U1.1 정상: repoId + 절대경로 디렉토리', async () => {
    const res = await validateRepoId('proj_1', tmp)
    expect(res).toBe(fs.realpathSync(tmp))
  })

  it('U1.2 정상: 64자 id', async () => {
    await expect(validateRepoId('a'.repeat(64), tmp)).resolves.toBeTruthy()
  })

  it('U1.3 에러: 빈 repoId', async () => {
    const err = await validateRepoId('', tmp).catch((e) => e)
    expect(err).toBeInstanceOf(BuildGraphError)
    expect(err.code).toBe('GRAPH_FAILED')
    expect(err.message).toMatch(/Invalid repoId format/)
  })

  it('U1.4 에러: 공백 포함', async () => {
    await expect(validateRepoId('proj 1', tmp)).rejects.toThrow(/Invalid repoId format/)
  })

  it('U1.5 에러: 특수문자', async () => {
    await expect(validateRepoId('invalid!!!@#$', tmp)).rejects.toThrow(
      /Invalid repoId format/,
    )
  })

  it('U1.6 에러: 한글', async () => {
    await expect(validateRepoId('프로젝트1', tmp)).rejects.toThrow(/Invalid repoId format/)
  })

  it('U1.7 에러: 경로 문자', async () => {
    await expect(validateRepoId('a/b', tmp)).rejects.toThrow(/Invalid repoId format/)
    await expect(validateRepoId('a\\b', tmp)).rejects.toThrow(/Invalid repoId format/)
    await expect(validateRepoId('..', tmp)).rejects.toThrow(/Invalid repoId format/)
  })

  it('U1.8 에러: 상대경로 repoPath', async () => {
    await expect(validateRepoId('proj_1', './repo')).rejects.toThrow(
      /Repository path must be absolute/,
    )
  })

  it('U1.9 에러: ENOENT', async () => {
    const err = await validateRepoId('proj_1', '/this/path/should/not/exist/abc123').catch(
      (e) => e,
    )
    expect(err.message).toMatch(/does not exist/)
    expect(err.message).not.toMatch(/abc123/)
  })

  it('U1.10 에러: stat 실패 (mock EACCES)', async () => {
    const spy = vi
      .spyOn(fs.promises, 'stat')
      .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    try {
      await expect(validateRepoId('proj_1', tmp)).rejects.toThrow(/does not exist/)
    } finally {
      spy.mockRestore()
    }
  })

  it('U1.11 에러: repoPath가 파일', async () => {
    const file = path.join(tmp, 'a.txt')
    write(file, 'x')
    const err = await validateRepoId('proj_1', file).catch((e) => e)
    expect(err.message).toMatch(/not a directory/)
    expect(err.message).not.toMatch(file)
  })

  it('U1.12 정규화: repoPath 자체가 symlink', async () => {
    const realDir = path.join(tmp, 'real')
    fs.mkdirSync(realDir)
    const linkDir = path.join(tmp, 'link')
    try {
      fs.symlinkSync(realDir, linkDir, 'dir')
    } catch {
      return // symlink 권한 없음 — skip
    }
    const res = await validateRepoId('proj_1', linkDir)
    expect(res).toBe(fs.realpathSync(linkDir))
    expect(res).toBe(realDir)
  })

  it('U1.13 메시지 누출 방지: ENOENT 경로', async () => {
    const err = await validateRepoId('proj_1', '/secret/xyz/aaa').catch((e) => e)
    expect(err.message).not.toMatch(/secret/)
    expect(err.message).not.toMatch(/xyz/)
  })

  it('U1.14 메시지 누출 방지: repoId', async () => {
    const err = await validateRepoId('../etc', tmp).catch((e) => e)
    expect(err.message).not.toMatch(/\.\.\/etc/)
    expect(err.message).not.toMatch(/etc/)
  })
})

// ════════════════════════════════════════════════
// 유닛: globSourceFiles
// ════════════════════════════════════════════════
describe('globSourceFiles', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkTmp('sdd-f1-glob-')
  })
  afterEach(() => rm(tmp))

  it('U2.1 TS 기본: ts/tsx/js/jsx 수집, README 미수집', async () => {
    write(path.join(tmp, 'a.ts'))
    write(path.join(tmp, 'b.tsx'))
    write(path.join(tmp, 'c.js'))
    write(path.join(tmp, 'd.jsx'))
    write(path.join(tmp, 'README.md'), '#')
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res.sort()).toEqual(['a.ts', 'b.tsx', 'c.js', 'd.jsx'])
  })

  it('U2.1b TS meta-framework extensions: mdx/vue/svelte/astro 수집', async () => {
    write(path.join(tmp, 'pages/about.mdx'))
    write(path.join(tmp, 'pages/users/[id].vue'))
    write(path.join(tmp, 'src/routes/+page.svelte'))
    write(path.join(tmp, 'src/pages/index.astro'))
    write(path.join(tmp, 'src/pages/style.css'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res.sort()).toEqual([
      'pages/about.mdx',
      'pages/users/[id].vue',
      'src/pages/index.astro',
      'src/routes/+page.svelte',
    ])
  })

  it('U2.2 Dart 글로브', async () => {
    write(path.join(tmp, 'lib/a.dart'))
    write(path.join(tmp, 'lib/b.dart'))
    write(path.join(tmp, 'lib/c.dart'))
    write(path.join(tmp, 'lib/x.ts'))
    const res = await globSourceFiles(tmp, '', 'dart')
    expect(res.length).toBe(3)
    expect(res.every((p) => p.endsWith('.dart'))).toBe(true)
  })

  it('U2.2b Java 글로브', async () => {
    write(path.join(tmp, 'src/main/java/com/acme/App.java'))
    write(path.join(tmp, 'src/test/java/com/acme/AppTest.java'))
    write(path.join(tmp, 'src/main/kotlin/com/acme/App.kt'))
    const res = await globSourceFiles(tmp, '', 'java')
    expect(res.sort()).toEqual([
      'src/main/java/com/acme/App.java',
      'src/test/java/com/acme/AppTest.java',
    ])
  })

  it('U2.2c Kotlin 글로브', async () => {
    write(path.join(tmp, 'src/main/kotlin/com/acme/App.kt'))
    write(path.join(tmp, 'src/test/kotlin/com/acme/AppTest.kt'))
    write(path.join(tmp, 'src/main/java/com/acme/App.java'))
    const res = await globSourceFiles(tmp, '', 'kotlin')
    expect(res.sort()).toEqual([
      'src/main/kotlin/com/acme/App.kt',
      'src/test/kotlin/com/acme/AppTest.kt',
    ])
  })

  it('U2.3 commonIgnore 기본', async () => {
    write(path.join(tmp, 'node_modules/x.ts'))
    write(path.join(tmp, 'dist/a.ts'))
    write(path.join(tmp, 'build/b.ts'))
    write(path.join(tmp, 'coverage/c.ts'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toEqual(['src/app.ts'])
  })

  it('U2.4 commonIgnore dot dirs (.next/.nuxt/.git)', async () => {
    write(path.join(tmp, '.next/a.ts'))
    write(path.join(tmp, '.nuxt/b.ts'))
    write(path.join(tmp, '.git/hooks/c.ts'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toEqual(['src/app.ts'])
  })

  it('U2.4b commonIgnore nested agent and managed worktree dirs', async () => {
    write(path.join(tmp, '.claude/worktrees/a/src/app.ts'))
    write(path.join(tmp, '.sdd/worktrees/a/src/app.ts'))
    write(path.join(tmp, '.platty/cache/src/app.ts'))
    write(path.join(tmp, '.worktrees/a/src/app.ts'))
    write(path.join(tmp, '.tmp-worktrees/a/src/app.ts'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toEqual(['src/app.ts'])
  })

  it('U2.4c commonIgnore generated scope guard dirs without excluding test source', async () => {
    write(path.join(tmp, 'src/app.ts'))
    write(path.join(tmp, 'tests/app.test.ts'))
    write(path.join(tmp, '.tmp/generated.ts'))
    write(path.join(tmp, 'fixtures/demo.ts'))
    write(path.join(tmp, 'fixture/demo.ts'))
    write(path.join(tmp, 'tests/fixtures/corpus/large.ts'))
    write(path.join(tmp, 'packages/api/dist/app.js'))
    write(path.join(tmp, 'packages/api/node_modules/lib/index.js'))
    write(path.join(tmp, 'coverage/report.ts'))

    const res = await globSourceFiles(tmp, '', 'typescript')

    expect(res.sort()).toEqual(['src/app.ts', 'tests/app.test.ts'])
  })

  it('U2.5 *.d.ts 제외', async () => {
    write(path.join(tmp, 'src/types.d.ts'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toEqual(['src/app.ts'])
  })

  it('U2.6 민감 파일 제외 (.env*, *.pem, *.key, *.p12, *.pfx)', async () => {
    write(path.join(tmp, '.env'))
    write(path.join(tmp, '.env.local'))
    write(path.join(tmp, 'cert.pem'))
    write(path.join(tmp, 'key.key'))
    write(path.join(tmp, 'app.p12'))
    write(path.join(tmp, 'app.pfx'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toEqual(['src/app.ts'])
  })

  it('U2.7 framework=react-native 추가 제외', async () => {
    write(path.join(tmp, 'ios/a.js'))
    write(path.join(tmp, 'android/b.js'))
    write(path.join(tmp, 'src/App.tsx'))
    const res = await globSourceFiles(tmp, 'react-native', 'typescript')
    expect(res).toEqual(['src/App.tsx'])
  })

  it('U2.8 framework=nestjs (allowlist 미매칭) — 추가 제외 없음', async () => {
    write(path.join(tmp, 'ios/a.ts'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, 'nestjs', 'typescript')
    expect(res.length).toBe(2)
  })

  it('U2.9 framework="" 빈 문자열', async () => {
    write(path.join(tmp, 'src/a.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toEqual(['src/a.ts'])
  })

  it('U2.10 framework 특수문자 주입 시도 — 크래시 없음', async () => {
    write(path.join(tmp, 'src/a.ts'))
    const r1 = await globSourceFiles(tmp, '*/**', 'typescript')
    expect(r1).toEqual(['src/a.ts'])
    const r2 = await globSourceFiles(tmp, '../../etc', 'typescript')
    expect(r2).toEqual(['src/a.ts'])
  })

  it('U2.11 allowlist 미매칭 값 → 빈 추가 제외', async () => {
    // 검증 방법: react-native 외 임의 값에서 ios/android가 살아남는지 확인
    const candidates = [
      'unknown',
      'nestjs',
      'express',
      'nextjs',
      'flutter',
      'angular',
      'vue',
      'react',
      '',
      'foo',
      'bar',
      'react native',
      'reactnative',
      'ReactNative',
      'react_native',
      'rn',
      'expo',
      'nuxt',
      'gatsby',
      'svelte',
    ]
    for (const f of candidates) {
      write(path.join(tmp, 'ios/x.ts'))
      const res = await globSourceFiles(tmp, f, 'typescript')
      expect(res.includes('ios/x.ts'), `framework=${f}`).toBe(true)
      fs.rmSync(path.join(tmp, 'ios'), { recursive: true })
    }
  })

  it('U2.12 Dart extraIgnore', async () => {
    write(path.join(tmp, '.dart_tool/a.dart'))
    write(path.join(tmp, 'build/b.dart'))
    write(path.join(tmp, 'lib/main.dart'))
    const res = await globSourceFiles(tmp, '', 'dart')
    expect(res).toEqual(['lib/main.dart'])
  })

  it('U2.13 빈 레포 → []', async () => {
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toEqual([])
  })

  it('U2.14 경계: maxFileCount override 5 → 5 정상', async () => {
    for (let i = 0; i < 5; i++) write(path.join(tmp, `f${i}.ts`))
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript', { maxFileCount: 5 })
    expect(res.length).toBe(5)
  })

  it('U2.15 경계: maxFileCount override 5 + 6개 → throw', async () => {
    for (let i = 0; i < 6; i++) write(path.join(tmp, `f${i}.ts`))
    await expect(
      collectSourceFiles('proj_1', tmp, '', 'typescript', { maxFileCount: 5 }),
    ).rejects.toThrow(/Too many source files/)
  })

  it.skipIf(process.env.SDD_SLOW_TEST !== '1')(
    'U2.15-slow: 10001개 파일 → throw',
    async () => {
      for (let i = 0; i < 10_001; i++) write(path.join(tmp, `f${i}.ts`))
      await expect(collectSourceFiles('proj_1', tmp, '', 'typescript')).rejects.toThrow(
        /Too many source files/,
      )
    },
    120_000,
  )

  it('U2.16 결정적 순서', async () => {
    write(path.join(tmp, 'a.ts'))
    write(path.join(tmp, 'b.ts'))
    write(path.join(tmp, 'c.ts'))
    const r1 = await globSourceFiles(tmp, '', 'typescript')
    const r2 = await globSourceFiles(tmp, '', 'typescript')
    expect(r1).toEqual(r2)
  })

  it('U2.17 followSymbolicLinks:false — symlink 디렉토리 미탐색', async () => {
    const realDir = path.join(tmp, 'src/real')
    write(path.join(realDir, 'a.ts'), 'export {}')
    const linkDir = path.join(tmp, 'src/link')
    try {
      fs.symlinkSync(realDir, linkDir, 'dir')
    } catch {
      return
    }
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res).toContain('src/real/a.ts')
    expect(res).not.toContain('src/link/a.ts')
  })

  it('U2.18 dot:true — .eslintrc.js 포함', async () => {
    write(path.join(tmp, '.eslintrc.js'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res.length).toBe(2)
    expect(res).toContain('.eslintrc.js')
  })

  it('U2.19 .secrets.ts 같은 관례 이름은 통과 (F1 범위 외)', async () => {
    write(path.join(tmp, '.secrets.ts'))
    write(path.join(tmp, 'src/app.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res.length).toBe(2)
  })

  it('U2.20 결과는 상대경로 (POSIX 확인은 통합 테스트)', async () => {
    write(path.join(tmp, 'src/a.ts'))
    const res = await globSourceFiles(tmp, '', 'typescript')
    expect(res[0]).toBe('src/a.ts')
    expect(path.isAbsolute(res[0])).toBe(false)
  })
})

// ════════════════════════════════════════════════
// 유닛: filterSafeFile
// ════════════════════════════════════════════════
describe('filterSafeFile', () => {
  let tmp: string
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    tmp = mkTmp('sdd-f1-fs-')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    rm(tmp)
    warnSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('U3.1 정상 텍스트 파일', async () => {
    const f = path.join(tmp, 'src/a.ts')
    write(f, 'export const x = 1')
    const res = await filterSafeFile(tmp, 'src/a.ts')
    expect(res).not.toBeNull()
    expect(res!.abs).toBe(fs.realpathSync(f))
    expect(res!.rel).toBe('src/a.ts')
    expect(res!.buffer.toString('utf-8')).toBe('export const x = 1')
  })

  it.skipIf(process.platform !== 'win32')('U3.2 rel POSIX 정규화 (Windows 전용)', async () => {
    // POSIX 시스템에서는 백슬래시가 파일명의 일부로 취급되므로 의미 없음.
    // Windows에서만 fast-glob이 백슬래시 구분자를 사용해 'src\\a.ts'를 발생시킴.
    write(path.join(tmp, 'src/a.ts'), 'x')
    const res = await filterSafeFile(tmp, 'src\\a.ts')
    expect(res?.rel).toBe('src/a.ts')
  })

  it('U3.3 절대경로 relPath 방어', async () => {
    const res = await filterSafeFile(tmp, '/etc/passwd')
    expect(res).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/absolute path/i)
  })

  it('U3.4 path traversal', async () => {
    const res = await filterSafeFile(tmp, '../evil.ts')
    expect(res).toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/Path traversal/)
  })

  it('U3.5 프리픽스 우회 (../repo-evil/x.ts)', async () => {
    // tmp = /tmp/sdd-f1-fs-XXX
    // relPath '../sdd-f1-evil-prefix/x.ts' resolve → /tmp/sdd-f1-evil-prefix/x.ts
    // tmp+sep는 /tmp/sdd-f1-fs-XXX/ → startsWith 실패
    const res = await filterSafeFile(tmp, '../sdd-f1-evil-prefix/x.ts')
    expect(res).toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/Path traversal/)
  })

  it('U3.6 symlink → repo 밖', async () => {
    const outside = path.join(os.tmpdir(), `sdd-f1-outside-${Date.now()}.txt`)
    write(outside, 'secret')
    const inside = path.join(tmp, 'evil.ts')
    try {
      fs.symlinkSync(outside, inside, 'file')
    } catch {
      return
    }
    const res = await filterSafeFile(tmp, 'evil.ts')
    expect(res).toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/Symlink/)
    rm(outside)
  })

  it('U3.7 symlink → repo 내부 + 6MB → too large', async () => {
    const real = path.join(tmp, 'big.ts')
    fs.writeFileSync(real, fakeBuffer(6 * 1024 * 1024))
    const link = path.join(tmp, 'link.ts')
    try {
      fs.symlinkSync(real, link, 'file')
    } catch {
      return
    }
    const res = await filterSafeFile(tmp, 'link.ts')
    expect(res).toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/too large/)
  })

  it('U3.8 symlink → repo 내부 + 정상', async () => {
    const real = path.join(tmp, 'real.ts')
    write(real, 'export {}')
    const link = path.join(tmp, 'link.ts')
    try {
      fs.symlinkSync(real, link, 'file')
    } catch {
      return
    }
    const res = await filterSafeFile(tmp, 'link.ts')
    expect(res).not.toBeNull()
    expect(res!.abs).toBe(fs.realpathSync(link))
  })

  it('U3.9 symlink ELOOP', async () => {
    vi.spyOn(fs.promises, 'realpath').mockRejectedValueOnce(
      Object.assign(new Error('ELOOP'), { code: 'ELOOP' }),
    )
    const res = await filterSafeFile(tmp, 'a.ts')
    expect(res).toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/realpath/)
  })

  it('U3.10 realpath ENOENT (glob 후 삭제)', async () => {
    const res = await filterSafeFile(tmp, 'ghost.ts')
    expect(res).toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/realpath/)
  })

  it('U3.11 realpath OK + stat ENOENT (mock)', async () => {
    write(path.join(tmp, 'a.ts'), 'x')
    vi.spyOn(fs.promises, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    )
    const res = await filterSafeFile(tmp, 'a.ts')
    expect(res).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('U3.12 stat EACCES (mock)', async () => {
    write(path.join(tmp, 'a.ts'), 'x')
    vi.spyOn(fs.promises, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    )
    const res = await filterSafeFile(tmp, 'a.ts')
    expect(res).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('U3.13 stat EIO (mock)', async () => {
    write(path.join(tmp, 'a.ts'), 'x')
    vi.spyOn(fs.promises, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('EIO'), { code: 'EIO' }),
    )
    const res = await filterSafeFile(tmp, 'a.ts')
    expect(res).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('U3.14 5MB+1B → too large', async () => {
    write(path.join(tmp, 'big.ts'), fakeBuffer(MAX_FILE_BYTES + 1))
    const res = await filterSafeFile(tmp, 'big.ts')
    expect(res).toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/too large/)
  })

  it('U3.15 5MB 정확 — 통과', async () => {
    write(path.join(tmp, 'edge.ts'), fakeBuffer(MAX_FILE_BYTES))
    const res = await filterSafeFile(tmp, 'edge.ts')
    expect(res).not.toBeNull()
  })

  it('U3.16 5MB-1B — 통과', async () => {
    write(path.join(tmp, 'small.ts'), fakeBuffer(MAX_FILE_BYTES - 1))
    const res = await filterSafeFile(tmp, 'small.ts')
    expect(res).not.toBeNull()
  })

  it('U3.17 바이너리 (첫 8KB null byte) — silent skip', async () => {
    const buf = Buffer.alloc(100, 0xff)
    buf[10] = 0x00
    write(path.join(tmp, 'bin.ts'), buf)
    const res = await filterSafeFile(tmp, 'bin.ts')
    expect(res).toBeNull()
    expect(warnSpy).not.toHaveBeenCalled() // silent
  })

  it('U3.18 바이너리 (8KB 이후 null byte) — heuristic 한계, 통과', async () => {
    const buf = Buffer.alloc(9000, 0x61)
    buf[8500] = 0x00
    write(path.join(tmp, 'pseudo.ts'), buf)
    const res = await filterSafeFile(tmp, 'pseudo.ts')
    expect(res).not.toBeNull()
  })

  it('U3.19 readFile EACCES (mock)', async () => {
    write(path.join(tmp, 'a.ts'), 'x')
    vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    )
    const res = await filterSafeFile(tmp, 'a.ts')
    expect(res).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('U3.20 buffer 정확성', async () => {
    const content = 'export const x = 1\nconst y = 2'
    write(path.join(tmp, 'a.ts'), content)
    const res = await filterSafeFile(tmp, 'a.ts')
    expect(res!.buffer.toString('utf-8')).toBe(content)
    expect(res!.size).toBe(Buffer.byteLength(content, 'utf-8'))
  })

  it('U3.21 구문 깨진 TS 텍스트 — 정상 반환', async () => {
    write(path.join(tmp, 'broken.ts'), 'export const = ;')
    const res = await filterSafeFile(tmp, 'broken.ts')
    expect(res).not.toBeNull()
    expect(res!.buffer.toString('utf-8')).toBe('export const = ;')
  })

  // Step 0b: pipe-char 방어 (불변식 #12 / build_graph 불변식 #13)
  it('U3.22 정상: pipe 미포함 경로 통과', async () => {
    write(path.join(tmp, 'src/a.ts'), 'export const x = 1')
    const res = await filterSafeFile(tmp, 'src/a.ts')
    expect(res).not.toBeNull()
    expect(warnSpy.mock.calls.flat().join(' ')).not.toMatch(/reserved separator/)
  })

  it('U3.23 에러: relPath에 pipe 포함 → null + warn (dir 구분자에 pipe)', async () => {
    const res = await filterSafeFile(tmp, 'src/a|b.ts')
    expect(res).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/reserved separator|\|/)
  })

  it('U3.24 에러: 파일명 중간에 pipe → null + warn', async () => {
    const res = await filterSafeFile(tmp, 'foo|bar.ts')
    expect(res).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/reserved separator|\|/)
  })

  // Step 0b 통합: 실제 파일시스템에 pipe 파일이 있어도 filterSafeFile이 차단
  // macOS/Linux만 '|' 파일명 허용 — Windows 스킵
  it.skipIf(process.platform === 'win32')(
    'U3.25 통합: FS에 pipe 파일 존재해도 filterSafeFile skip',
    async () => {
      const f = path.join(tmp, 'pipe|file.ts')
      try {
        write(f, 'export const x = 1')
      } catch {
        return // FS가 '|' 미허용 시 스킵
      }
      const res = await filterSafeFile(tmp, 'pipe|file.ts')
      expect(res).toBeNull()
      expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/reserved separator|\|/)
    },
  )
})

// ════════════════════════════════════════════════
// 유닛: readFileContent (순수 함수)
// ════════════════════════════════════════════════
describe('readFileContent', () => {
  it('U4.1 정상 UTF-8', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'src/a.ts', size: 18, buffer: Buffer.from('export const x = 1', 'utf-8') },
      TS_LANG,
    )
    expect(res).toEqual({ path: 'src/a.ts', content: 'export const x = 1', isTest: false })
  })

  it('U4.2 UTF-8 BOM 제거', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const buf = Buffer.concat([bom, Buffer.from('hello', 'utf-8')])
    const res = readFileContent({ abs: '/x', rel: 'a.ts', size: buf.length, buffer: buf }, TS_LANG)
    expect(res.content.charCodeAt(0)).not.toBe(0xfeff)
    expect(res.content).toBe('hello')
  })

  it('U4.3 UTF-16 LE BOM (알려진 한계) — throw 없음', () => {
    const buf = Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])
    const res = readFileContent({ abs: '/x', rel: 'a.ts', size: 6, buffer: buf }, TS_LANG)
    expect(typeof res.content).toBe('string') // 깨진 채 반환 (throw 없음)
  })

  it('U4.4 빈 파일', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'a.ts', size: 0, buffer: Buffer.alloc(0) },
      TS_LANG,
    )
    expect(res.content).toBe('')
    expect(res.isTest).toBe(false)
  })

  it('U4.5 한글', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'a.ts', size: 0, buffer: Buffer.from('한글 내용', 'utf-8') },
      TS_LANG,
    )
    expect(res.content).toBe('한글 내용')
  })

  it('U4.6 .spec.ts → isTest', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'src/a.spec.ts', size: 0, buffer: Buffer.from('') },
      TS_LANG,
    )
    expect(res.isTest).toBe(true)
  })

  it('U4.7 .test.ts → isTest', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'src/a.test.ts', size: 0, buffer: Buffer.from('') },
      TS_LANG,
    )
    expect(res.isTest).toBe(true)
  })

  it('U4.8 .e2e-spec.ts → isTest', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'test/x.e2e-spec.ts', size: 0, buffer: Buffer.from('') },
      TS_LANG,
    )
    expect(res.isTest).toBe(true)
  })

  it('U4.8b meta-framework component specs → isTest', () => {
    const rels = [
      'src/routes/page.spec.svelte',
      'src/pages/index.test.astro',
      'pages/users/[id].e2e-spec.vue',
    ]
    for (const rel of rels) {
      const res = readFileContent(
        { abs: '/x', rel, size: 0, buffer: Buffer.from('') },
        TS_LANG,
      )
      expect(res.isTest, rel).toBe(true)
    }
  })

  it('U4.9 __tests__/a.ts → isTest=false (의도된 동작)', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'src/__tests__/a.ts', size: 0, buffer: Buffer.from('') },
      TS_LANG,
    )
    expect(res.isTest).toBe(false)
  })

  it('U4.10 spec-helper.ts → isTest=false', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'src/spec-helper.ts', size: 0, buffer: Buffer.from('') },
      TS_LANG,
    )
    expect(res.isTest).toBe(false)
  })

  it('U4.11 Dart _test.dart → isTest', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'test/a_test.dart', size: 0, buffer: Buffer.from('') },
      DART_LANG,
    )
    expect(res.isTest).toBe(true)
  })

  it('U4.12 Dart lib/main.dart → isTest=false', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'lib/main.dart', size: 0, buffer: Buffer.from('') },
      DART_LANG,
    )
    expect(res.isTest).toBe(false)
  })

  it('U4.13 path 그대로', () => {
    const res = readFileContent(
      { abs: '/x', rel: 'src/foo/bar.ts', size: 0, buffer: Buffer.from('') },
      TS_LANG,
    )
    expect(res.path).toBe('src/foo/bar.ts')
  })
})

// ════════════════════════════════════════════════
// 통합 테스트
// ════════════════════════════════════════════════
describe('collectSourceFiles — 통합', () => {
  let tmp: string
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    tmp = mkTmp('sdd-f1-int-')
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    rm(tmp)
    warnSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('I1 S1: NestJS happy — 9 파일', async () => {
    // NestJS 스타일 fixture
    const files = [
      'src/app.module.ts',
      'src/app.controller.ts',
      'src/app.service.ts',
      'src/order/order.module.ts',
      'src/order/order.controller.ts',
      'src/order/order.service.ts',
      'src/order/dto/create-order.dto.ts',
      'src/order/guards/auth.guard.ts',
      'test/order.e2e-spec.ts',
      // 제외 대상
      'node_modules/@nestjs/common/index.ts',
      'dist/main.js',
      'src/types.d.ts',
    ]
    for (const f of files) write(path.join(tmp, f), `// ${f}`)

    const res = await collectSourceFiles('proj_1', tmp, 'nestjs', 'typescript')
    expect(res.length).toBe(9) // 9 src + test files
    const paths = res.map((f) => f.path)
    expect(paths).toContain('src/app.module.ts')
    expect(paths).toContain('test/order.e2e-spec.ts')
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false)
    expect(paths.some((p) => p.startsWith('dist/'))).toBe(false)
    expect(paths.some((p) => p.endsWith('.d.ts'))).toBe(false)
    // POSIX
    expect(paths.every((p) => !p.includes('\\'))).toBe(true)
    // isTest
    expect(res.find((f) => f.path === 'test/order.e2e-spec.ts')!.isTest).toBe(true)
    expect(res.find((f) => f.path === 'src/app.module.ts')!.isTest).toBe(false)
  })

  it('I2 S3: Flutter happy — .dart 수집 + test/ → isTest', async () => {
    const files = [
      'lib/main.dart',
      'lib/services/auth.dart',
      'lib/widgets/button.dart',
      'test/auth_test.dart',
      'test/button_test.dart',
      // 제외
      '.dart_tool/package_config.json',
      'build/output.dart',
    ]
    for (const f of files) write(path.join(tmp, f), `// ${f}`)
    const res = await collectSourceFiles('proj_dart', tmp, 'flutter', 'dart')
    expect(res.length).toBe(5)
    expect(res.find((f) => f.path === 'test/auth_test.dart')!.isTest).toBe(true)
    expect(res.find((f) => f.path === 'lib/main.dart')!.isTest).toBe(false)
  })

  it('I3 재실행 멱등', async () => {
    write(path.join(tmp, 'src/a.ts'), 'export {}')
    write(path.join(tmp, 'src/b.ts'), 'export {}')
    const r1 = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    const r2 = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(r1).toEqual(r2)
  })

  it('I4 비멱등: FS 변경 반영', async () => {
    write(path.join(tmp, 'src/a.ts'), 'export {}')
    const r1 = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    write(path.join(tmp, 'src/b.ts'), 'export {}')
    const r2 = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(r2.length).toBe(r1.length + 1)
  })

  it('I5 S7: 부분 skip — binary/huge 미포함, broken 포함', async () => {
    for (let i = 0; i < 7; i++) write(path.join(tmp, `src/n${i}.ts`), 'export {}')
    // binary
    const bin = Buffer.alloc(100, 0xff)
    bin[5] = 0x00
    write(path.join(tmp, 'src/binary.ts'), bin)
    // huge
    write(path.join(tmp, 'src/huge.ts'), fakeBuffer(6 * 1024 * 1024))
    // broken text
    write(path.join(tmp, 'src/broken.ts'), 'export const = ;')

    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(res.length).toBe(8) // 7 normal + broken
    expect(res.some((f) => f.path === 'src/binary.ts')).toBe(false)
    expect(res.some((f) => f.path === 'src/huge.ts')).toBe(false)
    expect(res.some((f) => f.path === 'src/broken.ts')).toBe(true)
  })

  it('I6 S9: 파일 수 초과 (overrides=5, 6개) → throw', async () => {
    for (let i = 0; i < 6; i++) write(path.join(tmp, `f${i}.ts`))
    const err = await collectSourceFiles('proj_1', tmp, '', 'typescript', {
      maxFileCount: 5,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(BuildGraphError)
    expect(err.message).toMatch(/Too many source files/)
    expect(err.message).toMatch(/max: 5/)
    expect(err.message).not.toMatch(/10001|10,001|6 /) // count 미노출
  })

  it('I7 S10: 파일 수 0 → throw', async () => {
    write(path.join(tmp, 'README.md'), '#')
    await expect(collectSourceFiles('proj_1', tmp, '', 'typescript')).rejects.toThrow(
      /No source files found/,
    )
  })

  it('I7b 글로브 파일 있으나 전부 바이너리 필터링 → throw', async () => {
    const bin = Buffer.alloc(100, 0xff)
    bin[5] = 0x00
    write(path.join(tmp, 'src/a.ts'), bin)
    write(path.join(tmp, 'src/b.ts'), bin)
    await expect(collectSourceFiles('proj_1', tmp, '', 'typescript')).rejects.toThrow(
      /No source files found/,
    )
  })

  it('I8 S15: symlink outside repo → 결과에 미포함', async () => {
    write(path.join(tmp, 'src/normal.ts'), 'export {}')
    const outside = path.join(os.tmpdir(), `sdd-f1-secret-${Date.now()}.ts`)
    write(outside, 'secret')
    try {
      fs.symlinkSync(outside, path.join(tmp, 'src/evil.ts'), 'file')
    } catch {
      rm(outside)
      return
    }
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    // fast-glob followSymbolicLinks:false 또는 filterSafeFile symlink 검증으로 evil.ts skip
    expect(res.map((f) => f.path)).toEqual(['src/normal.ts'])
    rm(outside)
  })

  it('I9 S16: 잘못된 repoId → throw, glob 미실행', async () => {
    write(path.join(tmp, 'src/a.ts'), 'export {}')
    // fast-glob을 모두 spy하기는 어려우므로 readdir류 호출이 없는지 간접 확인
    const readdirSpy = vi.spyOn(fs.promises, 'readdir')
    const err = await collectSourceFiles('invalid!!!@#$', tmp, '', 'typescript').catch((e) => e)
    expect(err).toBeInstanceOf(BuildGraphError)
    expect(err.message).toMatch(/Invalid repoId format/)
    expect(err.message).toMatch(/repoId/)
    expect(readdirSpy).not.toHaveBeenCalled()
  })

  it('I10 repoPath 상대경로 → throw', async () => {
    await expect(collectSourceFiles('proj_1', './repo', '', 'typescript')).rejects.toThrow(
      /must be absolute/,
    )
  })

  it('I11 repoPath ENOENT — message에 repoPath 미포함', async () => {
    const ghost = '/nope/' + 'aaaaaaaa-' + Date.now()
    const err = await collectSourceFiles('proj_1', ghost, '', 'typescript').catch((e) => e)
    expect(err.message).toMatch(/does not exist/)
    expect(err.message).not.toContain(ghost)
  })

  it('I12 repoPath = 파일 — message에 repoPath 미포함', async () => {
    const f = path.join(tmp, 'a.txt')
    write(f, 'x')
    const err = await collectSourceFiles('proj_1', f, '', 'typescript').catch((e) => e)
    expect(err.message).toMatch(/not a directory/)
    expect(err.message).not.toContain(f)
  })

  it('I13 framework=react-native → ios/android 제외', async () => {
    write(path.join(tmp, 'src/App.tsx'), 'export {}')
    write(path.join(tmp, 'ios/x.js'), 'export {}')
    write(path.join(tmp, 'android/y.js'), 'export {}')
    const res = await collectSourceFiles('proj_1', tmp, 'react-native', 'typescript')
    expect(res.map((f) => f.path)).toEqual(['src/App.tsx'])
  })

  it('I14 framework=unknown → 모두 포함', async () => {
    write(path.join(tmp, 'ios/a.ts'), 'export {}')
    write(path.join(tmp, 'src/b.ts'), 'export {}')
    const res = await collectSourceFiles('proj_1', tmp, 'unknown', 'typescript')
    expect(res.length).toBe(2)
  })

  it('I15 BOM 처리 (UTF-8)', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    write(path.join(tmp, 'src/a.ts'), Buffer.concat([bom, Buffer.from('export {}', 'utf-8')]))
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(res[0].content.charCodeAt(0)).not.toBe(0xfeff)
    expect(res[0].content).toBe('export {}')
  })

  it('I16 500MB 누적 break — overrides 5MB cap, 3MB 파일 3개 → 1개 반환', async () => {
    write(path.join(tmp, 'src/a.ts'), fakeBuffer(3 * 1024 * 1024))
    write(path.join(tmp, 'src/b.ts'), fakeBuffer(3 * 1024 * 1024))
    write(path.join(tmp, 'src/c.ts'), fakeBuffer(3 * 1024 * 1024))
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript', {
      maxTotalBytes: 5 * 1024 * 1024,
    })
    expect(res.length).toBe(1)
    const warnText = warnSpy.mock.calls.flat().join(' ')
    expect(warnText).toMatch(/would exceed 500MB/)
  })

  it('I17 결과 배열 순서 결정적', async () => {
    for (const n of ['a', 'b', 'c', 'd']) write(path.join(tmp, `src/${n}.ts`), 'x')
    const r1 = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    const r2 = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(r1.map((f) => f.path)).toEqual(r2.map((f) => f.path))
  })

  it.skipIf(process.platform !== 'win32')('I18 path POSIX 정규화 (Windows 전용)', async () => {
    // Windows에서만 의미가 있음
    write(path.join(tmp, 'src', 'sub', 'a.ts'), 'x')
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    for (const f of res) {
      expect(f.path.includes('\\')).toBe(false)
    }
  })

  it('I19 .d.ts 제외 (통합)', async () => {
    write(path.join(tmp, 'src/types.d.ts'), 'export interface Foo {}')
    write(path.join(tmp, 'src/app.ts'), 'export {}')
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(res.map((f) => f.path)).toEqual(['src/app.ts'])
  })

  it('I20 .git/ 제외 (통합)', async () => {
    write(path.join(tmp, '.git/HEAD'), 'ref')
    write(path.join(tmp, '.git/hooks/a.ts'), 'export {}')
    write(path.join(tmp, 'src/app.ts'), 'export {}')
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(res.map((f) => f.path)).toEqual(['src/app.ts'])
  })

  it('I21 민감 파일 제외 (통합)', async () => {
    write(path.join(tmp, '.env'), 'X=1')
    write(path.join(tmp, '.env.local'), 'X=2')
    write(path.join(tmp, 'cert.pem'), '-')
    write(path.join(tmp, 'key.key'), '-')
    write(path.join(tmp, 'app.p12'), '-')
    write(path.join(tmp, 'app.pfx'), '-')
    write(path.join(tmp, 'src/app.ts'), 'export {}')
    const res = await collectSourceFiles('proj_1', tmp, '', 'typescript')
    expect(res.map((f) => f.path)).toEqual(['src/app.ts'])
  })

  it('I22 에러 경로: DB/FS write 없음', async () => {
    write(path.join(tmp, 'src/a.ts'), 'export {}')
    // fs.writeFileSync는 ESM에서 spy 불가 → fs.promises.writeFile만 검증.
    // F1은 fs.promises만 사용하므로 충분.
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile')
    const appendFileSpy = vi.spyOn(fs.promises, 'appendFile')
    await expect(
      collectSourceFiles('invalid!!!@#$', tmp, '', 'typescript'),
    ).rejects.toThrow(/Invalid repoId format/)
    expect(writeFileSpy).not.toHaveBeenCalled()
    expect(appendFileSpy).not.toHaveBeenCalled()
  })

  it('I23 repoPath가 symlink인 레포 — 정상 수집', async () => {
    const realRepo = path.join(tmp, 'real-repo')
    fs.mkdirSync(realRepo)
    write(path.join(realRepo, 'src/a.ts'), 'export {}')
    const linkRepo = path.join(tmp, 'link-repo')
    try {
      fs.symlinkSync(realRepo, linkRepo, 'dir')
    } catch {
      return
    }
    const res = await collectSourceFiles('proj_1', linkRepo, '', 'typescript')
    expect(res.length).toBe(1)
    expect(res[0].path).toBe('src/a.ts')
    const warnText = warnSpy.mock.calls.flat().join(' ')
    expect(warnText).not.toMatch(/Symlink points outside repo/)
  })
})

// ════════════════════════════════════════════════
// isInsideRepo (export 검증)
// ════════════════════════════════════════════════
describe('isInsideRepo', () => {
  it('동일 경로 → true', () => {
    expect(isInsideRepo('/repo', '/repo')).toBe(true)
  })
  it('내부 경로 → true', () => {
    expect(isInsideRepo('/repo', `/repo${path.sep}src/a.ts`)).toBe(true)
  })
  it('프리픽스 우회 차단', () => {
    expect(isInsideRepo('/repo', '/repo-evil/x')).toBe(false)
  })
  it('외부 경로 → false', () => {
    expect(isInsideRepo('/repo', '/etc/passwd')).toBe(false)
  })
})

// ════════════════════════════════════════════════
// 모듈 상수 export 검증
// ════════════════════════════════════════════════
describe('module exports', () => {
  it('상수 값 검증', () => {
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_TOTAL_BYTES).toBe(500 * 1024 * 1024)
    expect(MAX_FILE_COUNT).toBe(200_000)
    expect(BINARY_HEADER_SIZE).toBe(8192)
  })
})
