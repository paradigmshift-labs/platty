/**
 * F1: collectSourceFiles — 소스 파일 수집 + 검증 (비동기판)
 * SOT: specs/build_graph/specs/f1_collect_source_files/spec.md
 *
 * 책임:
 *   - repoId 형식 검증 + repoPath 검증 + realpath 정규화
 *   - glob으로 전체 소스 파일 수집 (공통/framework/language ignore)
 *   - 파일 수 상한 / 0 검증
 *   - per-file: 절대경로 방어, path traversal, symlink, 5MB, binary 필터
 *   - per-file: BOM 제거 + isTest 판정
 *   - 누적 500MB 초과 직전 break
 *
 * 모든 파일 I/O는 fs.promises 사용 (비동기).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import fg from 'fast-glob'
import type { LanguageConfig, SourceFile } from './types.js'
import { BuildGraphError, getLanguageConfig } from './types.js'

// ── 상수 (export — spec §테스트 후킹) ──
export const REPO_ID_RE = /^[a-zA-Z0-9_-]+$/
export const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5MB
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024 // 500MB
export const DEFAULT_MAX_FILE_COUNT = 200_000
export const MAX_FILE_COUNT = readPositiveIntEnv(['PLATTY_BUILD_GRAPH_MAX_FILE_COUNT', 'PLATTY_BUILD_GRAPH_MAX_FILE_COUNT'], DEFAULT_MAX_FILE_COUNT)
export const BINARY_HEADER_SIZE = 8192 // 8KB
export const DEFAULT_SCOPE_GUARD_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/fixtures/**',
  '**/fixture/**',
  '**/corpus/**',
  '**/.tmp/**',
  '**/tmp/**',
  '**/.cache/**',
  '**/.turbo/**',
]

// ── 내부 타입 ──
interface FilteredFile {
  abs: string // realpath 결과
  rel: string // POSIX 정규화된 상대경로
  size: number // stat.size (500MB 누적 사전 체크용)
  buffer: Buffer // 파일 전체 bytes
}

// ────────────────────────────────────────────────
// framework allowlist (불변식 11)
// allowlist 미매칭 시 [] 반환 — glob 주입 방지
// ────────────────────────────────────────────────
function getFrameworkExcludePatterns(framework: string): string[] {
  switch (framework) {
    case 'react-native':
      return ['ios/**', 'android/**']
    default:
      return []
  }
}

/**
 * absolutePath가 normalizedRepo 내부에 있는지 검증.
 * `/repo` vs `/repo-evil` 프리픽스 우회 방지: `path.sep` 경계 강제.
 * @internal
 */
export function isInsideRepo(normalizedRepo: string, absolutePath: string): boolean {
  if (absolutePath === normalizedRepo) return true
  return absolutePath.startsWith(normalizedRepo + path.sep)
}

// ────────────────────────────────────────────────
// 서브함수 1: validateRepoId
// ────────────────────────────────────────────────
/**
 * repoId 형식 + repoPath 절대경로/존재/디렉토리 검증.
 * realpath로 정규화한 normalizedRepo 반환.
 */
export async function validateRepoId(
  repoId: string,
  repoPath: string,
): Promise<string> {
  if (!REPO_ID_RE.test(repoId)) {
    throw new BuildGraphError('Invalid repoId format', 'GRAPH_FAILED')
  }
  if (!path.isAbsolute(repoPath)) {
    throw new BuildGraphError('Repository path must be absolute', 'GRAPH_FAILED')
  }
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(repoPath)
  } catch {
    throw new BuildGraphError('Repository path does not exist', 'GRAPH_FAILED')
  }
  if (!stat.isDirectory()) {
    throw new BuildGraphError('Repository path is not a directory', 'GRAPH_FAILED')
  }
  // repoPath 자체가 symlink인 경우 물리 경로로 정규화
  const normalizedRepo = await fs.promises.realpath(repoPath)
  return normalizedRepo
}

// ────────────────────────────────────────────────
// 서브함수 2: globSourceFiles
// ────────────────────────────────────────────────
/**
 * fast-glob으로 소스 파일 수집.
 * 공통 ignore + framework ignore + langConfig.extraIgnore 적용.
 * dot:true (.eslintrc.js 등 dotfile 포함), followSymbolicLinks:false.
 */
export async function globSourceFiles(
  normalizedRepo: string,
  framework: string,
  language: string,
): Promise<string[]> {
  const langConfig = getLanguageConfig(language)
  const commonIgnore = [
    'node_modules/**',
    'dist/**',
    'build/**',
    '.next/**',
    '.nuxt/**',
    '.git/**',
    '.claude/**',
    '.sdd/**',
    '.platty/**',
    '.worktrees/**',
    '.tmp-worktrees/**',
    'coverage/**',
    ...DEFAULT_SCOPE_GUARD_IGNORE,
    '**/*.d.ts',
    '**/.env*',
    '**/*.pem',
    '**/*.key',
    '**/*.p12',
    '**/*.pfx',
  ]
  const frameworkIgnore = getFrameworkExcludePatterns(framework)
  const langIgnore = langConfig.extraIgnore
  const ignore = [...commonIgnore, ...frameworkIgnore, ...langIgnore]

  const relativePaths = await fg(langConfig.glob, {
    cwd: normalizedRepo,
    ignore,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  })
  return relativePaths
}

