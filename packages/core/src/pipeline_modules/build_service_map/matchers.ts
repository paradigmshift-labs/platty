import type { EntryPointForServiceMap, ServiceMapNodeType, ServiceMapEdgeKind, RelationFactKind } from './types.js'
import { normalizeApiCanonicalTarget, normalizeEntryPath, countSharedPrefixSegments } from './normalizers.js'

// ────────────────────────────────────────
// API matching
// ────────────────────────────────────────

interface ApiMatchResult {
  entryPoint: EntryPointForServiceMap
  confidence: 'high' | 'medium' | 'low'
  canonicalTarget?: string
}

export function matchApiCanonicalTarget(
  canonicalTarget: string,
  entryPoints: EntryPointForServiceMap[],
  targetRepoId?: string | null,
): ApiMatchResult | null {
  const apiEntryPoints = entryPoints.filter((ep) => ep.kind === 'api' && (!targetRepoId || ep.repoId === targetRepoId))
  const metadataMatches = apiEntryPoints.filter((ep) => ep.metadata?.['canonicalTarget'] === canonicalTarget)
  if (metadataMatches.length === 1) return { entryPoint: metadataMatches[0], confidence: 'high' }
  if (metadataMatches.length > 1) {
    if (!hasMultipleRepoOwners(metadataMatches)) return { entryPoint: metadataMatches[0], confidence: 'high' }
    return null
  }

  const normalized = normalizeApiCanonicalTarget(canonicalTarget)
  const parts = normalized.split(' ')
  const method = parts[0]
  const path = parts.slice(1).join(' ')

  // exact match (method + path)
  const exactMatches = apiEntryPoints.filter((ep) => {
    const epMethod = (ep.httpMethod ?? 'UNKNOWN').toUpperCase()
    const epPath = normalizeEntryPath(ep.fullPath ?? ep.path ?? '')
    return epMethod === method && epPath === path
  })
  if (exactMatches.length === 1) {
    const exact = exactMatches[0]
    const rewriteTarget = matchRewriteDestination(method, exact, apiEntryPoints)
    if (rewriteTarget) return rewriteTarget
    return { entryPoint: exact, confidence: 'high' }
  }
  if (exactMatches.length > 1) {
    if (!hasMultipleRepoOwners(exactMatches)) return { entryPoint: exactMatches[0], confidence: 'high' }
    return null
  }

  const aliases = apiPathAliases(path)
  if (aliases.length > 0) {
    const aliasMatches = apiEntryPoints.filter((ep) => {
      const epMethod = (ep.httpMethod ?? 'UNKNOWN').toUpperCase()
      const epPath = normalizeEntryPath(ep.fullPath ?? ep.path ?? '')
      return epMethod === method && aliases.includes(epPath)
    })
    if (aliasMatches.length === 1) return { entryPoint: aliasMatches[0], confidence: 'medium' }
  }

  // method=UNKNOWN → path-only match
  if (method === 'UNKNOWN') {
    const pathOnly = apiEntryPoints.filter((ep) => {
      const epPath = normalizeEntryPath(ep.fullPath ?? ep.path ?? '')
      return epPath === path
    })
    if (pathOnly.length === 1) return { entryPoint: pathOnly[0], confidence: 'medium' }
    const aliasPathOnly = apiEntryPoints.filter((ep) => {
      const epPath = normalizeEntryPath(ep.fullPath ?? ep.path ?? '')
      return aliases.includes(epPath)
    })
    if (aliasPathOnly.length === 1) return { entryPoint: aliasPathOnly[0], confidence: 'low' }
    return null
  }

  return null
}

