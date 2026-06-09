// External link resolver
// SOT: specs/build_relations/architecture.md §5.4

import type { RelationCandidate, SemanticIndex, SourceFallback, ExtractedRelation } from '../types.js'

export function resolveExternalLinkCandidate(
  candidate: RelationCandidate,
  index: SemanticIndex,
  sourceFallback: SourceFallback,
): ExtractedRelation | null {
  const rawUrl = candidate.rawTarget ?? candidate.firstArg ?? null
  if (!rawUrl) return null

  let url = rawUrl
  if (!isExternalUrl(url)) {
    const node = index.nodesById.get(candidate.sourceNodeId)
    const resolved = sourceFallback.resolveConstant({
      identifier: rawUrl,
      nodeId: candidate.sourceNodeId,
      filePath: node?.filePath ?? '',
      allowedScopes: ['external'],
    })
    if (!resolved) return null
    if (!isExternalUrl(resolved)) return null
    url = resolved
  }

  const payloadScheme = candidate.payload.scheme as string | undefined
  const scheme = payloadScheme && payloadScheme !== 'unknown' ? payloadScheme : extractScheme(url)
  const method = (candidate.payload.method as string | undefined) ?? 'open'
  const operation = method === 'link' ? 'link' : 'open'

  return {
    sourceNodeId: candidate.sourceNodeId,
    kind: 'external_link',
    target: url,
    operation,
    canonicalTarget: `external:${url}`,
    payload: { ...candidate.payload, scheme },
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence: 'high',
  }
}

function extractScheme(url: string): string {
  const match = url.match(/^([a-z][a-z0-9+.-]*):/)
  return match?.[1] ?? 'unknown'
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//.test(url) || /^[a-z][a-z0-9+.-]*:/.test(url)
}
