// common_engine/import_ops — 파서-무관 import_clause 헬퍼 (S2 추출).
// import_clause 의 default / namespace 바인딩 식별자 이름을 뽑는다.
// EngineNode + LanguageSpec(노드타입) 으로 동작 → native/WASM 무관.

import type { EngineNode, LanguageSpec } from './types.js'

/**
 * `import Foo from '...'` 의 default 바인딩 이름.
 * import_clause 의 직속 children 중 첫 identifier 텍스트를 반환 (없으면 null).
 */
export function getDefaultImport(importClause: EngineNode, spec: LanguageSpec): string | null {
  const first = importClause.children.find(
    (c): c is EngineNode => c !== null && c.type === spec.identifierType,
  )
  return first?.text ?? null
}

/**
 * `import * as Foo from '...'` 의 namespace 바인딩 이름.
 * import_clause → namespace_import → identifier 텍스트를 반환 (없으면 null).
 */
export function getNamespaceImport(importClause: EngineNode, spec: LanguageSpec): string | null {
  const ns = importClause.children.find(
    (c): c is EngineNode => c !== null && c.type === spec.namespaceImportType,
  )
  if (!ns) return null
  const id = ns.children.find(
    (c): c is EngineNode => c !== null && c.type === spec.identifierType,
  )
  return id?.text ?? null
}
