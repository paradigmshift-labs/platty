// common_engine/node_factory_ops — 파서-무관 node factory (walk-engine S1 추출).
// 노드 dedup + export-promotion 병합 + normalized_code_hash 계산. nodes 배열 + sourceLines 만 의존.
// WalkEngine 의 첫 stateful 조각: 어느 언어 어댑터든 같은 dedup/promotion 규칙을 공유한다.

import type { CodeNodeRaw } from '../../types.js'
import { computeNormalizedCodeHash, sliceLinesForHash } from '../../normalized_code_hash.js'

/** node 의 source slice 를 정규화 해시. file/parse-error 노드는 null. */
export function hashNodeSource(sourceLines: string[], node: CodeNodeRaw): string | null {
  if (node.type === 'file' || node.parse_status !== 'ok') return null
  const slice = sliceLinesForHash(sourceLines, node.line_start, node.line_end)
  return slice === null ? null : computeNormalizedCodeHash(slice)
}

/**
 * nodes 배열에 node 추가. 동일 id 가 이미 있으면:
 *  - export-promotion(타입·이름 동일, exported/default 만 다름) → 기존 노드 플래그 병합 후 종료
 *  - 그 외 id 충돌 → 기존 노드 id 에 `:{line_start}` 접미사 부여 + 새 노드도 접미사 붙여 push
 * 없으면 그대로 push. normalized_code_hash 는 미지정 시 hashNodeSource 로 채움.
 * (typescript.ts addNode 에서 verbatim 이동 — 동작/순서 불변.)
 */
export function addNode(nodes: CodeNodeRaw[], node: CodeNodeRaw, sourceLines: string[]): void {
  const nodeWithHash: CodeNodeRaw = {
    ...node,
    normalized_code_hash: node.normalized_code_hash ?? hashNodeSource(sourceLines, node),
  }
  const existingIdx = nodes.findIndex((n) => n.id === nodeWithHash.id)
  if (existingIdx !== -1) {
    const existing = nodes[existingIdx]
    const isExportPromotion =
      existing.type === nodeWithHash.type &&
      existing.name === nodeWithHash.name &&
      (existing.exported !== nodeWithHash.exported || Boolean(nodeWithHash.is_default_export && !existing.is_default_export))
    if (isExportPromotion) {
      nodes[existingIdx] = {
        ...existing,
        exported: existing.exported || nodeWithHash.exported,
        is_default_export: existing.is_default_export || nodeWithHash.is_default_export || undefined,
        signature: existing.signature ?? nodeWithHash.signature,
        jsdoc: existing.jsdoc ?? nodeWithHash.jsdoc,
        leading_comment: existing.leading_comment ?? nodeWithHash.leading_comment,
        normalized_code_hash: existing.normalized_code_hash ?? nodeWithHash.normalized_code_hash,
      }
      return
    }
    if (!existing.id.endsWith(`:${existing.line_start}`)) {
      nodes[existingIdx] = { ...existing, id: `${existing.id}:${existing.line_start}` }
    }
    nodes.push({ ...nodeWithHash, id: `${nodeWithHash.id}:${nodeWithHash.line_start}` })
  } else {
    nodes.push(nodeWithHash)
  }
}
