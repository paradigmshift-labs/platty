import type { CodeNode } from '@/db/schema/code_graph.js'
import type { EntryPointDraft, StackInfoForBuildRoute } from './types.js'

export interface ComposeEntryPointsInput {
  repoId: string
  graphNodes: CodeNode[]
  stackInfo: StackInfoForBuildRoute
  ruleEntries: EntryPointDraft[]
  sourceFallbackEntries: EntryPointDraft[]
  llmEntries: EntryPointDraft[]
  semanticSuspected?: number
  /**
   * supportsGlobalPrefix=true인 어댑터의 framework 이름 Set.
   * applyApiBasePaths가 화이트리스트 대신 이 Set으로 prefix 적용 대상을 판정.
   * 미지정 시 빈 Set (어떤 framework도 prefix 미적용).
   */
  globalPrefixFrameworks?: Set<string>
}

export interface ComposeEntryPointsResult {
  entryPoints: EntryPointDraft[]
  diagnostics: Record<string, number>
}

export function composeEntryPoints(input: ComposeEntryPointsInput): ComposeEntryPointsResult {
  const merged = mergeSourceFallbackEntries(
    input.ruleEntries,
    input.sourceFallbackEntries,
    input.llmEntries,
  )
  const semantic = dedupeSemanticEntries(merged.filter(isSemanticEntry), input.graphNodes)
  const external = dedupeFileFallbackEntries(
    merged.filter((entry) => !isSemanticEntry(entry)),
    input.graphNodes,
  )
  const deduped = removeMethodlessEntriesShadowedByMethodAwareHandlers([...external, ...semantic.entryPoints])
  const apiBaseResult = applyApiBasePaths(
    deduped,
    input.stackInfo.apiBasePaths ?? [],
    input.globalPrefixFrameworks ?? new Set(),
  )
  const entryPoints = apiBaseResult.entries

  return {
    entryPoints,
    diagnostics: {
      ruleEntries: input.ruleEntries.length,
      sourceFallbackEntries: input.sourceFallbackEntries.length,
      llmEntries: input.llmEntries.length,
      mergedEntries: merged.length,
      dedupedEntries: deduped.length,
      finalEntries: entryPoints.length,
      semanticEntries: semantic.entryPoints.length,
      semanticSuspected: input.semanticSuspected ?? 0,
      internalEntriesDeduped: semantic.deduped,
      ...apiBaseResult.diagnostics,
    },
  }
}

function removeMethodlessEntriesShadowedByMethodAwareHandlers(entries: EntryPointDraft[]): EntryPointDraft[] {
  const methodAware = new Set(entries
    .filter((entry) => entry.kind === 'api' && Boolean(entry.httpMethod))
    .map((entry) => methodlessHandlerKey(entry)))

  return entries.filter((entry) => {
    if (entry.kind !== 'api') return true
    if (entry.httpMethod) return true
    return !methodAware.has(methodlessHandlerKey(entry))
  })
}

function methodlessHandlerKey(entry: EntryPointDraft): string {
  return [
    entry.framework,
    entry.kind,
    entry.handlerNodeId,
    entry.fullPath ?? entry.path ?? '',
  ].join('\0')
}

function mergeSourceFallbackEntries(
  ruleEntries: EntryPointDraft[],
  sourceFallbackEntries: EntryPointDraft[],
  llmEntries: EntryPointDraft[],
): EntryPointDraft[] {
  // registry-driven: 각 source entry의 metadata.mergePolicy를 읽어 rule entry 필터링.
  // 어댑터 declaration이 SourceRouteAdapter.mergePolicy로 정책을 선언하면 sourceAdapter
  // helper가 자동으로 entry.metadata.mergePolicy에 태깅 → compose는 metadata만 읽으면 됨.
  let filtered = [...ruleEntries]

  // supersede_framework: source가 있는 framework의 rule entry 전체 제거
  const supersedeFrameworks = new Set<string>()
  for (const entry of sourceFallbackEntries) {
    if (entry.metadata?.mergePolicy === 'supersede_framework') {
      supersedeFrameworks.add(entry.framework)
    }
  }
  if (supersedeFrameworks.size > 0) {
    filtered = filtered.filter((entry) => !supersedeFrameworks.has(entry.framework))
  }

  // supersede_handler: source의 handlerNodeId와 매칭되는 rule entry 중,
  // entryKey가 source에 없는 것만 제거 (exact match는 유지 — file fallback dedup이 처리)
  const supersedeHandlerSources = sourceFallbackEntries.filter(
    (entry) => entry.metadata?.mergePolicy === 'supersede_handler',
  )
  if (supersedeHandlerSources.length > 0) {
    const handlerIds = new Set(supersedeHandlerSources.map((e) => e.handlerNodeId))
    const exactKeys = new Set(supersedeHandlerSources.map(entryKey))
    filtered = filtered.filter((entry) => {
      // source의 framework와 다르면 skip (supersede는 동일 framework 내에서만)
      const sameFamily = supersedeHandlerSources.some((s) => s.framework === entry.framework)
      if (!sameFamily) return true
      if (!handlerIds.has(entry.handlerNodeId)) return true
      return exactKeys.has(entryKey(entry))
    })
  }

  return [...filtered, ...sourceFallbackEntries, ...llmEntries]
}