// ────────────────────────────────────────────────
// 서브함수 3: filterSafeFile (per-file)
// ────────────────────────────────────────────────
/**
 * 단일 파일에 대해 절대경로/traversal/symlink/size/binary 필터를 적용.
 * 통과 시 FilteredFile, skip 시 null 반환.
 * 모든 skip은 console.warn (단, 바이너리는 silent).
 */
export async function filterSafeFile(
  normalizedRepo: string,
  relPath: string,
  maxFileBytes: number = MAX_FILE_BYTES,
): Promise<FilteredFile | null> {
  // step 0: 절대경로 방어 (glob 버그 대비)
  if (path.isAbsolute(relPath)) {
    console.warn(`[F1] Unexpected absolute path from glob, skip`)
    return null
  }

  // step 0b: build_graph Map key 구분자 '|' 방어 (불변식 #12 / build_graph 불변식 #13)
  if (relPath.includes('|')) {
    console.warn(`[F1] Path contains reserved separator "|", skip`)
    return null
  }

  // step 1: path traversal 방어
  const logicalAbs = path.resolve(normalizedRepo, relPath)
  if (!isInsideRepo(normalizedRepo, logicalAbs)) {
    console.warn(`[F1] Path traversal attempt, skip`)
    return null
  }

  // step 2: symlink realpath 검증
  let realPath: string
  try {
    realPath = await fs.promises.realpath(logicalAbs)
  } catch (err: any) {
    console.warn(`[F1] realpath failed: ${err?.code ?? err?.message ?? 'unknown'}`)
    return null
  }
  if (!isInsideRepo(normalizedRepo, realPath)) {
    console.warn(`[F1] Symlink points outside repo, skip`)
    return null
  }

  // step 3: 파일 크기 상한 — realPath 기준 stat
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(realPath)
  } catch (err: any) {
    console.warn(`[F1] stat failed: ${err?.code ?? err?.message ?? 'unknown'}`)
    return null
  }
  if (stat.size > maxFileBytes) {
    console.warn(`[F1] File too large (${stat.size} bytes), skip`)
    return null
  }

  // step 4: 파일 읽기 + 바이너리 감지
  let buffer: Buffer
  try {
    buffer = await fs.promises.readFile(realPath)
  } catch (err: any) {
    console.warn(`[F1] readFile failed: ${err?.code ?? err?.message ?? 'unknown'}`)
    return null
  }
  const header = buffer.subarray(0, BINARY_HEADER_SIZE)
  if (header.includes(0x00)) {
    // 바이너리 — silent skip (의도)
    return null
  }

  // step 5: 반환
  return {
    abs: realPath,
    rel: relPath.replace(/\\/g, '/'),
    size: stat.size,
    buffer,
  }
}

// ────────────────────────────────────────────────
// 서브함수 4: readFileContent (per-file, 순수 함수)
// ────────────────────────────────────────────────
/**
 * FilteredFile → SourceFile 변환.
 * BOM(UTF-8) 제거 + isTest 판정.
 */
export function readFileContent(
  filtered: FilteredFile,
  langConfig: LanguageConfig,
): SourceFile {
  let content = filtered.buffer.toString('utf-8')
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1)
  }
  const isTest = langConfig.testPattern.test(filtered.rel)
  return {
    path: filtered.rel,
    content,
    isTest,
  }
}

// ────────────────────────────────────────────────
// F1 본체
// ────────────────────────────────────────────────
export async function collectSourceFiles(
  repoId: string,
  repoPath: string,
  framework: string,
  language: string,
  __overrides?: {
    maxTotalBytes?: number
    maxFileBytes?: number
    maxFileCount?: number
  },
): Promise<SourceFile[]> {
  const maxFileBytes = __overrides?.maxFileBytes ?? MAX_FILE_BYTES
  const maxTotalBytes = __overrides?.maxTotalBytes ?? MAX_TOTAL_BYTES
  const maxFileCount = __overrides?.maxFileCount ?? MAX_FILE_COUNT

  // ── Step 1: validate ──
  const normalizedRepo = await validateRepoId(repoId, repoPath)

  // ── Step 2: glob ──
  const langConfig = getLanguageConfig(language)
  const relativePaths = await globSourceFiles(normalizedRepo, framework, language)

  // ── Step 3: 파일 수 상한/하한 ──
  if (relativePaths.length > maxFileCount) {
    console.warn(`[F1] Source file count ${relativePaths.length} exceeds limit ${maxFileCount}`)
    throw new BuildGraphError(`Too many source files (max: ${formatCount(maxFileCount)})`, 'GRAPH_FAILED')
  }
  if (relativePaths.length === 0) {
    throw new BuildGraphError('No source files found', 'GRAPH_FAILED')
  }

  // ── Step 4: per-file 처리 + 누적 500MB 사전 체크 ──
  const results: SourceFile[] = []
  let totalBytes = 0

  for (const rel of relativePaths) {
    const filtered = await filterSafeFile(normalizedRepo, rel, maxFileBytes)
    if (!filtered) continue

    if (totalBytes + filtered.size > maxTotalBytes) {
      console.warn(
        `[F1] Total content size would exceed 500MB, truncating at ${results.length} files`,
      )
      break
    }
    totalBytes += filtered.size

    results.push(readFileContent(filtered, langConfig))
  }

  if (results.length === 0) {
    throw new BuildGraphError('No source files found after filtering', 'GRAPH_FAILED')
  }

  return results
}

function readPositiveIntEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name]
    if (!raw) continue
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
