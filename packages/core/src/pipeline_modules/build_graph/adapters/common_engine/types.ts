// common_engine — 파서-무관 공통 엔진 타입
// SOT: specs/build_graph/specs/common_engine.md
//
// EngineNode: native tree-sitter SyntaxNode 와 web-tree-sitter Node 가 둘 다 구조적으로 만족하는 최소 계약.
// 따라서 공통 엔진 코드는 native/WASM 무관하게 동일하다 (Parser 주입).

export interface EngineNode {
  type: string
  text: string
  startIndex: number
  endIndex: number
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  childCount: number
  namedChildCount: number
  child(index: number): EngineNode | null
  namedChild(index: number): EngineNode | null
  children: (EngineNode | null)[]
  namedChildren: (EngineNode | null)[]
  childForFieldName(field: string): EngineNode | null
  parent: EngineNode | null
  firstChild: EngineNode | null
  isNamed: boolean
}

// 데코레이터/어노테이션 추출 결과 (TS decorator hook / Dart annotation hook 공유 shape).
export interface DecoratorInfo {
  name: string | null
  firstArg: string | null
  literalArgs: string | null
}

// ── LanguageSpec: 언어별 노드타입/필드명 단어장 + 한계 상수 ──
// 하드코딩 문자열을 이 값으로 치환한다. TS 값은 tree-sitter-typescript v0.23 grammar 기준.
export interface LanguageSpec {
  // 호출/표현식
  callType: string // 'call_expression'
  newType: string // 'new_expression'
  memberType: string // 'member_expression'
  awaitType: string // 'await_expression'
  thisType: string // 'this'
  superType: string // 'super'
  identifierType: string // 'identifier'
  propertyIdentifierType: string // 'property_identifier'
  shorthandPropertyType: string // 'shorthand_property_identifier'
  computedPropertyType: string // 'computed_property_name'
  // 리터럴
  stringType: string // 'string' (buildArgExpression string-kind은 이것만)
  stringFragmentType: string // 'string_fragment' (extractLiteralValue는 string|string_fragment 둘 다)
  numberType: string // 'number'
  trueType: string // 'true'
  falseType: string // 'false'
  nullType: string // 'null'
  objectType: string // 'object'
  pairType: string // 'pair'
  arrayType: string // 'array'
  spreadType: string // 'spread_element'
  templateType: string // 'template_string'
  templateSubType: string // 'template_substitution'
  // const scope 탐색
  constScopeTypes: readonly string[] // ['statement_block','program']
  constDeclTypes: readonly string[] // ['lexical_declaration','variable_declaration']
  declaratorType: string // 'variable_declarator'
  exportStatementType: string // 'export_statement'
  // 필드명 (childForFieldName)
  nameField: string // 'name'
  bodyField: string // 'body'
  paramsField: string // 'parameters'
  valueField: string // 'value'
  functionField: string // 'function'
  argumentsField: string // 'arguments'
  constructorField: string // 'constructor'
  objectField: string // 'object'
  propertyField: string // 'property'
  keyField: string // 'key'
  // 어휘 토큰 (punctuation) — call/literal walk에서 필터링에 쓰임
  openParen: string // '('
  closeParen: string // ')'
  comma: string // ','
  // call 인자 래퍼 노드타입(있으면 extractCallArgs 가 unwrap). Kotlin=value_arguments>value_argument>expr.
  // TS/Java 는 인자가 직접 표현식이라 미설정(undefined) → unwrap 스킵(byte-identical).
  argumentWrapperType?: string // Kotlin: 'value_argument'
  openBracket: string // '['
  closeBracket: string // ']'
  backtick: string // '`'
  templateOpen: string // '${'
  templateClose: string // '}'
  // S2 추출 단어장 (import/decl/type/render)
  namespaceImportType: string // 'namespace_import'
  importStatementType: string // 'import_statement'
  typeIdentifierType: string // 'type_identifier'
  typeIdentifierTypes: readonly string[] // ['type_identifier','predefined_type']
  nestedExecutableTypes: readonly string[] // ['arrow_function','function_expression','function_declaration']
  semanticRenderElements: readonly string[] // ['a','area','form']
  // S3 추출 단어장 (modifiers / patterns / signature)
  objectPatternType: string // 'object_pattern'
  arrayPatternType: string // 'array_pattern'
  pairPatternType: string // 'pair_pattern'
  shorthandPropertyPatternType: string // 'shorthand_property_identifier_pattern'
  formalParamsType: string // 'formal_parameters'
  returnTypeField: string // 'return_type'
  typeAnnotationType: string // 'type_annotation'
  asyncKeyword: string // 'async'
  accessibilityModifierType: string // 'accessibility_modifier'
  accessibilityModifiers: readonly string[] // ['private','protected','public']
  accessibilityDefault: string // 'public'
  // S3 추출 단어장 (heritage / browser-location)
  classHeritageType: string // 'class_heritage'
  extendsClauseType: string // 'extends_clause'
  implementsClauseType: string // 'implements_clause'
  genericType: string // 'generic_type'
  implementsKeyword: string // 'implements'
  leftField: string // 'left'
  rightField: string // 'right'
  browserLocationHrefProp: string // 'href'
  browserLocationChains: readonly string[] // ['window.location','location']
  browserLocationAssignSymbol: string // 'assign'
  // S4 추출 단어장
  arrowFunctionType: string // 'arrow_function'
  requireFunctionName: string // 'require' (CJS require import 식별)
  // nested-executable role 분류 단어장 (computeCallbackRole hook)
  functionDeclarationType: string // 'function_declaration'
  returnStatementType: string // 'return_statement'
  assignmentExpressionType: string // 'assignment_expression'
  parenthesizedExpressionType: string // 'parenthesized_expression'
  // value-identity wrapper (transparent receiver unwrap). 언어에 없으면 생략(optional) → unwrap no-op.
  nonNullExpressionType?: string // 'non_null_expression' (TS only: `x!`)
  jsxAttributeType: string // 'jsx_attribute'
  jsxExpressionType: string // 'jsx_expression'
  // call-edge shape 단어장 (extractCallEdge cluster)
  statementBlockType: string // 'statement_block' (함수 스코프 alias 탐색)
  subscriptType: string // 'subscript_expression'
  importExpressionType: string // 'import' (dynamic import callee)
  // S5 추출 단어장 (field-origin)
  functionOriginTypes: readonly string[] // ['arrow_function','function_expression','function'] → origin 'function'
  primitiveOriginTypes: readonly string[] // number/string/true/false/null/undefined/template_string/array/object → 'primitive'
  // 플래그
  requiresAsyncInit: boolean
}

