/**
 * F2 — Document-based relation facts (LLM 출처).
 *
 * MVP 상태: 호출 비활성 (opts.includeDocumentFacts=false 기본).
 *   build_docs/f3_synthesize_document.ts 프롬프트가 LLM에게
 *   relation_facts를 만들지 말라고 지시하므로 documents.content.relation_facts가
 *   비어 있고, 이 함수를 호출해도 빈 결과만 나온다.
 *   불필요한 step 오버헤드를 피하기 위해 orchestrator에서 호출 자체를 스킵한다.
 *
 * 활성화 경로:
 *   1) build_docs 프롬프트에서 relation_facts 생성 금지 지시 제거
 *   2) runBuildServiceMap 호출 시 opts.includeDocumentFacts=true 전달
 *
 * 코드 자체는 입력이 비면 빈 결과를 반환하도록 이미 안전 → 그대로 유지한다.
 */
import { nanoid } from 'nanoid'
import type {
  ServiceMapInputIndex,
  DocumentFactIndex,
  AnchoredRelationFact,
  UnresolvedServiceMapFact,
  ServiceMapWarning,
  RelationFactKind,
} from './types.js'
import { countSharedPrefixSegments } from './normalizers.js'

interface RawRelationFact {
  kind?: unknown
  source_node_id?: unknown
  relation_id?: unknown
  evidence_node_id?: unknown
  target?: unknown
  operation?: unknown
  canonical_target?: unknown
  payload?: unknown
  confidence?: unknown
  source?: unknown
}

const VALID_KINDS = new Set<string>([
  'db_access', 'navigation', 'external_link', 'external_service',
  'api_call', 'event_publish', 'event_listen', 'schedule_trigger',
])

export function buildDocumentFactIndex(input: ServiceMapInputIndex): DocumentFactIndex {
  const anchoredFacts: AnchoredRelationFact[] = []
  const mergeEvidenceFacts: AnchoredRelationFact[] = []
  const unresolvedFacts: UnresolvedServiceMapFact[] = []
  const warnings: ServiceMapWarning[] = []

  // nodeId → entryPointId mapping (from code_bundles)
  const nodeToEntryPoints = buildNodeToEntryPoints(input)

  // entryPointId set for scope_id matching
  const entryPointIds = new Set(input.entryPoints.map((ep) => ep.id))

  for (const doc of input.documents) {
    const facts = extractRelationFacts(doc.content)
    if (facts.length === 0) continue

    for (const rawFact of facts) {
      const factId = nanoid()
      const kind = rawFact.kind

      if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
        warnings.push({ code: 'INVALID_FACT_KIND', message: `Document ${doc.id} has invalid relation fact kind: ${String(kind)}`, documentId: doc.id })
        continue
      }

      const rawSource = typeof rawFact.source === 'string' ? rawFact.source : null

      // source='deterministic': merge evidence only, not doc-only edge
      if (rawSource === 'deterministic') {
        const anchored = tryAnchorFact(factId, rawFact, doc, input, nodeToEntryPoints, entryPointIds)
        if (anchored) mergeEvidenceFacts.push({ ...anchored, source: 'doc_llm' })
        continue
      }

      if (rawSource === null || rawSource === undefined) {
        warnings.push({
          code: 'FACT_MISSING_SOURCE',
          message: `Document ${doc.id} has relation fact with no source field — treating as llm`,
          documentId: doc.id,
        })
      }

      const anchored = tryAnchorFact(factId, rawFact, doc, input, nodeToEntryPoints, entryPointIds)

      if (!anchored) {
        unresolvedFacts.push({
          factId,
          kind: kind as RelationFactKind,
          documentId: doc.id,
          reason: 'no_resolvable_entry_point',
        })
        warnings.push({
          code: 'DOC_FACT_NO_ENTRY_POINT',
          message: `Document ${doc.id} relation fact has no resolvable source entry_point`,
          documentId: doc.id,
          factId,
        })
        continue
      }

      // source='merged': if same deterministic edge found → merge evidence; else doc_llm
      if (rawSource === 'merged') {
        // We can't look up code_relations here without passing them in separately.
        // Treat as doc_llm per spec — the deterministic edge will be anchored separately.
        anchoredFacts.push({ ...anchored, source: 'doc_llm' })
        continue
      }

      anchoredFacts.push(anchored)
    }
  }

  return { anchoredFacts, mergeEvidenceFacts, unresolvedFacts, warnings }
}

function extractRelationFacts(content: Record<string, unknown> | null): RawRelationFact[] {
  if (!content) return []
  const facts = content['relation_facts']
  if (!Array.isArray(facts)) return []
  return facts.filter((f) => typeof f === 'object' && f !== null) as RawRelationFact[]
}

