/**
 * F2: extractAst — tree-sitter 파일별 파싱 (기본 동시성 4, env로 조정)
 * SOT: specs/build_graph/specs/f2_extract_ast/spec.md
 * Architecture: specs/build_graph/architecture.md — F2
 *
 * 서브함수:
 *   - validateFilePath: 경로 검증 (6분기)
 *   - preprocessContent: Prisma/sql 제네릭 제거
 *   - sanitize: 에러 메시지 6규칙 정제
 *   - invokeAdapter: adapter 호출 + 에러 포획
 *   - buildFileNode: file 타입 CodeNodeRaw 생성
 *   - parseOneFile: 단일 파일 → nodes[] + edges[] + constructorParams + enumValues
 *   - runParseOneFileTasks: 병렬 파싱 (기본 동시성 4)
 *   - addNodeToList: 심볼 노드 dedup 유틸
 *   - injectProjectContext: repo_id/source/DI/enum 주입
 *   - mergeParseResults: 4-way dispatch + 크기 상한
 *   - extractAst: 공개 오케스트레이터
 *
 * 책임:
 *   - tree-sitter로 각 파일 AST 파싱 (병렬 오케스트레이션, 기본 동시성 4)
 *   - code_nodes 생성 (file/function/class/method/type/interface/variable/enum/namespace)
 *   - code_edges 생성 (imports, re_exports, calls, extends, implements, mixes, uses_type, decorates, contains)
 *   - constructorDIMap, enumValueMap 수집
 *   - 파싱 실패 파일 → parse_status='failed' file 노드 생성
 *   - Invalid path → file 노드 미생성, parse_errors에 '[redacted]' 기록
 *
 * AbortSignal은 오케스트레이터 책임 — F2는 signal 관련 없음
 */
import { basename } from 'node:path'
import type {
  SourceFile, ParserAdapter,
  CodeNodeRaw, CodeEdgeRaw, ConstructorParam,
  ExtractAstResult, RunStepFn,
} from './types.js'
import type { ParseError, EnumValueMap, ConstructorDIMap, FieldOriginsMap } from './types.js'
import { BuildGraphError } from './types.js'

export const DEFAULT_PARSE_CONCURRENCY = readPositiveIntEnv('PLATTY_BUILD_GRAPH_PARSE_CONCURRENCY', 4)

// ── pLimit 폴리필 (외부 의존성 없이 동시성 제한) ──

function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: Array<() => void> = []

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        active++
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active--
            if (queue.length > 0) {
              const next = queue.shift()!
              next()
            }
          })
      }
      if (active < concurrency) {
        task()
      } else {
        queue.push(task)
      }
    })
  }

  return run
}

// ── parseOneFile 반환 타입 (3-way discriminated union) ──

export interface ParseOneFileOk {
  ok: true
  fileNode: CodeNodeRaw              // parse_status='ok' file 노드
  nodes: CodeNodeRaw[]               // 심볼 노드 (file 제외)
  edges: CodeEdgeRaw[]               // repo_id 설정 완료
  constructorParams: { className: string; params: ConstructorParam[] }[]
  enumValues: Map<string, string>    // Map<'{repoId}:{filePath}:{EnumName}.{MemberName}', stringValue> — SOT: phase3/types.ts
  fieldOrigins?: FieldOriginsMap     // P15-Lite: receiver type tracking
  file: SourceFile
}

export type ParseOneFileFail =
  | { ok: 'invalid_path'; file: SourceFile }
  | { ok: false; file: SourceFile; error: string }   // error = "Syntax error at line X"

export type ParseOneFileResult = ParseOneFileOk | ParseOneFileFail

// ── InvokeAdapterResult ──

export type InvokeAdapterResult =
  | { ok: true; nodes: CodeNodeRaw[]; edges: CodeEdgeRaw[];
      constructorParams: { className: string; params: ConstructorParam[] }[];
      enumValues: Map<string, string>;
      fieldOrigins?: FieldOriginsMap }
  | { ok: false; error: string }

// ── MergeAccumulator ──

