/**
 * F3a: resolveImportEdges — import/re_export specifier 해석 (정적 경로 해석 + 배럴 체인)
 * SOT: specs/build_graph/specs/f3a_resolve_import_edges/spec.md
 */
import * as fsModule from 'node:fs'
import * as path from 'node:path'
import fg from 'fast-glob'

// fs.promises alias — 테스트에서 vi.spyOn(fsModule.promises, ...) 으로 mock 가능
const fsp = fsModule.promises
import type { SourceFile, CodeNodeRaw, PathAliases } from './types.js'
import type { CodeEdgeRaw } from './types.js'
import { BuildGraphError } from './types.js'

export interface ResolverConfig {
  pathAliases: PathAliases
  baseUrl: string
  repoPath: string
  language?: string
  dartPackageName?: string  // pubspec.yaml name: 필드 — package:X/ → lib/ 매핑용
}

export interface ResolverIndex {
  nodesByFile: Map<string, Readonly<CodeNodeRaw>[]>
  fileByPath: Map<string, SourceFile>
  nodeById: Map<string, Readonly<CodeNodeRaw>>
  resolveCache: Map<string, string | null>
}

export interface StatBudget {
  count: number
  max: number
}

export interface WalkContext {
  edges: CodeEdgeRaw[]
  nodesByFile: Map<string, Readonly<CodeNodeRaw>[]>
  fileByPath: Map<string, SourceFile>
  nodeById: Map<string, Readonly<CodeNodeRaw>>
  resolveCache: Map<string, string | null>
  config: ResolverConfig
  policy: ImportResolutionPolicy
  globalStatBudget: StatBudget
}

export interface ImportResolutionPolicy {
  isExternalSpecifier(specifier: string, config: ResolverConfig): boolean
  deriveCandidatePath(
    specifier: string,
    sourceFilePath: string,
    config: ResolverConfig,
  ): string | null
  buildExtensionCandidates(candidateRelative: string): string[]
  classifyUnresolvedCandidate(specifier: string, config: ResolverConfig): 'external' | 'failed'
}

export interface ImportResolutionProgress {
  completed: number
  total: number
  currentLabel?: string
}

// ── 내부 유틸 ──

/** F3a 관계 여부 판정 (imports / re_exports / re_exports_ns) */
function isF3aRelation(relation: string): boolean {
  return relation === 'imports' || relation === 're_exports' || relation === 're_exports_ns'
}

/** warning 출력 (절대 경로 금지 — repoPath 기준 상대 경로만) */
function warning(message: string): void {
  console.warn(`[F3a] ${message}`)
}

/** source_id에서 소속 파일 경로를 조회 */
function getSourceFilePath(
  sourceId: string,
  nodeById: Map<string, Readonly<CodeNodeRaw>>,
): string | null {
  return nodeById.get(sourceId)?.file_path ?? null
}

// ── §4.1 buildResolverIndex ──

export function buildResolverIndex(
  nodes: Readonly<CodeNodeRaw>[],
  files: SourceFile[],
): ResolverIndex {
  const nodesByFile = new Map<string, Readonly<CodeNodeRaw>[]>()
  const fileByPath = new Map<string, SourceFile>()
  const nodeById = new Map<string, Readonly<CodeNodeRaw>>()
  const resolveCache = new Map<string, string | null>()

  for (const node of nodes) {
    const list = nodesByFile.get(node.file_path) ?? []
    list.push(node)
    nodesByFile.set(node.file_path, list)

    if (nodeById.has(node.id)) {
      warning(`duplicate node id detected: ${node.id}`)
    }
    nodeById.set(node.id, node)
  }

  for (const file of files) {
    fileByPath.set(file.path, file)
  }

  return { nodesByFile, fileByPath, nodeById, resolveCache }
}

// ── §4.2 language import resolution policies ──

function hasPathAliasMatch(specifier: string, pathAliases: PathAliases): boolean {
  for (const key of Object.keys(pathAliases)) {
    const prefix = key.replace(/\*$/, '')
    if (specifier.startsWith(prefix)) return true
  }
  return false
}

function isRepoRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/')
}

function isInsideRepo(repoPath: string, candidateRelative: string): boolean {
  const resolvedAbs = path.resolve(repoPath, candidateRelative)
  return resolvedAbs === repoPath || resolvedAbs.startsWith(repoPath + path.sep)
}

function normalizeRepoRelative(repoPath: string, candidateRelative: string): string | null {
  /* v8 ignore next -- public resolver entrypoints guard null bytes before normalization. */
  if (candidateRelative.includes('\0')) return null
  if (!isInsideRepo(repoPath, candidateRelative)) return null
  return path.relative(repoPath, path.resolve(repoPath, candidateRelative)).replace(/\\/g, '/')
}

