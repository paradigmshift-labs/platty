import { createHash } from 'node:crypto'
import type {
  MatchedServiceMapFact,
  DraftServiceMapEdge,
  EdgeEvidence,
} from './types.js'

export function buildEdges(
  facts: MatchedServiceMapFact[],
  scope: { projectId: string; fallbackRepoId?: string | null },
): DraftServiceMapEdge[] {
  return facts.map((fact) => {
    const sourceRepoId = fact.sourceNode.repoId ?? fact.targetNode.repoId ?? scope.fallbackRepoId
    if (!sourceRepoId) {
      throw new Error(`Cannot build service map edge without a source repository: ${fact.factId}`)
    }
    const targetRepoId = fact.targetNode.repoId ?? null
    const id = stableEdgeId(scope.projectId, sourceRepoId, targetRepoId, fact)
    const evidence = buildEvidence(fact)

    return {
      id,
      projectId: scope.projectId,
      repoId: sourceRepoId,
      sourceRepoId,
      targetRepoId,
      sourceNode: fact.sourceNode,
      targetNode: fact.targetNode,
      kind: fact.edgeKind,
      canonicalTarget: fact.canonicalTarget,
      confidence: fact.confidence,
      source: fact.source,
      evidence,
      unresolvedReason: fact.unresolvedReason ?? null,
    }
  })
}

function stableEdgeId(
  projectId: string,
  sourceRepoId: string,
  targetRepoId: string | null,
  fact: MatchedServiceMapFact,
): string {
  const seed = [
    projectId,
    sourceRepoId,
    targetRepoId ?? '',
    fact.sourceNode.type,
    fact.sourceNode.id,
    fact.edgeKind,
    fact.targetNode.type,
    fact.targetNode.id,
    fact.canonicalTarget,
  ].join(':')
  return createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

function buildEvidence(fact: MatchedServiceMapFact): EdgeEvidence {
  const evidence: EdgeEvidence = {}

  if (fact.relationId) {
    evidence.relation_ids = [fact.relationId]
  }
  if (fact.documentId) {
    evidence.document_ids = [fact.documentId]
  }
  if (fact.suffixMatch) {
    evidence.suffix_match = {
      raw_suffix: fact.suffixMatch.rawSuffix,
      base_url_env: fact.suffixMatch.baseUrlEnv,
    }
    if (fact.suffixMatch.proximityScore !== undefined) {
      evidence.proximity_score = fact.suffixMatch.proximityScore
    }
  }

  return evidence
}