export interface MergeAccumulator {
  fileNodes: CodeNodeRaw[]
  symbolNodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  parseErrors: ParseError[]
  diMap: ConstructorDIMap
  enumMap: EnumValueMap
  fieldOrigins: FieldOriginsMap
}

// ── §4.1 validateFilePath ──

function isValidPath(p: string): boolean {
  if (p.includes('\0')) return false
  if (p.includes('|')) return false
  if (p.startsWith('/')) return false
  if (/^[a-zA-Z]:[\\\/]/.test(p)) return false
  if (/^\\\\/.test(p)) return false
  if (/(?:^|[\\\/])\.\.(?:[\\\/]|$)/.test(p)) return false
  return true
}

export function validateFilePath(path: string): 'ok' | 'invalid' {
  return isValidPath(path) ? 'ok' : 'invalid'
}

// ── §4.2 preprocessContent ──

export function preprocessContent(content: string): string {
  return content.replace(
    /(\$(?:queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)|(?<!\w)sql)<[^>]{0,2000}>`/g,
    '$1`',
  )
}

// ── §4.3.1 sanitize (내부 export, 6규칙) ──

export function sanitize(msg: string, maxLen: number): string {
  let s = msg
  s = s.replace(/(?:\/[^\s'"]+|\.{1,2}\/[^\s'"]+|[a-zA-Z]:[\\\/][^\s'"]+)/g, '[path]')  // ①②③ 경로 3종
  s = s.replace(/[^\x20-\x7E]/g, ' ')     // ④ 비-ASCII → 공백
  s = s.replace(/[\r\n]+/g, ' ')          // ⑤ 줄바꿈 → 공백
  return s.slice(0, maxLen)               // ⑥ 절단
}

// ── §4.3.2 extractGenericErrorMessage (3분기) ──

function extractGenericErrorMessage(safeErrMsg: string): string {
  if (/^Syntax error at line \d+$/.test(safeErrMsg)) return safeErrMsg
  const m = safeErrMsg.match(/line[:\s]+(\d+)/i)
  if (m) return `Syntax error at line ${m[1]}`
  return 'Syntax error at line 1'
}

// ── logParseError 유틸 (invokeAdapter 분기 Red 해소 — spec §4.3 /build 지침) ──

async function logParseError(
  file: SourceFile,
  errMsg: string,
  safeErrMsg: string,
  runStepFn: RunStepFn | undefined,
  repoId: string,
): Promise<void> {
  try {
    await runStepFn?.({
      phase: 'build_graph', step: 'F2:parseError', repoId,
      meta: { file: basename(file.path), error: safeErrMsg },
    })
  } catch { /* runStep 실패는 F2 중단 사유 아님 */ }
  // NODE_ENV 분기 (프로덕션 정보 유출 자동 차단) — R5-H3
  if (process.env.NODE_ENV === 'production') {
    console.error(`[F2] parseError: ${sanitize(file.path, 200)}:`, safeErrMsg)
  } else {
    console.error(`[F2] parseError: ${file.path}:`, errMsg)
  }
}

// ── §4.3 invokeAdapter ──

export async function invokeAdapter(
  preprocessed: string,
  file: SourceFile,
  repoId: string,
  adapter: ParserAdapter,
  runStepFn?: RunStepFn,
): Promise<InvokeAdapterResult> {
  try {
    const r = await Promise.resolve(
      adapter.parseFile(preprocessed, file.path, repoId)
    )
    return { ok: true, nodes: r.nodes, edges: r.edges,
             constructorParams: r.constructorParams, enumValues: r.enumValues,
             fieldOrigins: r.fieldOrigins }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const safeErrMsg = sanitize(errMsg, 500)
    await logParseError(file, errMsg, safeErrMsg, runStepFn, repoId)
    return { ok: false, error: extractGenericErrorMessage(safeErrMsg) }
  }
}

// ── §4.4 buildFileNode ──

