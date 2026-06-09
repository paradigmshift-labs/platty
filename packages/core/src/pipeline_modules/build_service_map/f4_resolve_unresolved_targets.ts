import type {
  DeterministicFactIndex,
  DocumentFactIndex,
  ServiceMapInputIndex,
  ResolvedFactSet,
  ResolvedRelationFact,
  AnchoredRelationFact,
  UnresolvedServiceMapFact,
} from './types.js'
import { matchBySuffix } from './matchers.js'

export function resolveUnresolvedTargets(input: {
  deterministic: DeterministicFactIndex
  documents: DocumentFactIndex
  serviceMapInput: ServiceMapInputIndex
}): ResolvedFactSet {
  const { deterministic, documents, serviceMapInput } = input
  const resolvedFacts: ResolvedRelationFact[] = []
  const unresolvedFacts: UnresolvedServiceMapFact[] = [...deterministic.orphanFacts]
  const skippedMarkers: AnchoredRelationFact[] = [...deterministic.scheduleMarkers]

  // doc_llm facts: group by sourceEntryPointId for fallback lookup
  const docFactsByEp = new Map<string, AnchoredRelationFact[]>()
  for (const fact of documents.anchoredFacts) {
    const arr = docFactsByEp.get(fact.sourceEntryPointId) ?? []
    arr.push(fact)
    docFactsByEp.set(fact.sourceEntryPointId, arr)
  }

  const allAnchoredFacts = [...deterministic.anchoredFacts, ...documents.anchoredFacts]

  for (const fact of allAnchoredFacts) {
    // schedule_trigger → skip (handled as marker)
    if (fact.kind === 'schedule_trigger') continue

    // already has canonical target → pass through
    if (fact.canonicalTarget) {
      resolvedFacts.push({
        ...fact,
        canonicalTarget: fact.canonicalTarget,
        source: fact.source as 'deterministic' | 'suffix_match' | 'doc_llm',
      })
      continue
    }

    // doc_llm facts with null canonical target: try to resolve via suffix or stay unresolved
    if (fact.source === 'doc_llm') {
      unresolvedFacts.push({
        factId: fact.factId,
        kind: fact.kind,
        sourceEntryPointId: fact.sourceEntryPointId,
        documentId: fact.documentId,
        reason: 'null_canonical_target_in_doc_fact',
        metadata: fact.metadata,
      })
      continue
    }

    // deterministic fact with null canonical target → Step 1: suffix match
    const suffix = typeof fact.payload['static_suffix'] === 'string' ? fact.payload['static_suffix'] : null

    if (suffix) {
      const sourceEp = serviceMapInput.entryPoints.find((ep) => ep.id === fact.sourceEntryPointId)
      const matchResult = matchBySuffix(suffix, fact.operation, serviceMapInput.entryPoints, sourceEp?.filePath)

      if (matchResult) {
        const epPath = matchResult.entryPoint.fullPath ?? matchResult.entryPoint.path ?? suffix
        const method = (fact.operation && fact.operation !== 'UNKNOWN')
          ? fact.operation.toUpperCase()
          : (matchResult.entryPoint.httpMethod ?? 'UNKNOWN')
        const canonicalTarget = method !== 'UNKNOWN' ? `${method} ${epPath}` : epPath
        resolvedFacts.push({
          ...fact,
          canonicalTarget,
          source: 'suffix_match',
          confidence: matchResult.confidence,
          suffixMatch: {
            rawSuffix: suffix,
            baseUrlEnv: typeof fact.payload['base_url_env'] === 'string' ? fact.payload['base_url_env'] : undefined,
            proximityScore: matchResult.proximityScore,
          },
        })
        continue
      }
    }

    // Step 2: doc_llm fallback for same source entrypoint
    const docFallbacks = docFactsByEp.get(fact.sourceEntryPointId) ?? []
    const fallback = docFallbacks.find(
      (df) => df.kind === fact.kind && df.canonicalTarget,
    )

    if (fallback && fallback.canonicalTarget) {
      resolvedFacts.push({
        ...fact,
        canonicalTarget: fallback.canonicalTarget,
        source: 'doc_llm',
        confidence: fallback.confidence,
        documentId: fallback.documentId,
      })
      continue
    }

    // Step 3: unresolved
    unresolvedFacts.push({
      factId: fact.factId,
      kind: fact.kind,
      sourceEntryPointId: fact.sourceEntryPointId,
      relationId: fact.relationId,
      documentId: fact.documentId,
      reason: 'no_canonical_target_and_no_fallback',
      metadata: fact.metadata,
    })
  }

  return { facts: resolvedFacts, unresolvedFacts, skippedMarkers }
}
