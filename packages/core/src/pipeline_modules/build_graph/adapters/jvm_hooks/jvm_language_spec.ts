// jvm_hooks/jvm_language_spec — JVM (Java/Kotlin) 룰북 (LanguageSpec data; P5).
// SOT: specs/build_graph/adapter-authoring-guide.md §0 + specs/build_graph/codegraph-unification-plan.md.
//
// 전략(dart_language_spec.ts 와 동일): TS_LANGUAGE_SPEC 에서 시작해 JVM 문법이 다른 필드만 override.
//   - 소비되는 필드(call/nested-exec/decl/literal)는 정확히 tree-sitter-java/kotlin 노드타입으로 맞춤.
//   - 미소비 TS 전용 필드(jsx*/template*/object/pair/namespace_import 등)는 TS 값을 무해 상속 (JVM 은 안 읽음).
//   - Java 호출은 method_invocation(object+name 필드)이라 TS 의 function-field 모양과 달라
//     → jvm_hooks 의 normalizeCallee 가 처리 (emitNormalizedCallEdge 경로; callType 은 dispatch 용).
//
// AST 출처: tree-sitter-java.wasm / tree-sitter-kotlin.wasm 실제 덤프 (P5 AST 분석).

import { TS_LANGUAGE_SPEC } from '../common_engine/types.js'
import type { LanguageSpec } from '../common_engine/types.js'

// ── Java ──
export const JAVA_LANGUAGE_SPEC: LanguageSpec = {
  ...TS_LANGUAGE_SPEC,

  // 호출/표현식 (Java)
  callType: 'method_invocation', // object?+name+arguments (normalizeCallee 훅이 정규화)
  newType: 'object_creation_expression',
  memberType: 'field_access',
  identifierType: 'identifier',

  // 리터럴 (Java)
  stringType: 'string_literal',
  stringFragmentType: 'string_literal',
  numberType: 'decimal_integer_literal',
  trueType: 'true',
  falseType: 'false',
  nullType: 'null_literal',
  arrayType: 'array_initializer',

  // 타입
  typeIdentifierType: 'type_identifier',
  typeIdentifierTypes: ['type_identifier'],

  // 함수/콜백 (Java): 메서드 선언 = method_declaration, 람다 = lambda_expression
  functionDeclarationType: 'method_declaration',
  arrowFunctionType: 'lambda_expression',
  nestedExecutableTypes: ['lambda_expression'],

  // 선언/스코프 (Java)
  constScopeTypes: ['block', 'program'],
  constDeclTypes: ['local_variable_declaration', 'field_declaration'],
  declaratorType: 'variable_declarator',
  formalParamsType: 'formal_parameters',
  importStatementType: 'import_declaration',
  // Java 엔 export_statement 가 없음 → TS 값 무해 상속(매칭 안 됨).

  // 접근제어 (Java: public/private/protected 는 'modifiers' 안의 토큰)
  accessibilityModifiers: ['private', 'protected', 'public'],
  accessibilityDefault: 'public', // Java package-private 이지만 그래프상 기본 노출 정책 유지

  requiresAsyncInit: true, // WASM
}

// ── Kotlin ──
// 주의(P4 확인): Kotlin class_declaration 은 name 필드가 없고 자식 identifier 가 이름
//   → jvm_hooks 의 resolveName 훅이 흡수. root = source_file.
export const KOTLIN_LANGUAGE_SPEC: LanguageSpec = {
  ...JAVA_LANGUAGE_SPEC,

  // Kotlin 호출/리터럴 (예비 — Kotlin 단계에서 AST 덤프로 확정)
  callType: 'call_expression',
  newType: 'call_expression', // Kotlin 은 생성자도 call_expression (new 키워드 없음)
  identifierType: 'simple_identifier',
  stringType: 'string_literal',

  // 함수/콜백 (Kotlin)
  functionDeclarationType: 'function_declaration',
  arrowFunctionType: 'lambda_literal',
  nestedExecutableTypes: ['lambda_literal', 'anonymous_function'],

  // 선언
  constDeclTypes: ['property_declaration'],
  importStatementType: 'import_header',

  // Kotlin call 인자는 value_arguments > value_argument > expr (래퍼 한 겹) → extractCallArgs unwrap
  argumentWrapperType: 'value_argument',

  requiresAsyncInit: true,
}
