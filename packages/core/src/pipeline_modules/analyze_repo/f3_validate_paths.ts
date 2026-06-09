/**
 * F3: validatePaths — 경로 검증 (no LLM)
 *
 * V2 축소 범위 (M2 §3.1 — test/controller/worker/page_patterns 컬럼 제거):
 *   - schema_sources (glob → 누락 추적)
 *   - routing_files (glob → 발견 목록)
 *   - entrypoint_files (glob → 발견 목록)
 * 출력: ValidatedPaths (V2 — repositories.validation_warnings에 매핑)
 */

import fs from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'
import type { StackInfo } from './types.js'
import type { Warning } from '@/db/schema/json_types/warning.js'

interface GlobTask {
  field: string
  pattern: string
  maxDepth: number | undefined
}

interface NormalizeResult {
  verified: string | null
  warning?: Warning
}

export interface ValidatedPaths {
  schema_files_found: string[]
  schema_files_missing: string[]
  routing_files_found: string[]
  entrypoint_files_found: string[]
  warnings: Warning[]
}

const DANGEROUS_PATTERN = /(^|\/)\.\.($|\/)/
// ★ N1: 한도 대폭 상향 — 거대 monorepo 대응 (heroines_back 같은 1만+ 파일 repo)
const MAX_CUMULATIVE_FILES = 100_000
const PER_PATTERN_WARNING_THRESHOLD = 5_000
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_ARRAY_SIZE = 50
const MAX_SCHEMA_SOURCES = 20
const MAX_SCHEMA_PATHS = 50

const ARRAY_FIELD_NAMES = ['routing_files', 'entrypoint_files'] as const

export async function runGlobWithTimeout(
  pattern: string | string[],
  options: object,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<{ files: string[]; timedOut: boolean }> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  return new Promise<{ files: string[]; timedOut: boolean }>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve({ files: [], timedOut: true })
      }
    }, timeoutMs)

    const settle = (result: { files: string[]; timedOut: boolean }) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(result) }
    }
    const fail = (err: Error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err) }
    }
    fg(pattern as string, options as fg.Options)
      .then((files) => settle({ files, timedOut: false }))
      .catch((err) => fail(err))
    if (signal) {
      signal.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError')), { once: true })
    }
  })
}

export function normalizeAndVerify(rawPath: string, resolvedRepo: string, field: string): NormalizeResult {
  const sanitized = rawPath.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, '')
  const normalizedAbs = path.join(resolvedRepo, rawPath)
  if (!normalizedAbs.startsWith(resolvedRepo + path.sep)) {
    return { verified: null, warning: { field, message: `경로 탈출 시도 차단: ${sanitized}`, severity: 'low' } }
  }
  let real: string
  try { real = fs.realpathSync(normalizedAbs) } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP') return { verified: null, warning: { field, message: `순환 symlink 경로 제외: ${sanitized} (ELOOP)`, severity: 'low' } }
    return { verified: null, warning: { field, message: `경로 확인 실패: ${sanitized}`, severity: 'low' } }
  }
  if (real !== resolvedRepo && !real.startsWith(resolvedRepo + path.sep)) {
    return { verified: null, warning: { field, message: `symlink 경로 제외: ${sanitized}`, severity: 'low' } }
  }
  return { verified: path.relative(resolvedRepo, real) }
}

