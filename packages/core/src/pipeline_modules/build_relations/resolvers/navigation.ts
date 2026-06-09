// Navigation resolver
// SOT: specs/build_relations/architecture.md §5.3

import type { RelationCandidate, SemanticIndex, SourceFallback, ExtractedRelation } from '../types.js'

const INTERNAL_PATH_RE = /^\/($|[^/])/
const IDENTIFIER_RE = /^[A-Za-z_$][\w.$]*$/

export function resolveNavigationCandidate(
  candidate: RelationCandidate,
  index: SemanticIndex,
  sourceFallback: SourceFallback,
): ExtractedRelation | null {
  const rawTarget = candidate.rawTarget ?? candidate.firstArg ?? null
  if (!rawTarget) return null

  const method = (candidate.payload.method as string | undefined) ?? 'link'
  const router = (candidate.payload.router as string | undefined) ?? 'unknown'
  const surface = candidate.payload.surface as string | null | undefined

  let target: string | null = null
  let confidence: 'high' | 'medium' = 'high'

  if (INTERNAL_PATH_RE.test(rawTarget)) {
    target = rawTarget
  } else if (IDENTIFIER_RE.test(rawTarget)) {
    const node = index.nodesById.get(candidate.sourceNodeId)
    const resolved = sourceFallback.resolveConstant({
      identifier: rawTarget,
      nodeId: candidate.sourceNodeId,
      filePath: node?.filePath ?? '',
      allowedScopes: ['route'],
    })
    if (resolved) {
      target = resolved
      confidence = 'medium'
    } else if (method.endsWith('Named')) {
      target = rawTarget
    } else {
      return null
    }
  } else {
    return null
  }

  const canonicalTarget = `screen:${target}`

  const payload: Record<string, unknown> = { ...candidate.payload, router, target_path: target }
  if (surface) payload.surface = surface

  return {
    sourceNodeId: candidate.sourceNodeId,
    kind: 'navigation',
    target,
    operation: method,
    canonicalTarget,
    payload,
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence,
  }
}
