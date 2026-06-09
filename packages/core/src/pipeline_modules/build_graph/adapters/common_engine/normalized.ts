// common_engine/normalized — 언어-무관 seam: per-language grammar 훅의 "정규화 리턴 shape".
// SOT: specs/build_graph/normalized-extraction-design.md §1.2 (locked Angle H).
//
// 핵심: 이건 동기 훅 리턴 타입이지 버퍼드 이벤트 스트림/FactIndex 가 아니다.
//   기존 단일-pass 엔진(walk_engine/call_edge_ops/…)이 ctx(WalkEngineCtx)를 통해 인라인 소비한다.
//   (이벤트 버스를 만들면 emit 순서가 바뀌어 TS byte-identity 가 깨진다 — 코드+codegraph 가 확인.)
//
// grammar 레이어(언어별)는 호출/콜백/import/heritage/field-origin 을 이 shape 로 "정규화"만 하고,
//   엔진이 id 포맷·dedup·contains/inverse-calls·resolve_status·payload 를 부여한다 → 언어 간 출력 일관.
// 출력 계약(CodeNodeRaw/CodeEdgeRaw) 아님 → I/O 계약 변경 아님.

import type { EngineNode } from './types.js'

/**
 * call/new 을 grammar 가 정규화한 callee. TS member_expression, Dart selector+argument_part,
 * Go selector_expression 이 모두 이 shape 로 수렴 → 엔진 extractCallEdge 가 소비.
 */
export interface NormalizedCallee {
  shape: 'identifier' | 'member' | 'this_member' | 'super_member' | 'new' | 'subscript'
  /** resolve 용 bare 마지막 세그먼트 (예: Navigator.push 의 'push'). */
  symbol: string
  /** shape=member 일 때 receiver root identifier (예: 'Navigator', 'prisma', 'this'). */
  rootIdentifier: string | null
  /** chain_path 용 멤버 세그먼트 순서 (예: ['db','select','from']). */
  memberChain: string[]
  /** chain_path 재구성용 raw callee text (엔진 extractChainPath 소비). */
  calleeText: string
}

/**
 * grammar 가 인식한 중첩함수/콜백. 엔진이 결정론적 id/role/contains+inverse-calls/signature 부여.
 * grammar 는 위치+이름만 제공. (TS arrow_function 과 Dart function_expression-in-named_argument 통일점.)
 */
export interface NormalizedNestedExec {
  node: EngineNode
  originKind: 'nested_function' | 'callback'
  declaredName: string | null
  /** grammar+framework role 힌트; 엔진 nestedExecutableRole 가 확정/override. */
  roleHint: string | null
}

export interface NormalizedImport {
  specifier: string
  localName: string
  importedName: string | null
  kind: 'named' | 'default' | 'namespace' | 'side_effect'
  isTypeOnly: boolean
}

export interface NormalizedHeritage {
  relation: 'extends' | 'implements' | 'mixes'
  /** CHA/uses_type 해석용 bare 타입 이름. */
  typeText: string
}

/** == 기존 DecoratorInfo (types.ts). 동일 shape, 별칭으로 유지. */
export interface NormalizedDecorator {
  name: string | null
  firstArg: string | null
  literalArgs: string | null
}

/**
 * lexical field-origin 분류(grammar). semantic 타입 해석(import map + CHA)은
 * 엔진 field_origin_ops.resolveTypeOriginWith 가 유지한다.
 */
export interface NormalizedFieldOrigin {
  fieldName: string
  lexicalKind: 'function' | 'primitive' | 'reference' | 'typed' | 'unknown'
  /** lexicalKind='typed' 일 때 type-annotation raw text; 엔진이 FieldOrigin 으로 해석. */
  typeText: string | null
  referenceRoot: string | null    // lexicalKind='reference' (X.Y)
  referenceMember: string | null
}