// tree-sitter-typescript v0.23 단어장.
export const TS_LANGUAGE_SPEC: LanguageSpec = {
  callType: 'call_expression',
  newType: 'new_expression',
  memberType: 'member_expression',
  awaitType: 'await_expression',
  thisType: 'this',
  superType: 'super',
  identifierType: 'identifier',
  propertyIdentifierType: 'property_identifier',
  shorthandPropertyType: 'shorthand_property_identifier',
  computedPropertyType: 'computed_property_name',
  stringType: 'string',
  stringFragmentType: 'string_fragment',
  numberType: 'number',
  trueType: 'true',
  falseType: 'false',
  nullType: 'null',
  objectType: 'object',
  pairType: 'pair',
  arrayType: 'array',
  spreadType: 'spread_element',
  templateType: 'template_string',
  templateSubType: 'template_substitution',
  constScopeTypes: ['statement_block', 'program'],
  constDeclTypes: ['lexical_declaration', 'variable_declaration'],
  declaratorType: 'variable_declarator',
  exportStatementType: 'export_statement',
  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',
  valueField: 'value',
  functionField: 'function',
  argumentsField: 'arguments',
  constructorField: 'constructor',
  objectField: 'object',
  propertyField: 'property',
  keyField: 'key',
  openParen: '(',
  closeParen: ')',
  comma: ',',
  openBracket: '[',
  closeBracket: ']',
  backtick: '`',
  templateOpen: '${',
  templateClose: '}',
  namespaceImportType: 'namespace_import',
  importStatementType: 'import_statement',
  typeIdentifierType: 'type_identifier',
  typeIdentifierTypes: ['type_identifier', 'predefined_type'],
  nestedExecutableTypes: ['arrow_function', 'function_expression', 'function_declaration'],
  semanticRenderElements: ['a', 'area', 'form'],
  objectPatternType: 'object_pattern',
  arrayPatternType: 'array_pattern',
  pairPatternType: 'pair_pattern',
  shorthandPropertyPatternType: 'shorthand_property_identifier_pattern',
  formalParamsType: 'formal_parameters',
  returnTypeField: 'return_type',
  typeAnnotationType: 'type_annotation',
  asyncKeyword: 'async',
  accessibilityModifierType: 'accessibility_modifier',
  accessibilityModifiers: ['private', 'protected', 'public'],
  accessibilityDefault: 'public',
  classHeritageType: 'class_heritage',
  extendsClauseType: 'extends_clause',
  implementsClauseType: 'implements_clause',
  genericType: 'generic_type',
  implementsKeyword: 'implements',
  leftField: 'left',
  rightField: 'right',
  browserLocationHrefProp: 'href',
  browserLocationChains: ['window.location', 'location'],
  browserLocationAssignSymbol: 'assign',
  arrowFunctionType: 'arrow_function',
  requireFunctionName: 'require',
  functionDeclarationType: 'function_declaration',
  returnStatementType: 'return_statement',
  assignmentExpressionType: 'assignment_expression',
  parenthesizedExpressionType: 'parenthesized_expression',
  nonNullExpressionType: 'non_null_expression',
  jsxAttributeType: 'jsx_attribute',
  jsxExpressionType: 'jsx_expression',
  statementBlockType: 'statement_block',
  subscriptType: 'subscript_expression',
  importExpressionType: 'import',
  functionOriginTypes: ['arrow_function', 'function_expression', 'function'],
  primitiveOriginTypes: ['number', 'string', 'true', 'false', 'null', 'undefined', 'template_string', 'array', 'object'],
  requiresAsyncInit: false,
}
