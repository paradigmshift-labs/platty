// common_engine/node_ops — 파서-무관 노드 id + identifier 수집 + nested-exec/leaf 헬퍼 (S1/S2 추출).
// 언어 어댑터는 (repoId, filePath) 또는 EngineNode+LanguageSpec 을 넘겨 호출한다.

import type { EngineNode, LanguageSpec } from './types.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorParam, FieldOriginsMap } from '../../types.js'
import { MAX_STRING_LENGTH } from './call_extractor.js'

/** 심볼 노드 id: `{repoId}:{filePath}:{name}` (메서드=`{Class}.{method}`, namespace=`{NS}.{Member}`). */
export function nodeId(repoId: string, filePath: string, name: string): string {
  return `${repoId}:${filePath}:${name}`
}

/** file 노드 id: `{repoId}:{filePath}`. */
export function fileNodeId(repoId: string, filePath: string): string {
  return `${repoId}:${filePath}`
}

// ── identifier 수집 (import 문 제외) — S2 추출 ──
// 파서-무관 재귀 walk. node.children null guard (WASM/Phase B 안전, native는 no-op).

/** node 서브트리에서 identifier·type_identifier 텍스트를 재귀 수집해 set에 누적한다. */
export function collectIdentifiersInNode(
  node: EngineNode,
  identifiers: Set<string>,
  spec: LanguageSpec,
): void {
  if (node.type === spec.identifierType || node.type === spec.typeIdentifierType) {
    const text = node.text
    if (text) identifiers.add(text)
  }
  for (const child of node.children) {
    if (!child) continue
    collectIdentifiersInNode(child, identifiers, spec)
  }
}

/** root 직속 children을 순회하되 import_statement는 건너뛰고 나머지에서 identifier를 수집한다. */
export function collectAllIdentifiers(
  root: EngineNode,
  identifiers: Set<string>,
  spec: LanguageSpec,
): void {
  for (const child of root.children) {
    if (!child) continue
    if (child.type === spec.importStatementType) continue
    collectIdentifiersInNode(child, identifiers, spec)
  }
}

// ── nested-executable 헬퍼 (S2 추출) ──

/** arrow_function / function_expression / function_declaration (= spec.nestedExecutableTypes) 인지. */
export function isNestedExecutableNode(node: EngineNode, spec: LanguageSpec): boolean {
  return spec.nestedExecutableTypes.includes(node.type)
}

/** 중첩 실행체 표시 이름: parent name 있으면 `{parent}.{local}`, 없으면 local. (어댑터가 parentName 조회해 넘김) */
export function nestedExecutableName(
  parentName: string | null | undefined,
  localName: string,
): string {
  return parentName ? `${parentName}.${localName}` : localName
}

// ── leaf 헬퍼 (S2 추출) ──

/** 빈 FileParseResult shape (파싱 실패 fallback). 매 호출 새 빈 컬렉션. */
export function emptyFallbackParseResult(): {
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  constructorParams: { className: string; params: ConstructorParam[] }[]
  enumValues: Map<string, string>
  fieldOrigins: FieldOriginsMap
} {
  return {
    nodes: [],
    edges: [],
    constructorParams: [],
    enumValues: new Map(),
    fieldOrigins: new Map(),
  }
}

/** callee 노드에서 호출 대상 이름: identifier→text, member_expression→property text, 그 외 null. */
export function callTargetName(fn: EngineNode, spec: LanguageSpec): string | null {
  if (fn.type === spec.identifierType) return fn.text
  if (fn.type === spec.memberType) {
    const prop = fn.childForFieldName(spec.propertyField)
    return prop?.text ?? null
  }
  return null
}

/**
 * 정적으로 읽어낼 수 있는 표현식 텍스트 추출 (JSX 속성/인자 등).
 * string/string_fragment 는 quote 벗기고 NUL·과길이 가드, identifier/member/template 은 text,
 * call_expression 은 첫 인자로 재귀 하강. 그 외 → null.
 */
export function extractStaticishExpressionText(node: EngineNode, spec: LanguageSpec): string | null {
  if (node.type === spec.stringType || node.type === spec.stringFragmentType) {
    const stripped = node.text.replace(/^['"`]|['"`]$/g, '')
    // eslint-disable-next-line no-control-regex
    return /\x00/.test(stripped) || stripped.length > MAX_STRING_LENGTH ? null : stripped
  }
  if (node.type === spec.identifierType || node.type === spec.memberType) return node.text
  if (node.type === spec.templateType) return node.text
  if (node.type === spec.callType) {
    const argsNode = node.childForFieldName(spec.argumentsField) ??
      node.children.find((child) => child?.type === spec.argumentsField)
    if (!argsNode) return null
    const argNode = argsNode.children.find(
      (child) => child != null && child.type !== spec.openParen && child.type !== spec.closeParen && child.type !== spec.comma,
    )
    return argNode ? extractStaticishExpressionText(argNode, spec) : null
  }
  return null
}

// ── modifiers (S3 추출) ──

/** node의 직속 children 중 'async' 토큰(타입 또는 텍스트)이 있으면 true. (null-child guard) */
export function isAsyncNode(node: EngineNode, spec: LanguageSpec): boolean {
  for (const child of node.children) {
    if (!child) continue
    if (child.type === spec.asyncKeyword || child.text === spec.asyncKeyword) return true
  }
  return false
}

/**
 * 클래스 멤버 접근 제어자 텍스트. children 중 accessibilityModifierType 노드 또는
 * accessibilityModifiers 키워드 텍스트가 있으면 그 text, 없으면 spec.accessibilityDefault('public').
 */
export function getAccessibility(node: EngineNode, spec: LanguageSpec): string {
  for (const child of node.children) {
    if (!child) continue
    if (child.type === spec.accessibilityModifierType || spec.accessibilityModifiers.includes(child.text)) {
      return child.text
    }
  }
  return spec.accessibilityDefault
}

/** destructuring pattern(object_pattern/array_pattern)에서 바인딩 식별자 텍스트를 재귀 수집한다. (null-child guard) */
export function collectDestructuringBindings(pattern: EngineNode, spec: LanguageSpec): string[] {
  const names: string[] = []
  for (const child of pattern.children) {
    if (!child) continue
    if (child.type === spec.identifierType) {
      names.push(child.text)
    } else if (child.type === spec.shorthandPropertyPatternType) {
      names.push(child.text)
    } else if (child.type === spec.pairPatternType) {
      const val = child.childForFieldName(spec.valueField)
      if (val?.type === spec.identifierType) names.push(val.text)
    } else if (child.type === spec.objectPatternType || child.type === spec.arrayPatternType) {
      names.push(...collectDestructuringBindings(child, spec))
    }
  }
  return names
}
