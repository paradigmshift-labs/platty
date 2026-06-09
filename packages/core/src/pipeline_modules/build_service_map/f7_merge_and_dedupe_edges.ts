import type {
  DraftServiceMapEdge,
  MergedServiceMapEdge,
  ServiceMapEdgeSource,
  EdgeEvidence,
} from './types.js'

type Confidence = 'high' | 'medium' | 'low'

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 }

function dedupeKey(edge: DraftServiceMapEdge): string {
  return [
    edge.projectId,
    edge.sourceRepoId,
    edge.targetRepoId ?? '',
    edge.sourceNode.type,
    edge.sourceNode.id,
    edge.targetNode.type,
    edge.targetNode.id,
    edge.kind,
    edge.canonicalTarget,
  ].join('\0')
}

function mergeSource(
  sources: ServiceMapEdgeSource[],
): ServiceMapEdgeSource {
  const set = new Set(sources)
  if (set.has('deterministic') && (set.has('doc_llm') || set.has('merged'))) return 'merged'
  if (set.has('suffix_match') && (set.has('doc_llm') || set.has('merged'))) return 'merged'
  if (set.has('deterministic')) return 'deterministic'
  if (set.has('suffix_match')) return 'suffix_match'
  return 'doc_llm'
}

function mergeConfidence(
  sources: ServiceMapEdgeSource[],
  confidences: Confidence[],
): Confidence {
  const maxConf = confidences.reduce<Confidence>((best, c) =>
    CONFIDENCE_RANK[c] > CONFIDENCE_RANK[best] ? c : best, 'low')

  const merged = mergeSource(sources)
  // deterministic + doc agree → high
  if (merged === 'merged' && sources.includes('deterministic')) return 'high'
  // suffix_match + doc agree → medium
  if (merged === 'merged' && sources.includes('suffix_match')) return 'medium'
  return maxConf
}

function mergeEvidence(edges: DraftServiceMapEdge[]): EdgeEvidence {
  const relationIds = new Set<string>()
  const documentIds = new Set<string>()
  const warnings: string[] = []

  for (const edge of edges) {
    edge.evidence.relation_ids?.forEach((id) => relationIds.add(id))
    edge.evidence.document_ids?.forEach((id) => documentIds.add(id))
    edge.evidence.warnings?.forEach((w) => warnings.push(w))
  }

  const result: EdgeEvidence = {}
  if (relationIds.size > 0) result.relation_ids = [...relationIds]
  if (documentIds.size > 0) result.document_ids = [...documentIds]
  if (warnings.length > 0) result.warnings = [...new Set(warnings)]

  // suffix_match from any source
  const suffixEdge = edges.find((e) => e.evidence.suffix_match)
  if (suffixEdge?.evidence.suffix_match) {
    result.suffix_match = suffixEdge.evidence.suffix_match
  }
  const proximityEdge = edges.find((e) => e.evidence.proximity_score !== undefined)
  if (proximityEdge?.evidence.proximity_score !== undefined) {
    result.proximity_score = proximityEdge.evidence.proximity_score
  }

  return result
}

export function mergeAndDedupeEdges(edges: DraftServiceMapEdge[]): MergedServiceMapEdge[] {
  // Group by dedupe key
  const groups = new Map<string, DraftServiceMapEdge[]>()
  for (const edge of edges) {
    const key = dedupeKey(edge)
    const arr = groups.get(key) ?? []
    arr.push(edge)
    groups.set(key, arr)
  }

  const merged: MergedServiceMapEdge[] = []

  for (const [, group] of groups) {
    if (group.length === 1) {
      merged.push(group[0])
      continue
    }

    // Check for canonical target conflicts (different targets under same key isn't possible
    // by definition since key includes canonicalTarget — conflicts are separate keys merged by logical dedup)
    // Within a group, deterministic + suffix agree → deterministic wins
    const sources = group.map((e) => e.source)
    const confidences = group.map((e) => e.confidence)
    const representativeEdge = group.find((e) => e.source === 'deterministic') ?? group[0]

    const newSource = mergeSource(sources)
    const newConfidence = mergeConfidence(sources, confidences)
    const newEvidence = mergeEvidence(group)

    merged.push({
      ...representativeEdge,
      source: newSource,
      confidence: newConfidence,
      evidence: newEvidence,
    })
  }

  return merged
}
