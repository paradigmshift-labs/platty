import type {
  ServiceMapInputIndex,
  ResolvedFactSet,
  MergedServiceMapEdge,
  ServiceMapValidation,
  ServiceMapWarning,
} from './types.js'

type OrphanRelationCategory = 'product_gap' | 'non_product_db_fact'
type OrphanRelationSeverity = 'info' | 'warning'

function classifyOrphanRelation(
  fact: { relationId?: string; kind: string; metadata?: ServiceMapWarning['metadata'] },
  serviceMapInput: ServiceMapInputIndex,
): { category: OrphanRelationCategory; severity: OrphanRelationSeverity; metadata?: ServiceMapWarning['metadata'] } {
  if (fact.kind !== 'db_access' || !fact.relationId) {
    return { category: 'product_gap', severity: 'warning', metadata: fact.metadata }
  }

  const relation = serviceMapInput.codeRelations.find((candidate) => candidate.id === fact.relationId)
  if (!relation) return { category: 'product_gap', severity: 'warning', metadata: fact.metadata }

  const node = serviceMapInput.graphNodes.find((candidate) => candidate.id === relation.sourceNodeId)
  const filePath = node?.filePath ?? ''
  const name = node?.name ?? ''

  if (isNonProductDbFact(filePath, name, relation.payload)) {
    return {
      category: 'non_product_db_fact',
      severity: 'info',
      metadata: {
        ...fact.metadata,
        anchorFailureReason: 'non_product_db_fact',
      },
    }
  }
  return { category: 'product_gap', severity: 'warning', metadata: fact.metadata }
}

function isNonProductDbFact(filePath: string, nodeName: string, payload: Record<string, unknown>): boolean {
  const normalizedFile = filePath.replace(/\\/g, '/')
  if (normalizedFile.startsWith('test/')) return true
  if (/(\.|-)test\.[cm]?[tj]sx?$/.test(normalizedFile)) return true
  if (/(\.|-)spec\.[cm]?[tj]sx?$/.test(normalizedFile)) return true
  // DB maintenance/seed utilities are infra, not a product feature — key on the METHOD NAME generically
  // (any file: cleanDatabase / resetDb / truncateTables / seedDatabase …), not a repo-specific SGlobal.ts path.
  if (/(clean|clear|reset|truncate|wipe|drop|seed)(database|db|tables?|schema)/i.test(nodeName)) return true
  return false
}

export function validateServiceMap(input: {
  serviceMapInput: ServiceMapInputIndex
  resolvedFacts: ResolvedFactSet
  persistedEdges: MergedServiceMapEdge[]
  skippedLowConfidence: number
  failOnValidationWarning: boolean
}): ServiceMapValidation {
  const { serviceMapInput, resolvedFacts, persistedEdges, skippedLowConfidence, failOnValidationWarning } = input
  const warnings: ServiceMapWarning[] = []

  // docs 있는데 edge 0개
  if (serviceMapInput.documents.length > 0 && persistedEdges.length === 0) {
    warnings.push({
      code: 'ZERO_EDGES',
      message: 'Repository has documents but no service map edges were generated',
    })
  }

  // event publish without listener
  const publishedCanonicals = new Set<string>()
  const listenerCanonicals = new Set<string>()

  for (const ep of serviceMapInput.entryPoints) {
    if (ep.kind === 'event' || ep.kind === 'job') {
      const canonical = ep.metadata?.['canonicalTarget'] as string | undefined
      if (canonical) listenerCanonicals.add(canonical)
    }
  }

  for (const edge of persistedEdges) {
    if (edge.kind === 'publishes_event') {
      publishedCanonicals.add(edge.canonicalTarget)
    }
  }

  for (const canonical of publishedCanonicals) {
    if (!listenerCanonicals.has(canonical)) {
      warnings.push({
        code: 'EVENT_NO_LISTENER',
        message: `Event published (${canonical}) has no registered listener entry_point`,
      })
    }
  }

  // low confidence exclusion
  if (skippedLowConfidence > 0) {
    warnings.push({
      code: 'LOW_CONFIDENCE_EXCLUDED',
      message: `${skippedLowConfidence} low confidence edge(s) excluded from default product map`,
    })
  }

  // unresolved ratio > 50%
  const totalFacts = resolvedFacts.facts.length + resolvedFacts.unresolvedFacts.length
  if (totalFacts > 0) {
    const unresolvedCount = resolvedFacts.unresolvedFacts.length
    const ratio = unresolvedCount / totalFacts
    if (ratio > 0.5) {
      const pct = Math.round(ratio * 100)
      warnings.push({
        code: 'HIGH_UNRESOLVED_RATIO',
        message: `Unresolved fact ratio ${pct}% exceeds 50% threshold (${unresolvedCount}/${totalFacts} facts unresolved)`,
      })
    }
  }

  // doc facts with no resolvable entry_point
  const docUnresolved = resolvedFacts.unresolvedFacts.filter((f) => f.documentId && !f.sourceEntryPointId)
  for (const fact of docUnresolved) {
    warnings.push({
      code: 'DOC_FACT_NO_ENTRY_POINT',
      message: `Document fact (${fact.factId}) has no resolvable source entry_point`,
      factId: fact.factId,
      documentId: fact.documentId,
    })
  }

  const orphanRelations = resolvedFacts.unresolvedFacts.filter((f) => f.reason === 'source_node_not_in_any_bundle')
  for (const fact of orphanRelations) {
    const classification = classifyOrphanRelation(fact, serviceMapInput)
    warnings.push({
      code: 'RELATION_NOT_ANCHORED_TO_ENTRYPOINT',
      message: `Code relation (${fact.relationId ?? fact.factId}) was discovered but its source node is not reachable from any entry_point bundle`,
      factId: fact.factId,
      relationId: fact.relationId,
      category: classification.category,
      severity: classification.severity,
      metadata: classification.metadata,
    })
  }

  const unresolvedStaticTargets = resolvedFacts.unresolvedFacts.filter((f) =>
    f.reason === 'no_canonical_target_and_no_fallback' &&
    f.relationId &&
    f.metadata?.anchorFailureReason)
  for (const fact of unresolvedStaticTargets) {
    warnings.push({
      code: 'RELATION_STATIC_TARGET_UNRESOLVED',
      message: `Code relation (${fact.relationId}) was anchored to an entry_point but its static target could not be resolved`,
      factId: fact.factId,
      relationId: fact.relationId,
      category: 'product_gap',
      severity: 'warning',
      metadata: fact.metadata,
    })
  }

  return {
    warnings,
    shouldFail: failOnValidationWarning && warnings.length > 0,
  }
}