function matchRewriteDestination(
  method: string,
  entryPoint: EntryPointForServiceMap,
  apiEntryPoints: EntryPointForServiceMap[],
): ApiMatchResult | null {
  const destination = typeof entryPoint.metadata?.rewriteDestination === 'string'
    ? normalizeEntryPath(entryPoint.metadata.rewriteDestination)
    : null
  if (!destination) return null

  const candidates = apiEntryPoints.filter((ep) => {
    if (ep.id === entryPoint.id) return false
    const epMethod = (ep.httpMethod ?? 'UNKNOWN').toUpperCase()
    const epPath = normalizeEntryPath(ep.fullPath ?? ep.path ?? '')
    return epMethod === method && epPath === destination
  })
  if (candidates.length !== 1) return null
  return {
    entryPoint: candidates[0],
    confidence: 'medium',
    canonicalTarget: `${method} ${destination}`,
  }
}

function apiPathAliases(path: string): string[] {
  if (!path.startsWith('/')) return []
  if (path === '/api' || path.startsWith('/api/')) return [path.slice('/api'.length) || '/']
  if (/^\/v\d+(?:\.\d+)?(?:\/|$)/.test(path)) return [`/api${path}`]
  return []
}

function hasMultipleRepoOwners(entryPoints: EntryPointForServiceMap[]): boolean {
  return new Set(entryPoints.map((entryPoint) => entryPoint.repoId)).size > 1
}

// ────────────────────────────────────────
// Screen/page matching
// ────────────────────────────────────────

interface ScreenMatchResult {
  entryPoint: EntryPointForServiceMap
  confidence: 'high' | 'medium' | 'low'
}

export function matchScreenCanonicalTarget(
  canonicalTarget: string,
  entryPoints: EntryPointForServiceMap[],
  sourceFilePath?: string | null,
): ScreenMatchResult | null {
  const pageEntryPoints = entryPoints.filter((ep) => ep.kind === 'page')
  const targetPath = canonicalTarget.startsWith('screen:')
    ? canonicalTarget.slice('screen:'.length)
    : canonicalTarget
  const normalizedTarget = normalizeEntryPath(targetPath)

  const candidates = pageEntryPoints.filter((ep) => {
    const epPath = normalizeEntryPath(ep.fullPath ?? ep.path ?? '')
    return epPath === normalizedTarget
  })

  if (candidates.length === 0) return null
  if (candidates.length === 1) return { entryPoint: candidates[0], confidence: 'high' }

  // multiple candidates → prefix proximity
  return resolveByProximity(candidates, sourceFilePath, 'high')
}

// ────────────────────────────────────────
// Event matching (exact canonical target)
// ────────────────────────────────────────

export function matchEventListener(
  canonicalTarget: string,
  entryPoints: EntryPointForServiceMap[],
): EntryPointForServiceMap | null {
  // listener는 event 또는 job 종류의 entry_point
  return entryPoints.find(
    (ep) =>
      (ep.kind === 'event' || ep.kind === 'job') &&
      ep.metadata?.['canonicalTarget'] === canonicalTarget,
  ) ?? null
}

// ────────────────────────────────────────
// Suffix matching
// ────────────────────────────────────────

interface SuffixMatchResult {
  entryPoint: EntryPointForServiceMap
  confidence: 'high' | 'medium' | 'low'
  proximityScore?: number
}

export function matchBySuffix(
  suffix: string,
  operation: string | null,
  entryPoints: EntryPointForServiceMap[],
  sourceFilePath?: string | null,
): SuffixMatchResult | null {
  const normalizedSuffix = normalizeEntryPath(suffix)
  const apiEntryPoints = entryPoints.filter((ep) => ep.kind === 'api')

  const method = (operation ?? 'UNKNOWN').toUpperCase()
  const candidates = apiEntryPoints.filter((ep) => {
    const epMethod = (ep.httpMethod ?? 'UNKNOWN').toUpperCase()
    if (method !== 'UNKNOWN' && epMethod !== 'UNKNOWN' && epMethod !== method) return false
    const epPath = normalizeEntryPath(ep.fullPath ?? ep.path ?? '')
    return epPath.endsWith(normalizedSuffix)
  })

  if (candidates.length === 0) return null

  if (candidates.length === 1) {
    const confidence = method === 'UNKNOWN' ? 'low' : 'medium'
    return { entryPoint: candidates[0], confidence }
  }

  // multiple candidates → proximity
  const proximityResult = resolveByProximity(candidates, sourceFilePath, 'low')
  if (!proximityResult) return null
  return {
    entryPoint: proximityResult.entryPoint,
    confidence: 'low',
    proximityScore: proximityResult.proximityScore,
  }
}