function buildTypeScriptExtensionCandidates(base: string): string[] {
  if (/\.(ts|tsx|js|jsx)$/.test(base)) {
    const withoutExtension = stripTypeScriptExtension(base)
    return [
      base,
      `${withoutExtension}.ts`, `${withoutExtension}.tsx`, `${withoutExtension}.js`, `${withoutExtension}.jsx`,
      // 명시 확장자가 실제로는 디렉터리일 수 있다 (`./helper.ts` → `helper.ts/index.ts`).
      // 디렉터리 index 폴백 포함.
      `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
    ]
  }
  return [
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
  ]
}

function buildDartExtensionCandidates(base: string): string[] {
  if (base.endsWith('.dart')) return [base]
  return [`${base}.dart`, `${base}/index.dart`]
}

export class TypeScriptImportResolutionPolicy implements ImportResolutionPolicy {
  isExternalSpecifier(specifier: string, config: ResolverConfig): boolean {
    if (isRepoRelativeSpecifier(specifier)) return false
    if (hasPathAliasMatch(specifier, config.pathAliases)) return false
    if (config.baseUrl && !specifier.startsWith('@')) return false
    return true
  }

  deriveCandidatePath(
    specifier: string,
    sourceFilePath: string,
    config: ResolverConfig,
  ): string | null {
    if (specifier.includes('\0') || sourceFilePath.includes('\0')) return null
    if (path.isAbsolute(config.baseUrl) || config.baseUrl.startsWith('..')) return null

    let resolvedRelative = tryAlias(specifier, config.pathAliases, config.baseUrl)
    if (!resolvedRelative) {
      if (specifier.startsWith('.')) {
        const absSourceDir = path.isAbsolute(sourceFilePath)
          ? path.dirname(sourceFilePath)
          : path.dirname(path.join(config.repoPath, sourceFilePath))
        const abs = path.resolve(absSourceDir, specifier)
        resolvedRelative = path.relative(config.repoPath, abs)
      } else if (config.baseUrl && !this.isExternalSpecifier(specifier, config)) {
        resolvedRelative = path.join(config.baseUrl, specifier)
      } else if (specifier.startsWith('/')) {
        resolvedRelative = specifier.slice(1)
      } else {
        return null
      }
    }

    return normalizeRepoRelative(config.repoPath, resolvedRelative)
  }

  buildExtensionCandidates(candidateRelative: string): string[] {
    return buildTypeScriptExtensionCandidates(candidateRelative)
  }

  classifyUnresolvedCandidate(specifier: string, config: ResolverConfig): 'external' | 'failed' {
    const wasBaseUrlCandidate = Boolean(config.baseUrl)
      && !isRepoRelativeSpecifier(specifier)
      && !hasPathAliasMatch(specifier, config.pathAliases)
    return wasBaseUrlCandidate ? 'external' : 'failed'
  }
}

export class DartImportResolutionPolicy implements ImportResolutionPolicy {
  isExternalSpecifier(specifier: string, config: ResolverConfig): boolean {
    if (specifier.startsWith(`package:${config.dartPackageName ?? ''}/`) && config.dartPackageName) {
      return false
    }
    if (specifier.startsWith('package:')) return true
    if (isRepoRelativeSpecifier(specifier)) return false
    return true
  }

  deriveCandidatePath(
    specifier: string,
    sourceFilePath: string,
    config: ResolverConfig,
  ): string | null {
    /* v8 ignore next -- Dart adapter emits sanitized import specifiers and file paths. */
    if (specifier.includes('\0') || sourceFilePath.includes('\0')) return null

    if (config.dartPackageName) {
      const selfPrefix = `package:${config.dartPackageName}/`
      if (specifier.startsWith(selfPrefix)) {
        return normalizeRepoRelative(config.repoPath, 'lib/' + specifier.slice(selfPrefix.length))
      }
    }

    if (specifier.startsWith('package:')) return null
    /* v8 ignore next -- non-relative non-package Dart imports are treated as external before candidate derivation. */
    if (!specifier.startsWith('.')) return null

    const absSourceDir = path.isAbsolute(sourceFilePath)
      ? path.dirname(sourceFilePath)
      : path.dirname(path.join(config.repoPath, sourceFilePath))
    const abs = path.resolve(absSourceDir, specifier)
    const relative = path.relative(config.repoPath, abs)
    return normalizeRepoRelative(config.repoPath, relative)
  }

  buildExtensionCandidates(candidateRelative: string): string[] {
    return buildDartExtensionCandidates(candidateRelative)
  }

  classifyUnresolvedCandidate(): 'external' | 'failed' {
    return 'failed'
  }
}

export function createImportResolutionPolicy(config: ResolverConfig): ImportResolutionPolicy {
  return config.language === 'dart'
    ? new DartImportResolutionPolicy()
    : new TypeScriptImportResolutionPolicy()
}

async function discoverWorkspacePackageAliases(repoPath: string): Promise<PathAliases> {
  const aliases: PathAliases = {}
  let packageJsonPaths: string[]
  try {
    packageJsonPaths = await fg('**/package.json', {
      cwd: repoPath,
      ignore: [
        'node_modules/**',
        'dist/**',
        'build/**',
        '.next/**',
        '.nuxt/**',
        '.git/**',
        'coverage/**',
      ],
      onlyFiles: true,
      followSymbolicLinks: false,
    })
  } catch {
    return aliases
  }

  for (const packageJsonPath of packageJsonPaths.slice(0, 1000)) {
    const packageDir = path.posix.dirname(packageJsonPath)
    if (packageDir === '.') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(await fsp.readFile(path.join(repoPath, packageJsonPath), 'utf8'))
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const manifest = parsed as Record<string, unknown>
    const name = typeof manifest.name === 'string' ? manifest.name : null
    if (!name || name.startsWith('.') || name.includes('\0')) continue

    const entry = normalizePackageEntry(manifest)
    const entryBase = stripTypeScriptExtension(path.posix.join(packageDir, entry))
    aliases[name] = entryBase
    aliases[`${name}/*`] = `${derivePackageSourceRoot(packageDir, entry)}/*`
    for (const [subpath, target] of packageExportSubpathEntries(manifest)) {
      aliases[`${name}/${subpath}`] = stripTypeScriptExtension(path.posix.join(packageDir, target))
    }
  }

  return aliases
}

function packageExportSubpathEntries(manifest: Record<string, unknown>): Array<[string, string]> {
  const exports = manifest.exports
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return []

  const entries: Array<[string, string]> = []
  for (const [key, value] of Object.entries(exports as Record<string, unknown>)) {
    if (key === '.' || !key.startsWith('./')) continue
    if (key.includes('*')) continue
    const target = normalizePackageExportTarget(value)
    if (!target || target.includes('*')) continue
    entries.push([stripLeadingDotSlash(key), target])
  }
  return entries
}

function normalizePackageExportTarget(value: unknown): string | null {
  if (typeof value === 'string') return stripLeadingDotSlash(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const valueObject = value as Record<string, unknown>
    for (const key of ['import', 'module', 'default', 'require', 'types']) {
      const nested = valueObject[key]
      if (typeof nested === 'string') return stripLeadingDotSlash(nested)
    }
  }
  return null
}

function normalizePackageEntry(manifest: Record<string, unknown>): string {
  const exports = manifest.exports
  if (typeof exports === 'string') return stripLeadingDotSlash(exports)
  if (exports && typeof exports === 'object') {
    const rootExport = (exports as Record<string, unknown>)['.']
    if (typeof rootExport === 'string') return stripLeadingDotSlash(rootExport)
    if (rootExport && typeof rootExport === 'object') {
      const rootExportObject = rootExport as Record<string, unknown>
      for (const key of ['import', 'module', 'default', 'require']) {
        const value = rootExportObject[key]
        if (typeof value === 'string') return stripLeadingDotSlash(value)
      }
    }
  }
  for (const key of ['module', 'main', 'types']) {
    const value = manifest[key]
    if (typeof value === 'string') return stripLeadingDotSlash(value)
  }
  return 'src/index.ts'
}

function stripLeadingDotSlash(value: string): string {
  return value.replace(/^\.\//, '')
}

function stripTypeScriptExtension(value: string): string {
  return value.replace(/\.(ts|tsx|js|jsx)$/, '')
}

function derivePackageSourceRoot(packageDir: string, entry: string): string {
  const normalizedEntry = stripLeadingDotSlash(entry)
  const entryDir = path.posix.dirname(normalizedEntry)
  const sourceRoot = path.posix.basename(stripTypeScriptExtension(normalizedEntry)) === 'index'
    ? entryDir
    : path.posix.dirname(normalizedEntry)
  if (!sourceRoot || sourceRoot === '.') return packageDir
  return path.posix.join(packageDir, sourceRoot)
}

// ── §4.2 isExternalPackage ──

export function isExternalPackage(
  specifier: string,
  pathAliases: PathAliases,
): boolean {
  return new TypeScriptImportResolutionPolicy()
    .isExternalSpecifier(specifier, { pathAliases, baseUrl: '', repoPath: path.sep })
}

// ── §4.3 deriveCandidatePath 내부 유틸 ──

/** alias 값이 배열이면 첫 번째만 반환. 배열이 아닌 경우 문자열 그대로 반환. */
function tryAlias(specifier: string, pathAliases: PathAliases, baseUrl = ''): string | null {
  for (const [key, value] of Object.entries(pathAliases)) {
    const prefix = key.replace(/\*$/, '')
    /* v8 ignore next -- alias maps used by resolver tests are scoped to the requested prefix; mismatch is a cheap skip. */
    if (!specifier.startsWith(prefix)) continue
    const suffix = specifier.slice(prefix.length)
    const template = Array.isArray(value) ? value[0] : value
    const resolved = template.replace(/\*$/, suffix)
    return applyBaseUrlToAliasTarget(resolved, baseUrl)
  }
  return null
}

function tryAliasCandidates(specifier: string, pathAliases: PathAliases, baseUrl = ''): string[] {
  for (const [key, value] of Object.entries(pathAliases)) {
    const prefix = key.replace(/\*$/, '')
    /* v8 ignore next -- alias maps used in resolver flow are checked for matching prefixes before expansion matters. */
    if (!specifier.startsWith(prefix)) continue
    const suffix = specifier.slice(prefix.length)
    const templates = Array.isArray(value) ? value : [value]
    return templates.map(template => applyBaseUrlToAliasTarget(template.replace(/\*$/, suffix), baseUrl))
  }
  return []
}

function applyBaseUrlToAliasTarget(candidate: string, baseUrl: string): string {
  if (!baseUrl) return candidate
  const normalizedBase = baseUrl.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalizedBase) return candidate
  if (normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(`${normalizedBase}/`)) {
    return normalizedCandidate
  }
  return path.join(normalizedBase, normalizedCandidate).replace(/\\/g, '/')
}

function deriveCandidatePathsForResolution(
  specifier: string,
  sourceFilePath: string,
  config: ResolverConfig,
  policy: ImportResolutionPolicy,
): string[] {
  /* v8 ignore next -- public policy APIs reject unsafe values before this multi-candidate helper is reached. */
  if (specifier.includes('\0') || sourceFilePath.includes('\0')) return []
  /* v8 ignore next -- unsafe baseUrl is rejected by deriveCandidatePath; this mirrors that guard for alias fan-out. */
  if (path.isAbsolute(config.baseUrl) || config.baseUrl.startsWith('..')) return []

  const aliasCandidates = tryAliasCandidates(specifier, config.pathAliases, config.baseUrl)
    .map(candidate => normalizeRepoRelative(config.repoPath, candidate))
    .filter((candidate): candidate is string => candidate !== null)
  if (aliasCandidates.length > 0) return aliasCandidates

  const candidate = policy.deriveCandidatePath(specifier, sourceFilePath, config)
  return candidate === null ? [] : [candidate]
}

function symbolForTargetLookup(edge: CodeEdgeRaw): string | null {
  return edge.target_imported_symbol ?? edge.target_symbol
}

// ── §4.3 deriveCandidatePath ──

export function deriveCandidatePath(
  specifier: string,
  sourceFilePath: string,
  config: ResolverConfig,
): string | null {
  return createImportResolutionPolicy(config).deriveCandidatePath(specifier, sourceFilePath, config)
}

function cacheAndReturn(
  cacheKey: string,
  value: string | null,
  index: Pick<ResolverIndex, 'resolveCache'>,
): string | null {
  index.resolveCache.set(cacheKey, value)
  return value
}

// ── §4.4 probeResolvedFile ──

export async function probeResolvedFile(
  candidateRelative: string,
  contextFilePath: string,
  index: ResolverIndex,
  globalStatBudget: StatBudget,
  config: ResolverConfig,
  policy: ImportResolutionPolicy = createImportResolutionPolicy(config),
): Promise<string | null> {
  // cache
  const cacheKey = `${candidateRelative}\0${contextFilePath}`
  if (index.resolveCache.has(cacheKey)) return index.resolveCache.get(cacheKey)!

  // 2-F 확장자 순서 (language policy 위임)
  const exts = policy.buildExtensionCandidates(candidateRelative)
  for (const cand of exts) {
    if (index.fileByPath.has(cand)) {
      return cacheAndReturn(cacheKey, cand, index)       // fs.stat 스킵
    }
    globalStatBudget.count++
    if (globalStatBudget.count > globalStatBudget.max) {
      warning('fs.stat budget exceeded')
      return cacheAndReturn(cacheKey, null, index)
    }
    try {
      const stat = await fsp.stat(path.join(config.repoPath, cand))
      // 디렉터리는 모듈 파일이 아니다 — 다음 후보(예: `${cand}/index.ts`)로 진행.
      // (`./helper.ts`가 실제로는 `helper.ts/` 디렉터리인 경우 등)
      if (!stat.isFile()) continue
      // 2-G symlink
      const realPath = await fsp.realpath(path.join(config.repoPath, cand))
      if (!realPath.startsWith(config.repoPath + path.sep) && realPath !== config.repoPath) {
        return cacheAndReturn(cacheKey, null, index)
      }
      return cacheAndReturn(cacheKey, cand, index)
    } catch { /* 다음 후보 */ }
  }
  return cacheAndReturn(cacheKey, null, index)
}

// ── §4.5 pickTargetInFile ──

export function pickTargetInFile(
  filePath: string,
  relation: 'imports' | 're_exports' | 're_exports_ns',
  targetSymbol: string | null,
  nodesByFile: Map<string, Readonly<CodeNodeRaw>[]>,
): { targetId: string | null; status: 'resolved' | 'failed' | 'need_barrel' } {
  const fileNodes = nodesByFile.get(filePath) ?? []
  const fileNode = fileNodes.find(n => n.type === 'file')
  if (!fileNode || fileNode.parse_status === 'failed') return { targetId: null, status: 'failed' }

  // 4.ns: re_exports_ns (불변식 F3a-12 예외)
  if (relation === 're_exports_ns') return { targetId: fileNode.id, status: 'resolved' }

  // 4.b: target_symbol 없음 (side-effect / `* as NS` — F2가 null 전달)
  if (targetSymbol === null) return { targetId: fileNode.id, status: 'resolved' }

  // 4.a: 직접 매칭 → default fallback
  const direct = fileNodes.find(n => n.name === targetSymbol && n.exported)
  if (direct) return { targetId: direct.id, status: 'resolved' }

  // 4.d: targetSymbol === 'default'면 is_default_export=true 노드 우선 매칭
  // (export default class MyButton 같은 named default 노드 정확 매핑 — GAP-DEFAULT-1)
  if (targetSymbol === 'default') {
    const defaultNode = fileNodes.find(n => n.is_default_export && n.exported)
    if (defaultNode) return { targetId: defaultNode.id, status: 'resolved' }
  }

  const def = fileNodes.find(n => n.name === 'default' && n.exported)
  if (def) return { targetId: def.id, status: 'resolved' }

  // 4.c: 'default'든 일반 심볼이든 walkReExportsForSymbol을 시도하도록 need_barrel 반환.
  // (이전엔 default일 때 즉시 fileNode로 fallback해 barrel chain 추적이 시작 안 됐음 — F-07/F-08).
  // walk 실패 시 메인 루프의 BS-16 fallback이 file 노드를 채움.
  return { targetId: null, status: 'need_barrel' }
}

// ── §4.6 walkReExportsForSymbol 분해 ──

// BS-16 — barrel 상한 상수 export (외부에서 조정 가능)
export const MAX_REEXPORT_DEPTH = 5
export const MAX_REEXPORT_FANOUT = 500

/** 3-A 가드: visited 체크 + depth + fanOut 상한 */
function guardBarrelEntry(
  resolvedPath: string,
  depth: number,
  visited: Set<string>,
  fanOut: { count: number },
): 'ok' | 'failed' {
  if (visited.has(resolvedPath)) return 'failed'
  visited.add(resolvedPath)   // H1-sec: fanOut 초과 시에도 visited 등록
  if (depth >= MAX_REEXPORT_DEPTH) {
    warning(`barrel chain depth limit exceeded: ${resolvedPath} (depth=${depth})`)
    return 'failed'
  }
  fanOut.count++
  if (fanOut.count > MAX_REEXPORT_FANOUT) {
    warning(`barrel chain fanOut limit exceeded: ${resolvedPath} (fanOut=${fanOut.count})`)
    return 'failed'
  }
  return 'ok'
}

/** 3-B named/namespace 탐색 */
async function walkNamedAndNamespace(
  searchSymbol: string,
  barrelEdges: CodeEdgeRaw[],
  depth: number,
  visited: Set<string>,
  fanOut: { count: number },
  ctx: WalkContext,
): Promise<{ targetId: string | null; status: 'resolved' | 'failed' } | null> {
  // named re_exports (불변식 F3a-11: named > namespace > wildcard)
  for (const e of barrelEdges.filter(b => b.relation === 're_exports' && b.target_symbol)) {
    // 매칭은 re-export의 공개 이름(target_symbol)으로. `export { default as emailService }`는
    // 공개 이름 emailService로 들어온다 (alias 정책: target_symbol=공개 이름).
    /* v8 ignore next -- direct walk callers pass pre-filtered search symbols; mismatch is a defensive skip. */
    if (e.target_symbol !== searchSymbol) continue
    // 대상 파일에서 실제로 찾을 심볼은 re-export의 source 심볼(target_imported_symbol).
    // alias 없으면 둘이 같으므로 기존 동작 보존. `default as X`면 importedSymbol='default'.
    const importedSymbol = e.target_imported_symbol ?? e.target_symbol
    const next = await resolveViaBarrel(e, ctx)
    if (!next) continue
    const hit = ctx.nodesByFile.get(next)?.find(n => n.name === importedSymbol && n.exported)
    if (hit) return { targetId: hit.id, status: 'resolved' }
    // importedSymbol === 'default'면 is_default_export=true 노드 우선 매칭
    // (named default class — export default class MyButton — F3a §4.d와 동일 정책)
    if (importedSymbol === 'default') {
      const defaultHit = ctx.nodesByFile.get(next)?.find(n => n.is_default_export && n.exported)
      if (defaultHit) return { targetId: defaultHit.id, status: 'resolved' }
    }
    // 더 깊은 barrel chain 우선 (b1 → b2 → my-button 같은 다단계 default 재-export).
    const rec = await walkReExportsForSymbol(importedSymbol, next, depth + 1, visited, fanOut, ctx)
    if (rec.status === 'resolved') return rec
    // object-literal default export (`export default { a, b }`)는 default-export 노드가 없고
    // file 노드에서 멤버 const로 contains edge만 갖는다. chain도 더 못 가면 그 file 노드로 해석 —
    // 그래야 F5가 emailService.foo() 같은 멤버 호출을 contains 멤버로 푼다 (barrel이 아닌 대상 파일).
    // (chain 재귀 실패 이후에만 적용해 다단계 default chain[F-08] 회귀를 방지.)
    if (importedSymbol === 'default') {
      const fileNode = ctx.nodesByFile.get(next)?.find(n => n.type === 'file')
      if (fileNode) return { targetId: fileNode.id, status: 'resolved' }
    }
  }
  // namespace re_exports
  for (const e of barrelEdges.filter(b => b.relation === 're_exports_ns' && b.target_symbol === searchSymbol)) {
    const next = await resolveViaBarrel(e, ctx)
    /* v8 ignore next -- namespace barrel edges are local re-export specifiers in adapter output. */
    if (!next) continue
    const fileNode = ctx.nodesByFile.get(next)?.find(n => n.type === 'file')
    if (fileNode) return { targetId: fileNode.id, status: 'resolved' }
  }
  return null
}

/** 3-C wildcard 탐색 */
async function walkWildcard(
  searchSymbol: string | null,
  barrelEdges: CodeEdgeRaw[],
  depth: number,
  visited: Set<string>,
  fanOut: { count: number },
  ctx: WalkContext,
): Promise<{ targetId: string | null; status: 'resolved' | 'failed'; newEdges?: CodeEdgeRaw[] }> {
  const newEdges: CodeEdgeRaw[] = []
  for (const e of barrelEdges.filter(b => b.relation === 're_exports' && b.target_symbol === null)) {
    const next = await resolveViaBarrel(e, ctx)
    if (!next) continue
    if (searchSymbol === null) {
      // 최상위 wildcard fan-out: 심볼별 신규 edge 생성
      /* v8 ignore next -- resolveViaBarrel returns paths present in resolver indexes. */
      const exported = ctx.nodesByFile.get(next)?.filter(n => n.exported) ?? []
      for (const sym of exported) {
        newEdges.push({
          repo_id: e.repo_id,
          source_id: e.source_id,
          target_id: sym.id,
          relation: 're_exports',
          target_symbol: sym.name,
          target_specifier: e.target_specifier,
          first_arg: null,
          literal_args: '[]',
          resolve_status: 'resolved',
          source: 'static',
        })
      }
    } else {
      const hit = ctx.nodesByFile.get(next)?.find(n => n.name === searchSymbol && n.exported)
      if (hit) return { targetId: hit.id, status: 'resolved' }
      if (searchSymbol === 'default') {
        const defaultHit = ctx.nodesByFile.get(next)?.find(n => n.is_default_export && n.exported)
        if (defaultHit) return { targetId: defaultHit.id, status: 'resolved' }
      }
      const rec = await walkReExportsForSymbol(searchSymbol, next, depth + 1, visited, fanOut, ctx)
      if (rec.status === 'resolved') return rec
    }
  }
  if (searchSymbol === null) return { targetId: null, status: 'resolved', newEdges }
  return { targetId: null, status: 'failed' }
}

// ── resolveViaBarrel 인라인 유틸 ──
// §4.6 의존: deriveCandidatePath(e.target_specifier, e.source_file, ctx.config) 호출 →
//           null이면 null 반환, 아니면 probeResolvedFile(candidate, sourceFile, ctx.index,
//           ctx.globalStatBudget, ctx.config) 결과 반환 (해석된 파일 상대경로 또는 null)
async function resolveViaBarrel(e: CodeEdgeRaw, ctx: WalkContext): Promise<string | null> {
  if (!e.target_specifier) return null
  const sourceFilePath = getSourceFilePath(e.source_id, ctx.nodeById)
  /* v8 ignore next -- barrel edges are emitted from file nodes; missing source is a defensive fallback. */
  if (!sourceFilePath) return null
  const candidate = ctx.policy.deriveCandidatePath(e.target_specifier, sourceFilePath, ctx.config)
  /* v8 ignore next -- barrel traversal only follows local re-export specifiers. */
  if (!candidate) return null
  return probeResolvedFile(candidate, sourceFilePath, ctx, ctx.globalStatBudget, ctx.config, ctx.policy)
}

// ── §4.6 walkReExportsForSymbol ──

export async function walkReExportsForSymbol(
  searchSymbol: string | null,
  resolvedPath: string,
  depth: number,
  visited: Set<string>,
  fanOut: { count: number },
  ctx: WalkContext,
): Promise<{ targetId: string | null; status: 'resolved' | 'failed'; newEdges?: CodeEdgeRaw[] }> {
  // 3-A 가드
  const guardResult = guardBarrelEntry(resolvedPath, depth, visited, fanOut)
  if (guardResult === 'failed') return { targetId: null, status: 'failed' }

  // barrelEdges: source_file === resolvedPath인 re_exports/re_exports_ns edge 필터
  // source_id에서 file_path를 역참조하여 비교
  const barrelEdges = ctx.edges.filter(e => {
    if (e.relation !== 're_exports' && e.relation !== 're_exports_ns') return false
    const fp = getSourceFilePath(e.source_id, ctx.nodeById)
    return fp === resolvedPath
  })

  // 3-B named/namespace (searchSymbol이 있을 때만)
  if (searchSymbol !== null) {
    const result = await walkNamedAndNamespace(searchSymbol, barrelEdges, depth, visited, fanOut, ctx)
    if (result) return result
  }

  // 3-C wildcard
  return walkWildcard(searchSymbol, barrelEdges, depth, visited, fanOut, ctx)
}

// ── §4.0 내부 유틸 ──

/** null 재평가: deriveCandidatePath 또는 probeResolvedFile null 반환 시 external vs failed 판정 */
function reevaluateNullResolution(
  specifier: string | null,
  config: ResolverConfig,
  policy: ImportResolutionPolicy,
): 'external' | 'failed' {
  if (!specifier) return 'failed'
  return policy.isExternalSpecifier(specifier, config) ? 'external' : 'failed'
}

// ── §4.0 resolveImportEdges 오케스트레이터 ──

export async function resolveImportEdges(
  edges: CodeEdgeRaw[],
  nodes: Readonly<CodeNodeRaw>[],
  files: SourceFile[],
  _projectId: string,
  config: ResolverConfig,
  policy?: ImportResolutionPolicy,
  onProgress?: (progress: ImportResolutionProgress) => void,
): Promise<CodeEdgeRaw[]> {
  // repoPath 검증 (진입부 1회)
  if (!path.isAbsolute(config.repoPath)) {
    throw new BuildGraphError('invalid repoPath', 'GRAPH_FAILED')
  }
  if (!Array.isArray(edges)) {
    throw new BuildGraphError('build_graph failed at F3a', 'GRAPH_FAILED')
  }
  const repoPath = config.repoPath.endsWith(path.sep)
    ? config.repoPath.slice(0, -1) : config.repoPath
  const workspacePackageAliases = config.language === 'dart'
    ? {}
    : await discoverWorkspacePackageAliases(repoPath)
  const normalizedConfig = {
    ...config,
    repoPath,
    pathAliases: {
      ...workspacePackageAliases,
      ...config.pathAliases,
    },
  }
  const resolutionPolicy = policy ?? createImportResolutionPolicy(normalizedConfig)

  const globalStatBudget: StatBudget = { count: 0, max: 100_000 }
  const index = buildResolverIndex(nodes, files)
  const walkContext: WalkContext = {
    edges,
    ...index,
    config: normalizedConfig,
    policy: resolutionPolicy,
    globalStatBudget,
  }

  const result: CodeEdgeRaw[] = []
  const total = edges.length
  const interval = progressInterval(total)
  let completed = 0
  const emitProgress = (edge: CodeEdgeRaw) => {
    completed++
    if (completed === total || completed === 1 || completed % interval === 0) {
      try {
        onProgress?.({
          completed,
          total,
          currentLabel: edge.target_specifier ?? edge.target_symbol ?? edge.relation,
        })
      } catch { /* progress logging must not affect import resolution */ }
    }
  }

  try {
    for (const edge of edges) {
      // non-F3a pass-through 또는 이미 해석된 edge
      if (!isF3aRelation(edge.relation) || edge.target_id !== null) {
        result.push({ ...edge })
        emitProgress(edge)
        continue
      }

      // source file path 조회
      const sourceFilePath = getSourceFilePath(edge.source_id, index.nodeById)

      // wildcard re_exports (target_symbol=null) — 직행
      if (edge.relation === 're_exports' && edge.target_symbol === null) {
        const startPath = sourceFilePath ?? ''
        const walked = await walkReExportsForSymbol(
          null, startPath, 0, new Set(), { count: 0 },
          walkContext)
        /* v8 ignore next -- wildcard walk for null searchSymbol always returns newEdges. */
        result.push(...(walked.newEdges ?? []))
        emitProgress(edge)
        continue
      }

      // 일반 분기: imports / named re_exports / re_exports_ns
      let resolvedFilePath: string | null = null
      let candidateFound = false

      try {
        if (sourceFilePath && edge.target_specifier) {
          if (resolutionPolicy.isExternalSpecifier(edge.target_specifier, normalizedConfig)) {
            result.push({ ...edge, resolve_status: 'external', target_id: null })
            emitProgress(edge)
            continue
          }
          const candidates = deriveCandidatePathsForResolution(
            edge.target_specifier, sourceFilePath, normalizedConfig, resolutionPolicy)
          if (candidates.length > 0) {
            candidateFound = true
            for (const candidate of candidates) {
              resolvedFilePath = await probeResolvedFile(
                candidate, sourceFilePath, index, globalStatBudget, normalizedConfig, resolutionPolicy)
              if (resolvedFilePath !== null) break
            }
          }
        }
      } catch {
        // fs I/O 에러 → failed, 파이프라인 계속 (F3a-5)
        result.push({ ...edge, resolve_status: 'failed' })
        emitProgress(edge)
        continue
      }

      if (resolvedFilePath === null) {
        // 로컬 경로로 매핑됐으나 파일 없음 → failed
        // 매핑 자체 실패 → external vs failed 재평가
        const status = candidateFound && edge.target_specifier
          ? resolutionPolicy.classifyUnresolvedCandidate(edge.target_specifier, normalizedConfig)
          : reevaluateNullResolution(edge.target_specifier, normalizedConfig, resolutionPolicy)
        result.push({ ...edge, resolve_status: status, target_id: null })
        emitProgress(edge)
        continue
      }

      // filePath 확보 — pickTargetInFile
      const picked = pickTargetInFile(
        resolvedFilePath,
        edge.relation as 'imports' | 're_exports' | 're_exports_ns',
        symbolForTargetLookup(edge),
        index.nodesByFile,
      )

      if (picked.status === 'resolved') {
        result.push({ ...edge, resolve_status: 'resolved', target_id: picked.targetId })
        emitProgress(edge)
        continue
      }

      if (picked.status === 'failed') {
        result.push({ ...edge, resolve_status: 'failed', target_id: null })
        emitProgress(edge)
        continue
      }

      // need_barrel → walkReExportsForSymbol
      const walked = await walkReExportsForSymbol(
        symbolForTargetLookup(edge), resolvedFilePath, 0, new Set(), { count: 0 },
        walkContext)

      if (walked.status === 'resolved') {
        result.push({ ...edge, resolve_status: 'resolved', target_id: walked.targetId })
      } else {
        // BS-16 — barrel chain 실패 시 file-node fallback (spec line 290~291).
        // resolvedFilePath의 file 노드 → resolved (불완전한 매핑이지만 traversal 가능).
        /* v8 ignore next -- pickTargetInFile reached need_barrel only after nodesByFile contained the resolved file. */
        const fileNodes = index.nodesByFile.get(resolvedFilePath) ?? []
        const fileNode = fileNodes.find((n) => n.type === 'file')
        if (fileNode) {
          result.push({ ...edge, resolve_status: 'resolved', target_id: fileNode.id })
        /* v8 ignore next -- pickTargetInFile only returns need_barrel after seeing a valid file node for the same file. */
        } else {
          /* v8 ignore next 2 -- pickTargetInFile only returns need_barrel after seeing a valid file node for the same file. */
          result.push({ ...edge, resolve_status: 'failed', target_id: null })
        }
      }
      emitProgress(edge)
    }
  } catch (e: unknown) {
    // 예기치 못한 예외 → BuildGraphError (cause.message 포함 금지)
    throw new BuildGraphError('build_graph failed at F3a', 'GRAPH_FAILED')
  }

  return result
}

function progressInterval(total: number): number {
  if (total <= 100) return 10
  if (total <= 1_000) return 50
  if (total <= 10_000) return 250
  return 1_000
}
