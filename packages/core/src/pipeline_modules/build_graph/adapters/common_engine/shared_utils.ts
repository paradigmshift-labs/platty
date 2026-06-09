// common_engine — 파서-무관 순수 node 헬퍼.
import type { EngineNode, LanguageSpec } from './types.js'

/**
 * WASM-safe 노드 동일성 판정.
 *
 * native tree-sitter는 노드 wrapper 참조가 안정적이라 `a === b`로 동일성을 비교할 수 있지만,
 * web-tree-sitter(WASM)는 accessor(.parent/.childForFieldName/.child 등) 호출마다 **새 JS wrapper**를
 * 생성해 같은 underlying 노드라도 `===`가 false가 된다. span(startIndex/endIndex)+type로 판정하면
 * native·WASM 양쪽에서 동일하게 동작한다(native에서도 같은 노드 = 같은 span+type → 결과 불변).
 */
export function sameNode(a: EngineNode | null | undefined, b: EngineNode | null | undefined): boolean {
  return !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type
}

/**
 * 서브트리에서 identifier·type_identifier 텍스트를 재귀 수집 (GAP-7: heritage_ops + decorator_type_fn_ops
 * 의 두 동일 사본을 통합). null-child guard + falsy-text guard (identifier/type_identifier 는 zero-width 가
 * 아니라 text 항상 non-empty → 가드는 no-op, 두 사본과 byte-identical).
 */
export function collectTypeIdentifiers(node: EngineNode, out: Set<string>, spec: LanguageSpec): void {
  if (node.type === spec.typeIdentifierType || node.type === spec.identifierType) {
    if (node.text) out.add(node.text)
  }
  for (const child of node.children) {
    if (!child) continue
    collectTypeIdentifiers(child, out, spec)
  }
}

// node 직속 children 에서 type 과 일치하는 첫 자식 (null-child guard). (A-2/A-6 통합)
// generic N: TS(Parser.SyntaxNode)·Dart/JVM(SNode)·engine(EngineNode) 호출부가 각자 노드타입 반환을 유지.
export function firstChildOfType<N extends EngineNode>(node: N, type: string): N | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.type === type) return child as N
  }
  return null
}

/** 앞뒤 따옴표(' " `) 제거. (A-1 통합) */
export function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '')
}

/** span(startIndex/endIndex)만 비교하는 노드 동일성 — sameNode 와 달리 type 은 안 봄. null-safe. (A-4 통합) */
export function sameSpan(a: EngineNode | null | undefined, b: EngineNode | null | undefined): boolean {
  return !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex
}

/** node.parent 체인을 올라가며 predicate 충족 첫 조상 반환. (A-3 통합) */
export function findAncestor<N extends EngineNode>(node: N, predicate: (candidate: N) => boolean): N | null {
  let current = node.parent as N | null
  while (current) {
    if (predicate(current)) return current
    current = current.parent as N | null
  }
  return null
}
