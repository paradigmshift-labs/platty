// dart_hooks — Dart 노드 헬퍼.
// 주의: findChild는 isNamed 필터가 있어 TS의 findChildOfType(필터 없음)과 의미가 다르다 →
// common_engine으로 공유하지 않고 Dart 전용으로 둔다(byte 동일성 보존). EngineNode로 타입(파서 무관).
import type { EngineNode } from '../common_engine/types.js'

// 제네릭 <N extends EngineNode>로 호출측 노드 타입(web-tree-sitter Node 등)을 투명 보존.

/** 첫 번째 named 직계 자식(type 일치)을 찾는다. */
export function findChild<N extends EngineNode>(node: N, type: string): N | null {
  return (node.children.find((c) => !!c && c.isNamed && c.type === type) as N | undefined) ?? null
}

/** self 포함 첫 descendant(type 일치)를 DFS로 찾는다. */
export function findDescendant<N extends EngineNode>(node: N, type: string): N | null {
  if (node.type === type) return node
  for (const child of node.children) {
    if (!child) continue
    const found = findDescendant(child as N, type)
    if (found) return found
  }
  return null
}

/** Dart string literal 양끝 따옴표 제거 (',"; backtick 없음 — TS와 다름). */
export function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '')
}