function tryAnchorFact(
  factId: string,
  rawFact: RawRelationFact,
  doc: { id: string; scopeId: string | null },
  input: ServiceMapInputIndex,
  nodeToEntryPoints: Map<string, string[]>,
  entryPointIds: Set<string>,
): AnchoredRelationFact | null {
  const candidates = new Set<string>()

  // Resolution order (F2 spec):
  // 1. fact.relation_id → code_relations → source_node_id → code_bundles → entry_points
  const relationId = typeof rawFact.relation_id === 'string' ? rawFact.relation_id : null
  if (relationId) {
    const rel = input.codeRelations.find((r) => r.id === relationId)
    if (rel) {
      const eps = nodeToEntryPoints.get(rel.sourceNodeId) ?? []
      eps.forEach((ep) => candidates.add(ep))
    }
  }

  // 2. fact.evidence_node_id → code_bundles → entry_points
  const evidenceNodeId = typeof rawFact.evidence_node_id === 'string' ? rawFact.evidence_node_id : null
  if (evidenceNodeId && candidates.size === 0) {
    const eps = nodeToEntryPoints.get(evidenceNodeId) ?? []
    eps.forEach((ep) => candidates.add(ep))
  }

  // 3. documents.scope_id is entry_point.id
  if (candidates.size === 0 && doc.scopeId && entryPointIds.has(doc.scopeId)) {
    candidates.add(doc.scopeId)
  }

  // 4. doc_deps rows → codeNodeId → code_bundles → entry_points
  if (candidates.size === 0) {
    const deps = input.docDeps.filter((d) => d.documentId === doc.id)
    for (const dep of deps) {
      const eps = nodeToEntryPoints.get(dep.codeNodeId) ?? []
      eps.forEach((ep) => candidates.add(ep))
    }
  }

  if (candidates.size === 0) return null

  let resolvedEpId: string
  if (candidates.size === 1) {
    resolvedEpId = [...candidates][0]
  } else {
    // multiple candidates — prefer scope_id match
    if (doc.scopeId && candidates.has(doc.scopeId)) {
      resolvedEpId = doc.scopeId
    } else {
      // prefix proximity
      const winner = resolveByProximity([...candidates], doc.id, input)
      if (!winner) return null
      resolvedEpId = winner
    }
  }

  const rawSource = typeof rawFact.source === 'string' ? rawFact.source : null
  const source = rawSource === 'deterministic' ? 'deterministic' : 'doc_llm'

  return {
    factId,
    sourceEntryPointId: resolvedEpId,
    kind: rawFact.kind as RelationFactKind,
    target: typeof rawFact.target === 'string' ? rawFact.target : null,
    operation: typeof rawFact.operation === 'string' ? rawFact.operation : null,
    canonicalTarget: typeof rawFact.canonical_target === 'string' ? rawFact.canonical_target : null,
    payload: (typeof rawFact.payload === 'object' && rawFact.payload !== null) ? rawFact.payload as Record<string, unknown> : {},
    confidence: normalizeConfidence(rawFact.confidence),
    source,
    relationId: relationId ?? undefined,
    documentId: doc.id,
    evidenceNodeIds: evidenceNodeId ? [evidenceNodeId] : [],
  }
}

function resolveByProximity(
  epIds: string[],
  documentId: string,
  input: ServiceMapInputIndex,
): string | null {
  // Use document id as proxy (no direct file path for docs)
  // Fall back to first if no file paths
  const epMap = new Map(input.entryPoints.map((ep) => [ep.id, ep]))

  const withPaths = epIds
    .map((id) => ({ id, filePath: epMap.get(id)?.filePath ?? '' }))
    .filter((x) => x.filePath)

  if (withPaths.length === 0) return null
  if (withPaths.length === 1) return withPaths[0].id

  // proxy: compare entry point paths against each other using document id segments
  const scores = withPaths.map((x) => ({
    id: x.id,
    score: countSharedPrefixSegments(documentId, x.filePath),
  }))
  const maxScore = Math.max(...scores.map((s) => s.score))
  const winners = scores.filter((s) => s.score === maxScore)
  if (winners.length === 1) return winners[0].id
  return null
}

function buildNodeToEntryPoints(input: ServiceMapInputIndex): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const bundle of input.codeBundles) {
    const existing = map.get(bundle.nodeId) ?? []
    existing.push(bundle.entryPointId)
    map.set(bundle.nodeId, existing)
  }
  return map
}

function normalizeConfidence(raw: unknown): 'high' | 'medium' | 'low' {
  if (raw === 'high') return 'high'
  if (raw === 'medium') return 'medium'
  return 'low'
}