export async function validatePaths(
  repoPath: string,
  stackInfo: StackInfo,
  signal?: AbortSignal,
): Promise<ValidatedPaths> {
  if (typeof repoPath !== 'string' || repoPath.trim() === '') {
    throw new Error('INVALID_REPO_PATH')
  }
  const warnings: Warning[] = []

  for (const field of ARRAY_FIELD_NAMES) {
    const val = (stackInfo as unknown as Record<string, unknown>)[field]
    if (!Array.isArray(val)) {
      ;(stackInfo as unknown as Record<string, unknown>)[field] = []
      warnings.push({ field, message: `${field}이(가) 배열이 아닙니다. 빈 배열로 대체합니다.`, severity: 'medium' })
      continue
    }
    const filtered = val.filter((v): v is string => typeof v === 'string')
    if (filtered.length < val.length) {
      warnings.push({ field, message: `${field}에서 ${val.length - filtered.length}개의 비문자열 요소를 제거했습니다.`, severity: 'low' })
    }
    if (filtered.length > MAX_ARRAY_SIZE) {
      ;(stackInfo as unknown as Record<string, unknown>)[field] = filtered.slice(0, MAX_ARRAY_SIZE)
      warnings.push({ field, message: `${field} 배열이 ${MAX_ARRAY_SIZE}개를 초과하여 잘렸습니다.`, severity: 'medium' })
    } else {
      ;(stackInfo as unknown as Record<string, unknown>)[field] = filtered
    }
  }

  if (!Array.isArray(stackInfo.schema_sources)) {
    stackInfo = { ...stackInfo, schema_sources: [] }
    warnings.push({ field: 'schema_sources', message: 'schema_sources이(가) 배열이 아닙니다. 빈 배열로 대체합니다.', severity: 'medium' })
  } else if (stackInfo.schema_sources.length > MAX_SCHEMA_SOURCES) {
    stackInfo = { ...stackInfo, schema_sources: stackInfo.schema_sources.slice(0, MAX_SCHEMA_SOURCES) }
    warnings.push({ field: 'schema_sources', message: `schema_sources가 ${MAX_SCHEMA_SOURCES}개를 초과하여 잘렸습니다.`, severity: 'medium' })
  }
  for (const ss of stackInfo.schema_sources) {
    if (Array.isArray(ss.schema_paths) && ss.schema_paths.length > MAX_SCHEMA_PATHS) {
      ss.schema_paths = ss.schema_paths.slice(0, MAX_SCHEMA_PATHS)
      warnings.push({ field: 'schema_sources', message: `schema_paths가 ${MAX_SCHEMA_PATHS}개를 초과하여 잘렸습니다.`, severity: 'medium' })
    }
  }

  const resolvedRepo = fs.realpathSync(path.resolve(repoPath))
  const tasks: GlobTask[] = []

  const addTasks = (field: string, patterns: string[], maxDepth: number | undefined) => {
    for (const pattern of patterns) {
      if (DANGEROUS_PATTERN.test(pattern) || pattern.startsWith('/') || pattern.includes('\0')) {
        const sanitized = pattern.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, '')
        warnings.push({ field, message: `위험한 패턴 거부: ${sanitized}`, severity: 'medium' })
        continue
      }
      tasks.push({ field, pattern, maxDepth })
    }
  }

  for (const ss of stackInfo.schema_sources) {
    for (const pattern of ss.schema_paths) {
      if (DANGEROUS_PATTERN.test(pattern) || pattern.startsWith('/') || pattern.includes('\0')) {
        const sanitized = pattern.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, '')
        warnings.push({ field: 'schema_sources', message: `위험한 패턴 거부: ${sanitized}`, severity: 'medium' })
        continue
      }
      tasks.push({ field: 'schema_sources', pattern, maxDepth: 5 })
    }
  }

  addTasks('routing_files', stackInfo.routing_files, undefined)
  addTasks('entrypoint_files', stackInfo.entrypoint_files, undefined)

  const taskResults: Map<GlobTask, string[]> = new Map()
  let cumulativeFiles = 0
  for (const task of tasks) {
    const options: fg.Options = {
      cwd: resolvedRepo,
      followSymbolicLinks: false,
      dot: true,
      onlyFiles: true,
      absolute: false,
      ...(task.maxDepth !== undefined ? { deep: task.maxDepth } : {}),
    }
    const { files, timedOut } = await runGlobWithTimeout(task.pattern, options, DEFAULT_TIMEOUT_MS, signal)
    if (timedOut) {
      warnings.push({ field: task.field, message: '패턴 타임아웃 (10초 초과), 건너뜀', severity: 'medium' })
      taskResults.set(task, [])
      continue
    }
    if (files.length > PER_PATTERN_WARNING_THRESHOLD) {
      warnings.push({ field: task.field, message: `패턴 매칭 파일 수가 ${PER_PATTERN_WARNING_THRESHOLD}개를 초과했습니다 (${files.length}개)`, severity: 'medium' })
    }
    cumulativeFiles += files.length
    // ★ N1+M3: spec 정책 일치 — throw → truncate + warning (DoS 방어 유지하되 graceful)
    if (cumulativeFiles > MAX_CUMULATIVE_FILES) {
      const remaining = MAX_CUMULATIVE_FILES - (cumulativeFiles - files.length)
      const truncated = files.slice(0, Math.max(0, remaining))
      warnings.push({
        field: task.field,
        message: `누적 파일 수가 ${MAX_CUMULATIVE_FILES}개를 초과하여 잘렸습니다 (${cumulativeFiles}개)`,
        severity: 'medium',
      })
      taskResults.set(task, truncated)
      cumulativeFiles = MAX_CUMULATIVE_FILES
      // ★ N1: 이후 task에 빈 배열 명시 등록 (entry 누락 방지)
      continue
    }
    taskResults.set(task, files)
  }
  // ★ N1: truncate로 빠진 task에 빈 배열 명시 + truncate 발생 표시
  const hadTruncate = cumulativeFiles >= MAX_CUMULATIVE_FILES
  for (const task of tasks) {
    /* v8 ignore next -- every task either records a result or exits by throwing before this reconciliation pass. */
    if (!taskResults.has(task)) taskResults.set(task, [])
  }

  const verifiedResults: Map<GlobTask, string[]> = new Map()
  for (const [task, files] of taskResults) {
    const verified: string[] = []
    for (const rawPath of files) {
      const result = normalizeAndVerify(rawPath, resolvedRepo, task.field)
      if (result.warning) warnings.push(result.warning)
      if (result.verified !== null) verified.push(result.verified)
    }
    verifiedResults.set(task, verified)
  }

  const schemaFilesFound: string[] = []
  const schemaFilesMissing: string[] = []
  const routingFilesFound: string[] = []
  const entrypointFilesFound: string[] = []
  const schemaPatternMatches = new Map<string, boolean>()

  for (const [task, verified] of verifiedResults) {
    switch (task.field) {
      case 'schema_sources':
        schemaFilesFound.push(...verified)
        /* v8 ignore next -- verifiedResults is built directly from taskResults entries. */
        schemaPatternMatches.set(task.pattern, (taskResults.get(task) ?? []).length > 0)
        break
      case 'routing_files': routingFilesFound.push(...verified); break
      case 'entrypoint_files': entrypointFilesFound.push(...verified); break
    }
  }

  for (const ss of stackInfo.schema_sources) {
    for (const sp of ss.schema_paths) {
      if (schemaPatternMatches.get(sp) === false) {
        schemaFilesMissing.push(sp)
      }
    }
  }

  for (const missing of schemaFilesMissing) {
    warnings.push({ field: 'schema_sources', message: `스키마 파일을 찾을 수 없습니다: ${missing}`, severity: 'medium' })
  }
  // ★ N1: truncate 발생 시 missing 판정 skip (거짓 경고 방지)
  if (!hadTruncate && stackInfo.entrypoint_files.length > 0 && entrypointFilesFound.length === 0) {
    warnings.push({ field: 'entrypoint_files', message: 'entrypoint 파일을 찾을 수 없습니다', severity: 'medium' })
  }

  // ★ v2 V5: custom_decorators.file 누락 검증
  await validateCustomDecorators(stackInfo, resolvedRepo, warnings)


  return {
    schema_files_found: schemaFilesFound,
    schema_files_missing: schemaFilesMissing,
    routing_files_found: routingFilesFound,
    entrypoint_files_found: entrypointFilesFound,
    warnings,
  }
}

