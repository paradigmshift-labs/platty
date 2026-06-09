// common_engine/browser_location_ops — 파서-무관 browser location-assignment edge 빌더 (S3 추출).
// window.location.href = "..." (또는 location.href = ...) 할당 → calls(assign) edge.
// 하드코딩 노드타입/필드명/DOM-semantic 상수는 LanguageSpec 값으로 치환. canonical-동일.

import type { CodeEdgeRaw } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import { makeEdge } from './edge_ops.js'
import { extractChainPath } from './chain_extractor.js'
import { MAX_STRING_LENGTH } from './call_extractor.js'

/** 할당 우변에서 정적으로 읽어낼 first_arg: string/template은 quote 벗기고 ${} 보간·과길이 가드, identifier/member는 text, 그 외 null. */
export function extractAssignmentFirstArg(node: EngineNode, spec: LanguageSpec): string | null {
  if (node.type === spec.stringType || node.type === spec.templateType) {
    const raw = node.text.replace(/^['"`]|['"`]$/g, '')
    if (!raw.includes('${') && raw.length <= MAX_STRING_LENGTH) return raw
  }
  if (node.type === spec.identifierType || node.type === spec.memberType) return node.text
  return null
}

/**
 * `window.location.href = ...` / `location.href = ...` 할당을 calls(assign) edge로.
 * left가 .href member(on window.location|location)이고 right가 정적으로 읽힐 때만 발화.
 */
export function extractBrowserLocationAssignmentEdge(
  node: EngineNode,
  spec: LanguageSpec,
  repoId: string,
  sourceId: string,
  out: CodeEdgeRaw[],
): void {
  const left = node.childForFieldName(spec.leftField) ?? node.namedChildren[0]
  const right = node.childForFieldName(spec.rightField) ?? node.namedChildren[1]
  if (!left || !right || left.type !== spec.memberType) return

  const prop = left.childForFieldName(spec.propertyField)
  const obj = left.childForFieldName(spec.objectField)
  if (prop?.text !== spec.browserLocationHrefProp || !obj) return

  const chainPath = extractChainPath(obj)
  if (!chainPath || !spec.browserLocationChains.includes(chainPath)) return

  const firstArg = extractAssignmentFirstArg(right, spec)
  if (!firstArg) return

  let literalArgs: string | null = null
  try {
    literalArgs = JSON.stringify([firstArg])
  } catch {
    literalArgs = null
  }

  out.push(makeEdge(repoId, {
    source_id: sourceId,
    target_id: null,
    relation: 'calls',
    target_specifier: null,
    target_symbol: spec.browserLocationAssignSymbol,
    resolve_status: 'pending',
    first_arg: firstArg,
    literal_args: literalArgs,
    chain_path: chainPath,
  }))
}
