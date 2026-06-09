import type { DB } from '@/db/client.js'
import { buildCodeRelationFacts, buildSourceContext } from './context_builder.js'
import type { DocumentTarget, GroupContext, RelationFactContext, SourceContext } from '../runtime/types.js'

export async function buildPreLlmContext(
  group: DocumentTarget,
  repoId: string,
  db: DB,
  opts?: { maxHops?: number; maxTokens?: number; repoPath?: string },
): Promise<GroupContext> {
  const namespace = `pre_llm:${group.documentId}`
  const relationFacts = buildCodeRelationFacts({
    db,
    repoId,
    seedNodeIds: group.seedNodeIds,
    namespace,
  })
  const { sourceContext } = buildSourceContext({
    db,
    repoId,
    seedNodeIds: group.seedNodeIds,
    entryPointIds: group.entryPointIds,
    codeRelationFacts: relationFacts,
    namespace,
    repoPath: opts?.repoPath,
  })
  const contracts = sourceContext.map(toCollectedContract)
  return {
    group,
    contracts,
    relations: relationFacts.map(toGroupRelation),
    estimatedTokens: estimateTokens(contracts),
    truncated: false,
  }
}

function toCollectedContract(source: SourceContext): GroupContext['contracts'][number] {
  return {
    nodeId: source.node_id,
    nodeType: source.node_type,
    name: source.symbol,
    filePath: source.file_path,
    lineStart: source.line_start,
    lineEnd: source.line_end,
    signature: source.signature,
    sourceCode: source.source_excerpt,
    sourceMissing: source.source_missing,
    hop: source.hop,
    depType: source.dep_type,
  }
}

function toGroupRelation(relation: RelationFactContext): GroupContext['relations'][number] {
  return {
    relationId: relation.relation_id,
    repoId: relation.repo_id,
    sourceNodeId: relation.source_node_id,
    kind: relation.kind,
    target: relation.target,
    operation: relation.operation,
    canonicalTarget: relation.canonical_target,
    payload: relation.payload,
    evidenceNodeIds: relation.evidence_node_ids,
    confidence: relation.confidence,
    unresolvedReason: relation.unresolved_reason,
  }
}

function estimateTokens(contracts: GroupContext['contracts']): number {
  const chars = contracts.reduce((sum, contract) => sum + contract.sourceCode.length + (contract.signature?.length ?? 0), 0)
  return Math.max(1, Math.ceil(chars / 4))
}
