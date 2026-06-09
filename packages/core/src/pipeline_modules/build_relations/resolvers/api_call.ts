// API call resolver
// SOT: specs/build_relations/architecture.md §5.2

import type { RelationCandidate, SemanticIndex, SourceFallback, ExtractedRelation } from '../types.js'

const INTERNAL_PATH_RE = /^\/[^/]/
const EXTERNAL_URL_RE = /^https?:\/\//
const IDENTIFIER_RE = /^[A-Za-z_$][\w.$]*$/
const GRAPHQL_TARGET_RE = /^graphql:[A-Za-z_][\w]*$/
const TRPC_TARGET_RE = /^trpc:[A-Za-z_][\w.]*$/
const ORPC_TARGET_RE = /^orpc:[A-Za-z_][\w.]*$/

export function resolveApiCallCandidate(
  candidate: RelationCandidate,
  index: SemanticIndex,
  sourceFallback: SourceFallback,
): ExtractedRelation | null {
  const rawTarget = candidate.rawTarget ?? candidate.firstArg ?? null
  if (!rawTarget) return null

  const method = (candidate.payload.method as string | undefined) ?? 'UNKNOWN'
  const protocol = (candidate.payload.protocol as string | undefined) ?? 'rest'
  const anchor = candidate.payload.anchor as string | undefined

  let target: string | null = null
  let confidence: 'high' | 'medium' = 'high'

  if (GRAPHQL_TARGET_RE.test(rawTarget) || TRPC_TARGET_RE.test(rawTarget) || ORPC_TARGET_RE.test(rawTarget)) {
    target = rawTarget
    confidence = 'high'
  } else if (EXTERNAL_URL_RE.test(rawTarget)) {
    return buildExternalHttpServiceRelation(candidate, rawTarget)
  } else if (INTERNAL_PATH_RE.test(rawTarget)) {
    // static internal path
    target = normalizeInternalPathTarget(rawTarget)
    if (!target) return null
    confidence = anchor === 'global_fetch' ? 'medium' : 'high'
  } else if (IDENTIFIER_RE.test(rawTarget)) {
    // constant identifier → source fallback 시도
    const node = index.nodesById.get(candidate.sourceNodeId)
    const resolved = sourceFallback.resolveConstant({
      identifier: rawTarget,
      nodeId: candidate.sourceNodeId,
      filePath: node?.filePath ?? '',
      allowedScopes: ['api', 'external'],
    })
    if (!resolved) {
      if (candidate.payload.adapter !== 'pattern_dsl') return null
      target = rawTarget
      confidence = 'medium'
    } else {
      if (EXTERNAL_URL_RE.test(resolved)) return buildExternalHttpServiceRelation(candidate, resolved)
      if (protocol === 'graphql') {
        const operationName = extractGraphQLOperationName(resolved)
        if (!operationName) return null
        target = `graphql:${operationName}`
      } else {
        target = applyBaseUrl(resolved, candidate.payload.baseURL)
      }
      confidence = 'medium'
    }
  } else {
    // dynamic target (template literal 등) → no-emit
    return null
  }

  const canonicalTarget = method === 'UNKNOWN' ? `UNKNOWN ${target}` : `${method} ${target}`

  return {
    sourceNodeId: candidate.sourceNodeId,
    kind: 'api_call',
    target,
    operation: method,
    canonicalTarget,
    payload: { ...candidate.payload, protocol },
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence,
  }
}

function buildExternalHttpServiceRelation(candidate: RelationCandidate, url: string): ExtractedRelation | null {
  const host = externalHost(url)
  if (!host) return null
  return {
    sourceNodeId: candidate.sourceNodeId,
    kind: 'external_service',
    target: `http:${host}`,
    operation: 'fetch',
    canonicalTarget: `external_service:http:${host}`,
    payload: { ...candidate.payload, protocol: 'http_external', service: 'http', url },
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence: 'medium',
  }
}

function externalHost(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

function extractGraphQLOperationName(source: string): string | null {
  return source.match(/\b(?:query|mutation|subscription)\s+([A-Za-z_][\w]*)/)?.[1] ?? null
}

function applyBaseUrl(path: string, baseURL: unknown): string {
  if (typeof baseURL !== 'string') return path
  if (!INTERNAL_PATH_RE.test(baseURL) || !INTERNAL_PATH_RE.test(path)) return path
  const normalizedBase = baseURL.replace(/\/+$/, '')
  if (path === normalizedBase || path.startsWith(`${normalizedBase}/`)) return path
  return `${normalizedBase}/${path.replace(/^\/+/, '')}`
}

// Exported for the api_call rule-authoring referee (reuse the real internal-endpoint normalization).
export function normalizeInternalPathTarget(rawTarget: string): string | null {
  if (!rawTarget.includes('${')) return rawTarget

  const [pathPart] = rawTarget.split('?')
  const normalized = pathPart
    .replace(/\$\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\}/g, (_match, expression: string) => {
      const name = expression.split('.').pop() ?? 'value'
      return `:${name}`
    })
    .replace(/\/+$/, '')
  if (!INTERNAL_PATH_RE.test(normalized)) return null
  if (hasDynamicApiResourceSegment(normalized)) return null
  return normalized
}

function hasDynamicApiResourceSegment(path: string): boolean {
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) return false
  const namespace = parts[0]
  const resource = parts[1]
  if (!resource?.startsWith(':')) return false
  return namespace === 'api' || namespace === 'rest' || /^v\d+(?:\.\d+)?$/.test(namespace)
}