function classifyTestType(path: string): 'unit' | 'integration' | 'e2e' | null {
  if (/\.e2e[.-]spec\.(ts|tsx|js|jsx|vue|svelte|astro)$/.test(path)) return 'e2e'
  if (/\.integration[.-]spec\.(ts|tsx|js|jsx|vue|svelte|astro)$/.test(path)) return 'integration'
  if (/\.(spec|test)\.(ts|tsx|js|jsx|vue|svelte|astro)$/.test(path)) return 'unit'
  return null
}

export function buildFileNode(file: SourceFile, repoId: string): CodeNodeRaw {
  return {
    id: `${repoId}:${file.path}`,
    repo_id: repoId,
    type: 'file',
    file_path: file.path,
    name: file.path,
    line_start: null,
    line_end: null,
    signature: null,
    exported: false,
    parse_status: 'ok',
    is_test: file.isTest,
    test_type: classifyTestType(file.path),
    is_async: false,
    jsdoc: null,
    leading_comment: null,
  }
}

// ── §4.5 parseOneFile (얇은 orchestrator) ──

export async function parseOneFile(
  file: SourceFile,
  repoId: string,
  adapter: ParserAdapter,
  runStepFn?: RunStepFn,
): Promise<ParseOneFileResult> {
  if (validateFilePath(file.path) === 'invalid') {
    return { ok: 'invalid_path', file }
  }
  const preprocessed = preprocessContent(file.content)
  const r = await invokeAdapter(preprocessed, file, repoId, adapter, runStepFn)
  if (!r.ok) {
    return { ok: false, file, error: r.error }
  }
  return {
    ok: true, file,
    fileNode: buildFileNode(file, repoId),
    nodes: r.nodes,
    edges: r.edges,
    constructorParams: r.constructorParams,
    enumValues: r.enumValues,
    fieldOrigins: r.fieldOrigins,
  }
}

// ── §4.6 runParseOneFileTasks (병렬 실행) ──

export async function runParseOneFileTasks(
  files: SourceFile[],
  repoId: string,
  adapter: ParserAdapter,
  runStepFn?: RunStepFn,
  __overrides?: { concurrency?: number },
): Promise<ParseOneFileResult[]> {
  const limit = pLimit(__overrides?.concurrency ?? DEFAULT_PARSE_CONCURRENCY)
  let completed = 0
  const total = files.length
  const interval = getProgressInterval(total)

  return Promise.all(
    files.map((f) => limit(async () => {
      const result = await parseOneFile(f, repoId, adapter, runStepFn)
      completed++
      if (completed === 1 || completed === total || completed % interval === 0) {
        await emitProgress(runStepFn, {
          repoId,
          completed,
          total,
          currentFile: f.path,
        })
      }
      return result
    }))
  )
}

function getProgressInterval(total: number): number {
  if (total <= 100) return 10
  if (total <= 1_000) return 50
  if (total <= 10_000) return 250
  return 1_000
}

async function emitProgress(
  runStepFn: RunStepFn | undefined,
  meta: { repoId: string; completed: number; total: number; currentFile: string },
): Promise<void> {
  try {
    await runStepFn?.({
      phase: 'build_graph',
      step: 'F2:progress',
      repoId: meta.repoId,
      meta: {
        completed: meta.completed,
        total: meta.total,
        currentFile: basename(meta.currentFile),
      },
    })
  } catch { /* progress logging must never fail AST parsing */ }
}

// ── §4.7b addNodeToList (심볼 노드 dedup 유틸) ──

export function addNodeToList(list: CodeNodeRaw[], node: CodeNodeRaw): void {
  const idx = list.findIndex((n) => n.id === node.id)
  if (idx === -1) { list.push(node); return }
  const existing = list[idx]
  if (!existing.id.endsWith(`:${existing.line_start}`)) {
    list[idx] = { ...existing, id: `${existing.id}:${existing.line_start}` }
    list.push({ ...node, id: `${node.id}:${node.line_start}` })
  } else {
    list.push({ ...node, id: `${node.id}:${node.line_start}` })
  }
}

// ── §4.7a injectProjectContext (edge/DI/enum 주입) ──