// ────────────────────────────────────────
// Proximity resolution
// ────────────────────────────────────────

function resolveByProximity(
  candidates: EntryPointForServiceMap[],
  sourceFilePath: string | null | undefined,
  baseConfidence: 'high' | 'medium' | 'low',
): (ScreenMatchResult & { proximityScore?: number }) | null {
  if (!sourceFilePath || candidates.length <= 1) {
    if (candidates.length === 1) return { entryPoint: candidates[0], confidence: baseConfidence }
    return null
  }

  const scored = candidates.map((ep) => ({
    ep,
    score: countSharedPrefixSegments(sourceFilePath, ep.filePath ?? ''),
  }))

  const maxScore = Math.max(...scored.map((s) => s.score))
  const winners = scored.filter((s) => s.score === maxScore)

  if (winners.length === 1) {
    return { entryPoint: winners[0].ep, confidence: baseConfidence, proximityScore: maxScore }
  }
  // 동점 → unresolved
  return null
}

// ────────────────────────────────────────
// Edge kind derivation
// ────────────────────────────────────────

export function deriveEdgeKind(
  relationKind: RelationFactKind,
  targetType: ServiceMapNodeType,
): ServiceMapEdgeKind {
  switch (relationKind) {
    case 'navigation':
      return targetType === 'external_link' ? 'opens_external_link' : 'navigates'
    case 'api_call':
      return targetType === 'external_service' ? 'uses_external_service' : 'calls_api'
    case 'db_access':
      return 'accesses_db'
    case 'event_publish':
      return 'publishes_event'
    case 'event_listen':
      return 'triggers'
    case 'external_service':
      return 'uses_external_service'
    case 'external_link':
      return 'opens_external_link'
    default:
      return 'calls_api'
  }
}

// canonical target에서 target node type 결정
export function deriveTargetNodeType(canonicalTarget: string): ServiceMapNodeType {
  if (canonicalTarget.startsWith('db:')) return 'db'
  if (canonicalTarget.startsWith('external_service:')) return 'external_service'
  if (canonicalTarget.startsWith('external:')) return 'external_link'
  if (canonicalTarget.startsWith('screen:')) return 'screen'
  if (
    canonicalTarget.startsWith('node_event:') ||
    canonicalTarget.startsWith('kafka:') ||
    canonicalTarget.startsWith('bull:') ||
    canonicalTarget.startsWith('websocket:') ||
    canonicalTarget.startsWith('event:')
  ) return 'event'
  if (canonicalTarget.startsWith('graphql:') || canonicalTarget.startsWith('trpc:')) {
    return 'external_service'
  }
  // METHOD /path → api
  if (/^[A-Z]+ \//.test(canonicalTarget)) return 'api'
  return 'external_service'
}

// non-entrypoint target의 node id 생성
export function deriveTargetNodeId(canonicalTarget: string, targetType: ServiceMapNodeType): string {
  switch (targetType) {
    case 'db': {
      // db:orders:insert → db:orders
      const parts = canonicalTarget.split(':')
      return `db:${parts[1] ?? canonicalTarget}`
    }
    case 'external_service':
    case 'external_link':
    case 'event':
      return canonicalTarget
    default:
      return canonicalTarget
  }
}

// source entry_point kind → ServiceMapNodeType
export function entryPointKindToNodeType(kind: 'api' | 'page' | 'job' | 'event'): ServiceMapNodeType {
  switch (kind) {
    case 'page': return 'screen'
    case 'api': return 'api'
    case 'job': return 'job'
    case 'event': return 'event'
  }
}
