// dart_hooks/dart_language_spec — Dart 룰북 (LanguageSpec data; C1).
// SOT: specs/build_graph/normalized-extraction-design.md (Phase C).
//
// 전략: TS_LANGUAGE_SPEC 에서 시작해 Dart 문법이 다른 필드만 override.
//   - 소비되는 필드(C2/C3 에서 엔진이 실제로 읽는 것)는 정확히 Dart 노드타입으로 맞추고 게이트로 검증.
//   - 미소비 필드(TS 전용: jsx*/template*/object/pair 등)는 TS 값을 무해하게 상속(Dart 는 안 읽음).
//   - 구조적으로 다른 호출/멤버 grammar(selector 체인)는 spec 이 아니라 normalizeCallee 훅이 처리하므로
//     callType/memberType 등은 best-fit 값일 뿐 dispatch 에 안 쓰인다.
//
// Dart 노드타입 출처: tree-sitter-dart grammar + dart.ts 의 실제 사용(node.type === '...').

import { TS_LANGUAGE_SPEC } from '../common_engine/types.js'
import type { LanguageSpec } from '../common_engine/types.js'

export const DART_LANGUAGE_SPEC: LanguageSpec = {
  ...TS_LANGUAGE_SPEC,

  // ── 리터럴/기본 표현식 (Dart grammar) ──
  identifierType: 'identifier',
  typeIdentifierType: 'type_identifier',
  typeIdentifierTypes: ['type_identifier'],
  stringType: 'string_literal',
  stringFragmentType: 'string_literal',
  numberType: 'numeric_literal',
  trueType: 'true',
  falseType: 'false',
  nullType: 'null_literal',
  arrayType: 'list_literal',
  objectType: 'set_or_map_literal',
  thisType: 'this',
  superType: 'super',

  // ── 함수/콜백 (nested-exec 판정 C3 에서 소비) ──
  // Dart 의 "중첩함수 선언"은 function_signature(+function_body sibling), 콜백은 function_expression.
  functionDeclarationType: 'function_signature',
  arrowFunctionType: 'function_expression',
  nestedExecutableTypes: ['function_expression', 'function_signature'],

  // ── 호출/멤버 (Dart 는 normalizeCallee 훅으로 처리 → 아래 값은 dispatch 미사용 best-fit) ──
  callType: 'method_invocation',
  newType: 'instance_creation_expression',
  memberType: 'selector',
  awaitType: 'await_expression',

  // ── 선언/스코프 ──
  constScopeTypes: ['block', 'program'],
  constDeclTypes: ['local_variable_declaration', 'initialized_variable_definition'],
  exportStatementType: 'import_or_export',
  importStatementType: 'import_or_export',

  // ── async ──
  asyncKeyword: 'async',

  // requiresAsyncInit: Dart 파서는 WASM async 초기화 필요.
  requiresAsyncInit: true,
}