export function injectProjectContext(
  r: ParseOneFileOk,
  repoId: string,
  acc: MergeAccumulator,
): void {
  if (r.file.isTest) {                                                   // Case C
    for (const e of r.edges) {
      if (e.relation === 'imports' || e.relation === 'uses_type') {
        acc.edges.push({ ...e, repo_id: repoId, source: 'static' })
      }
    }
    return
  }
  // Case D (isTest=false)
  for (const n of r.nodes) {
    if (n.type === 'file') continue   // adapter 중복 file 노드 skip
    addNodeToList(acc.symbolNodes, n)
  }
  for (const e of r.edges) {
    acc.edges.push({ ...e, repo_id: repoId, source: 'static' })
  }
  for (const item of r.constructorParams) {
    acc.diMap.set(`${repoId}:${r.file.path}:${item.className}`, item.params)
  }
  for (const [key, value] of r.enumValues) {
    // key 형식: '{repoId}:{filePath}:{EnumName}.{MemberName}' (adapter SOT, phase3/types.ts)
    acc.enumMap.set(key, value)   // last-write-wins (다중 파일 동일 키 시)
  }
  // P15-Lite: field origin 통합 (key={repoId}:{filePath}:{ClassOrNs} — file path 포함이라 충돌 없음)
  if (r.fieldOrigins) {
    for (const [classKey, fields] of r.fieldOrigins) {
      acc.fieldOrigins.set(classKey, fields)
    }
  }
}

// ── §4.7 mergeParseResults (4-way dispatch) ──

export function mergeParseResults(
  results: ParseOneFileResult[],
  repoId: string,
): ExtractAstResult {
  const acc: MergeAccumulator = {
    fileNodes: [], symbolNodes: [], edges: [],
    parseErrors: [], diMap: new Map(), enumMap: new Map(),
    fieldOrigins: new Map(),
  }

  for (const r of results) {
    if (r.ok === 'invalid_path') {                                       // Case A
      acc.parseErrors.push({ file: '[redacted]', error: 'Invalid path' })
      continue
    }
    if (r.ok === false) {                                                // Case B
      // nodes.file_path는 원본 유지(내부 DB 채널). parse_errors만 마스킹 (§1 4채널 표)
      acc.fileNodes.push({ ...buildFileNode(r.file, repoId), parse_status: 'failed' })
      acc.parseErrors.push({ file: '[parse_error]', error: r.error })
      continue
    }
    acc.fileNodes.push(r.fileNode)                                       // Case C+D 공통
    injectProjectContext(r, repoId, acc)                              // §4.7a 위임
  }

  /* v8 ignore next 3 -- DoS budget guard; constructing 500k+ nodes in unit tests is intentionally avoided. */
  if (acc.fileNodes.length + acc.symbolNodes.length > 500_000) {
    throw new BuildGraphError('Too many code nodes (max: 500,000)', 'GRAPH_FAILED')
  }
  /* v8 ignore next 3 -- DoS budget guard; constructing 2M+ edges in unit tests is intentionally avoided. */
  if (acc.edges.length > 2_000_000) {
    throw new BuildGraphError('Too many code edges (max: 2,000,000)', 'GRAPH_FAILED')
  }

  return {
    nodes: [...acc.fileNodes, ...acc.symbolNodes],   // file 노드 먼저 (불변식 F2-12)
    edges: acc.edges,
    parse_errors: acc.parseErrors,
    constructorDIMap: acc.diMap,
    enumValueMap: acc.enumMap,
    fieldOriginsMap: acc.fieldOrigins,
  }
}

// ── §4.8 extractAst (공개 오케스트레이터) ──

export async function extractAst(
  files: SourceFile[],
  repoId: string,
  adapter: ParserAdapter,
  runStepFn?: RunStepFn,
  __overrides?: { concurrency?: number },
): Promise<ExtractAstResult> {
  if (files.length === 0) {
    return { nodes: [], edges: [], parse_errors: [],
             constructorDIMap: new Map(), enumValueMap: new Map(),
             fieldOriginsMap: new Map() }
  }
  const results = await runParseOneFileTasks(files, repoId, adapter, runStepFn, __overrides)
  return mergeParseResults(results, repoId)
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Re-export ParseError for downstream consumers
export type { ParseError }