// ────────────────────────────────────────
// v2 추가 검증
// ────────────────────────────────────────

async function validateCustomDecorators(
  stackInfo: StackInfo,
  resolvedRepo: string,
  warnings: Warning[],
): Promise<void> {
  const cd = (stackInfo as unknown as { custom_decorators?: Record<string, { file?: string }> })
    .custom_decorators
  if (!cd || typeof cd !== 'object') return
  for (const [name, mapping] of Object.entries(cd)) {
    const file = mapping?.file
    if (typeof file !== 'string') continue
    if (DANGEROUS_PATTERN.test(file) || file.startsWith('/')) {
      warnings.push({
        field: 'custom_decorators',
        message: `위험한 wrapper 파일 경로: ${name}`,
        severity: 'medium',
      })
      continue
    }
    const fullPath = path.join(resolvedRepo, file)
    if (!fullPath.startsWith(resolvedRepo + path.sep)) {
      warnings.push({
        field: 'custom_decorators',
        message: `wrapper 파일이 repo 외부를 가리킴: ${name}`,
        severity: 'medium',
      })
      continue
    }
    if (!fs.existsSync(fullPath)) {
      warnings.push({
        field: 'custom_decorators',
        message: `wrapper 파일을 찾을 수 없음: ${name} (${file})`,
        severity: 'medium',
      })
    }
  }
}