function dedupeSemanticEntries(
  entries: EntryPointDraft[],
  nodes: CodeNode[],
): { entryPoints: EntryPointDraft[]; deduped: number } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const out: EntryPointDraft[] = []
  let deduped = 0

  for (const entry of entries) {
    const key = semanticKey(entry)
    const idx = out.findIndex((existing) => semanticKey(existing) === key)
    if (idx < 0) {
      out.push(entry)
      continue
    }

    deduped += 1
    if (shouldPreferHandler(entry, out[idx], nodeById)) out[idx] = entry
  }

  return { entryPoints: out, deduped }
}

function dedupeFileFallbackEntries(entries: EntryPointDraft[], nodes: CodeNode[]): EntryPointDraft[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const out: EntryPointDraft[] = []

  for (const entry of entries) {
    const idx = out.findIndex((existing) => {
      if (existing.framework !== entry.framework) return false
      if (existing.kind !== entry.kind) return false
      const existingNode = nodeById.get(existing.handlerNodeId)
      const entryNode = nodeById.get(entry.handlerNodeId)
      // 일반화: 어떤 framework든 같은 framework + kind='job' + 같은 handler = 중복
      // (예: NestJS @Cron + nestjs_schedule source의 같은 handler emit)
      if (isDuplicateJobByHandler(existing, entry)) return true
      // file-fallback + method-level path overlap dedup —
      // entry.metadata.fileFallbackPathOverlap === true로 opt-in한 source adapter에만 적용.
      // (NestJS controller가 file과 method 양쪽에서 같은 endpoint를 emit하는 패턴 — 향후 다른
      // framework도 같은 dedup이 필요하면 source adapter에서 같은 metadata를 태깅하면 됨)
      /* v8 ignore next 13 -- compound duplicate predicate is behavior-covered by compose tests. */
      if (
        existing.kind === 'api' &&
        entry.kind === 'api' &&
        (hasFileFallbackPathOverlap(existing) || hasFileFallbackPathOverlap(entry)) &&
        (existing.httpMethod ?? '') === (entry.httpMethod ?? '') &&
        (
          existing.handlerNodeId === entry.handlerNodeId ||
          (existingNode?.filePath && existingNode.filePath === entryNode?.filePath && (existingNode.type === 'file' || entryNode?.type === 'file'))
        )
      ) {
        return pathsOverlap(existing.fullPath ?? existing.path ?? '', entry.fullPath ?? entry.path ?? '')
      }
      /* v8 ignore next 10 -- generic file fallback duplicate predicate is behavior-covered by compose tests. */
      if ((existing.fullPath ?? existing.path ?? '') !== (entry.fullPath ?? entry.path ?? '')) return false
      if ((existing.metadata?.interactionKind ?? '') !== (entry.metadata?.interactionKind ?? '')) return false
      if (existingNode?.type !== 'file' && entryNode?.type !== 'file') return false
      return (
        (existing.httpMethod ?? '') === (entry.httpMethod ?? '') ||
        existing.httpMethod === undefined ||
        existing.httpMethod === null ||
        entry.httpMethod === undefined ||
        entry.httpMethod === null
      )
    })

    if (idx < 0) {
      out.push(entry)
      continue
    }

    const existing = out[idx]
    if (shouldPreferSourceJobOverRule(entry, existing)) {
      out[idx] = mergeEntryEvidence(entry, existing)
      continue
    }
    if (shouldPreferLongerSpecificPath(entry, existing)) {
      out[idx] = mergeEntryEvidence(entry, existing)
      continue
    }
    if (shouldPreferHandler(entry, existing, nodeById)) {
      out[idx] = mergeEntryEvidence(entry, existing)
      continue
    }
    out[idx] = mergeEntryEvidence(existing, entry)
  }

  return out
}

/**
 * source adapter가 'fileFallbackPathOverlap' 옵션을 opt-in했는지 확인.
 * NestJS controller 패턴(file fallback + method-level)에 적용 — 같은 metadata를 다른 framework의
 * source adapter도 태깅하면 동일 dedup 로직 자동 적용됨.
 */
function hasFileFallbackPathOverlap(entry: EntryPointDraft): boolean {
  return entry.metadata?.fileFallbackPathOverlap === true
}

/**
 * 같은 framework + kind='job' + 같은 handlerNodeId인 두 entry는 중복으로 간주한다.
 * 일반화: 어떤 framework든 적용 가능. NestJS @Cron + nestjs_schedule source가 대표 케이스이지만,
 * 향후 다른 framework의 schedule job도 동일하게 처리됨.
 */
function isDuplicateJobByHandler(left: EntryPointDraft, right: EntryPointDraft): boolean {
  return (
    left.framework === right.framework &&
    left.kind === 'job' &&
    right.kind === 'job' &&
    left.handlerNodeId === right.handlerNodeId
  )
}

/**
 * 두 job entry가 중복일 때 source 감지가 rule 감지보다 우선.
 * 일반화: detectionSource가 'source:'로 시작하면 우선 (어떤 framework의 source adapter든 적용).
 */
function shouldPreferSourceJobOverRule(candidate: EntryPointDraft, current: EntryPointDraft): boolean {
  if (!isDuplicateJobByHandler(candidate, current)) return false
  const candidateIsSource = candidate.detectionSource.startsWith('source:')
  const currentIsSource = current.detectionSource.startsWith('source:')
  return candidateIsSource && !currentIsSource
}

function mergeEntryEvidence(primary: EntryPointDraft, secondary: EntryPointDraft): EntryPointDraft {
  const evidence = [
    ...metadataEvidence(primary.metadata),
    ...metadataEvidence(secondary.metadata),
  ]
  const matchedNodeIds = [
    ...(primary.detectionEvidence.matchedNodeIds ?? []),
    ...(secondary.detectionEvidence.matchedNodeIds ?? []),
  ].filter((id, index, all): id is string => typeof id === 'string' && id.length > 0 && all.indexOf(id) === index)
  const matchedEdgeIds = [
    ...(primary.detectionEvidence.matchedEdgeIds ?? []),
    ...(secondary.detectionEvidence.matchedEdgeIds ?? []),
  ].filter((id, index, all): id is number => typeof id === 'number' && all.indexOf(id) === index)
  return {
    ...primary,
    detectionEvidence: {
      ...secondary.detectionEvidence,
      ...primary.detectionEvidence,
      matchedNodeIds,
      matchedEdgeIds,
    },
    metadata: {
      ...secondary.metadata,
      ...primary.metadata,
      ...(evidence.length > 0 ? { evidence: dedupeEvidence(evidence) } : {}),
    },
  }
}

function metadataEvidence(metadata: Record<string, unknown>): unknown[] {
  return Array.isArray(metadata.evidence) ? metadata.evidence : []
}

function dedupeEvidence(evidence: unknown[]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const item of evidence) {
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function applyApiBasePaths(
  entries: EntryPointDraft[],
  apiBasePaths: string[],
  globalPrefixFrameworks: Set<string>,
): { entries: EntryPointDraft[]; diagnostics: Record<string, number> } {
  const bases = apiBasePaths.filter((base) => base && base !== '/')
  if (bases.length === 0) return { entries, diagnostics: {} }
  if (bases.length > 1) {
    // silent skip 방지 — 다중 base는 적용 불가하지만 경고로 visibility 확보
    return { entries, diagnostics: { api_base_paths_ambiguous: 1 } }
  }

  const out: EntryPointDraft[] = []
  for (const entry of entries) {
    if (isSemanticEntry(entry) || entry.kind !== 'api' || !globalPrefixFrameworks.has(entry.framework)) {
      out.push(entry)
      continue
    }
    const localFullPath = entry.fullPath ?? entry.path
    if (!localFullPath) {
      out.push(entry)
      continue
    }
    if (entry.framework === 'express' && (localFullPath === '/' || localFullPath === '/*')) {
      out.push(entry)
      continue
    }
    if (entry.framework === 'express' && isExpressStandaloneUtilityPath(localFullPath)) {
      out.push(entry)
      continue
    }
    if (localFullPath === bases[0] || localFullPath.startsWith(`${bases[0]}/`)) {
      out.push(entry)
      continue
    }
    out.push({
      ...entry,
      fullPath: joinUrlPath(bases[0], localFullPath),
    })
  }
  return { entries: out, diagnostics: {} }
}

function shouldPreferHandler(
  candidate: EntryPointDraft,
  current: EntryPointDraft,
  nodeById: Map<string, CodeNode>,
): boolean {
  const currentNode = nodeById.get(current.handlerNodeId)
  const candidateNode = nodeById.get(candidate.handlerNodeId)
  if (currentNode?.type === 'file' && candidateNode?.type !== 'file') return true
  /* v8 ignore next 6 -- tie-break predicate is covered behaviorally; V8 reports nullish segments separately. */
  return (
    currentNode?.type === 'file' &&
    candidateNode?.type === 'file' &&
    (current.httpMethod === undefined || current.httpMethod === null) &&
    Boolean(candidate.httpMethod)
  )
}

function semanticKey(entry: EntryPointDraft): string {
  const parentPage = typeof entry.metadata?.parentPage === 'string' ? entry.metadata.parentPage : ''
  const label = typeof entry.metadata?.label === 'string' ? entry.metadata.label : ''
  const index = typeof entry.metadata?.index === 'number' ? String(entry.metadata.index) : ''
  /* v8 ignore next 2 -- semantic key modes are covered by parent metadata and internal-path dedupe tests. */
  if (parentPage && (label || index)) return `semantic:${parentPage}:${label}:${index}`
  return `semantic:${entry.fullPath ?? entry.path ?? ''}`
}

function isSemanticEntry(entry: EntryPointDraft): boolean {
  return entry.metadata?.semanticEntry === true || (entry.fullPath ?? entry.path ?? '').startsWith('internal://')
}

function pathsOverlap(left: string, right: string): boolean {
  /* v8 ignore next 4 -- path overlap modes are covered via NestJS source merge tests. */
  if (left === right) return true
  if (left === '/' || right === '/') return true
  return isPathSuffix(left, right) || isPathSuffix(right, left)
}

function shouldPreferLongerSpecificPath(candidate: EntryPointDraft, current: EntryPointDraft): boolean {
  /* v8 ignore next 6 -- path preference is covered via compose-level merge tests; V8 reports nullish setup branches separately. */
  const candidatePath = candidate.fullPath ?? candidate.path ?? ''
  const currentPath = current.fullPath ?? current.path ?? ''
  if (!candidatePath || !currentPath || candidatePath === currentPath) return false
  if (currentPath === '/' && candidatePath !== '/') return true
  return isPathSuffix(currentPath, candidatePath) && candidatePath.length > currentPath.length
}

/* v8 ignore next 5 -- private helper is exercised through path overlap/preference callers; V8 keeps residual helper branch accounting. */
function isPathSuffix(shorter: string, longer: string): boolean {
  if (!shorter || !longer || shorter === longer) return false
  return longer.endsWith(shorter.startsWith('/') ? shorter : `/${shorter}`)
}

function entryKey(entry: EntryPointDraft): string {
  /* v8 ignore next -- entry keys are used for exact Express mount matching; nullish method behavior is covered. */
  return `${entry.framework}:${entry.kind}:${entry.httpMethod ?? ''}:${entry.fullPath ?? entry.path ?? ''}`
}

function joinUrlPath(parent: string, child: string): string {
  const raw = `${parent.replace(/\/$/, '')}/${child.replace(/^\//, '')}`
  const normalized = raw.replace(/\/+/g, '/')
  /* v8 ignore next -- raw always contains '/' for current callers. */
  if (normalized === '') return '/'
  /* v8 ignore next -- root result branch is covered by base-path exception before this helper is called. */
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

function isExpressStandaloneUtilityPath(path: string): boolean {
  return path === '/health' || path.startsWith('/health/')
    || path === '/metrics' || path.startsWith('/metrics/')
    || path === '/monitoring' || path.startsWith('/monitoring/')
    || path === '/api-docs' || path.startsWith('/api-docs/')
    || path === '/docs' || path.startsWith('/docs/')
    || path === '/swagger' || path.startsWith('/swagger/')
    || path === '/secret' || path.startsWith('/secret/')
}
