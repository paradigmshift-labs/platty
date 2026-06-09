// build_graph: 코드 그래프 구축 — 타입 정의 (V2)
// SOT: specs/build_graph/architecture.md
//
// build_graph parser + graph extraction shared types.
// V2 enum 타입(src/db/schema/enums.ts) 재사용.

import type {
  CodeNodeType,
  EdgeRelation,
  ResolveStatus,
  ParseStatus,
  EdgeConfidence,
  EdgeSource,
  TypeRefSubtype,
} from '@/db/schema/enums.js'

// ── 입력 ──
export interface SourceFile {
  path: string          // repo root 기준 상대 경로
  content: string
  isTest: boolean       // *.spec.ts, *.test.ts, *.e2e-spec.ts (TS), *_test.dart (Dart)
}

// ── code_nodes ──
// re-export로 V2 enum 노출 (V1 호환 — 다른 함수가 CodeNodeType 등을 import)
export type { CodeNodeType, EdgeRelation, ResolveStatus, ParseStatus, EdgeConfidence, EdgeSource, TypeRefSubtype }

export interface CodeNodeRaw {
  id: string
  repo_id: string                       // V1: repo_id
  type: CodeNodeType
  file_path: string
  name: string
  line_start: number | null
  line_end: number | null
  signature: string | null
  parent_node_id?: string | null
  origin_kind?: string | null
  role?: string | null
  exported: boolean
  is_default_export?: boolean            // export default 노드 표시 (default import resolution용). 미지정=false
  parse_status: ParseStatus              // 'ok' | 'failed'
  is_test: boolean
  test_type: 'unit' | 'integration' | 'e2e' | null
  is_async: boolean
  jsdoc: string | null
  leading_comment?: string | null
  normalized_code_hash?: string | null
}

// ── call argument evidence ──
// build_graph가 수집하는 call argument 증거. build_relations에서 앵커 정규화에 사용.
// raw: 원문 그대로. value: string literal 값. staticPattern: template 정규화 (/a/:b).
// identifiers: template expression에서 추출한 identifier 목록.
export type CallArgResolution = 'static' | 'partial' | 'dynamic'

export interface CallArgExpression {
  index: number
  kind:
    | 'string'
    | 'template'
    | 'identifier'
    | 'member'
    | 'call'
    | 'object'
    | 'array'
    | 'unknown'
  raw: string
  value?: string
  staticPattern?: string
  identifiers?: string[]
  elements?: CallArgExpression[]  // kind='array' 전용: 배열 내부 요소
  properties?: Record<string, CallArgExpression>  // kind='object' 전용: 객체 속성 값
  resolved?: CallArgExpression  // identifier/member가 정적으로 풀린 경우의 값
  resolution?: CallArgResolution
}

// ── code_edges ──
// EdgeRelation은 V2 enum (mixes 포함)
// resolve_status는 V2 enum + 'n/a' 호환 (F2 일부 임시 사용)
export interface CodeEdgeRaw {
  repo_id: string                       // V1: repo_id
  source_id: string
  target_id: string | null
  relation: EdgeRelation
  target_specifier: string | null
  target_symbol: string | null
  target_imported_symbol?: string | null
  target_local_symbol?: string | null
  source?: EdgeSource                   // 'static' | 'llm-verified'
  resolve_status: ResolveStatus | 'n/a' // F2 임시 'n/a' 가능
  first_arg?: string | null
  literal_args?: string | null
  arg_expressions?: CallArgExpression[] | null  // E4+ call argument 증거 (additive)
  confidence?: EdgeConfidence | null    // type_resolved 전용
  chain_path?: string | null            // E6 — calls/renders chain root (예: 'prisma.order', 'this.svc')
  type_ref_subtype?: TypeRefSubtype | null  // uses_type 세부 분류 (M7 deterministic 분류용)
  destructured_alias_root?: string | null    // transient F5 hint: const { x } = Root
  destructured_alias_property?: string | null  // transient F5 hint: const { x: y } = Root → x
}

// ── 공유 ──
export type PathAliases = Record<string, string | string[]>

export interface ParseError {
  file: string
  error: string
}

export interface ConstructorParam {
  fieldName: string
  typeName: string
}
export type ConstructorDIMap = Map<string, ConstructorParam[]>

// key: '{repoId}:{filePath}:{EnumName}.{MemberName}' → string literal value
export type EnumValueMap = Map<string, string>

// ── P15-Lite: field origin (receiver type tracking 휴리스틱) ──
export type FieldOrigin =
  | { kind: 'external' }                              // 외부 lib type (import-bound 외부 패키지 / builtin)
  | { kind: 'internal'; typeName: string }            // 우리 graph 안 class type
  | { kind: 'function' }                              // arrow fn / fn literal (chain receiver 아님)
  | { kind: 'primitive' }                             // primitive literal (P13 화이트리스트 영역)
  | { kind: 'reference'; rootName: string; memberName: string }  // RHS=X.Y member access — F5에서 namespace member origin lookup
  | { kind: 'unknown' }                               // 추적 못 함 (보수적)

// classKey: '{repoId}:{filePath}:{ClassOrNamespaceName}' → fieldName → origin
export type FieldOriginsMap = Map<string, Map<string, FieldOrigin>>

// ── 파서 어댑터 인터페이스 ──
export interface ParserAdapter {
  parseFile(content: string, filePath: string, repoId: string): {
    nodes: CodeNodeRaw[]
    edges: CodeEdgeRaw[]
    constructorParams: { className: string; params: ConstructorParam[] }[]
    enumValues: Map<string, string>
    fieldOrigins?: FieldOriginsMap
  } | Promise<{
    nodes: CodeNodeRaw[]
    edges: CodeEdgeRaw[]
    constructorParams: { className: string; params: ConstructorParam[] }[]
    enumValues: Map<string, string>
    fieldOrigins?: FieldOriginsMap
  }>
  supportedExtensions(): string[]
}

// ── F2 출력 ──
export interface ExtractAstResult {
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  parse_errors: ParseError[]
  constructorDIMap: ConstructorDIMap
  enumValueMap: EnumValueMap
  fieldOriginsMap: FieldOriginsMap
}

// V1 호환 alias
export type Pass1Result = ExtractAstResult

// ── F6 출력 ──
export interface UpsertStats {
  nodes_count: number
  edges_count: number
}

// ── F7 출력 ──
export interface ValidationResult {
  valid: boolean
  warnings: string[]
}

// ── 결과 ──
export interface BuildGraphResult {
  files_count: number
  nodes_count: number
  edges_count: number
  parse_errors: ParseError[]
  validation: ValidationResult
  pending_edges: number
}

// ── 진행 로깅 콜백 (V1 RunStepFn 단순화) ──
// V2 orchestrator가 ctx.emit('warning', ...)로 연결. F2/F6은 옵션 콜백으로 받음.
export type RunStepFn = (opts: {
  phase: string
  step: string
  repoId: string
  meta: Record<string, unknown>
}) => void | Promise<void>

// ── 에러 ──
export class BuildGraphError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'REPO_NOT_FOUND'
      | 'REPO_DELETED'
      | 'NOT_ANALYZED'        // analyze_repo confirm 안됨
      | 'BUILD_IN_FLIGHT'     // 동시 실행 충돌
      | 'GRAPH_FAILED',
  ) {
    super(message)
    this.name = 'BuildGraphError'
  }
}

// ── 언어 설정 ──
export interface LanguageConfig {
  glob: string
  testPattern: RegExp
  extraIgnore: string[]
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  typescript: {
    glob: '**/*.{ts,tsx,js,jsx,mdx,vue,svelte,astro}',
    testPattern: /\.(spec|test|e2e-spec)\.(ts|tsx|js|jsx|vue|svelte|astro)$/,
    extraIgnore: [],
  },
  dart: {
    glob: '**/*.dart',
    testPattern: /_test\.dart$/,
    extraIgnore: ['.dart_tool/**', '.pub/**', '.pub-cache/**'],
  },
  java: {
    glob: '**/*.java',
    testPattern: /(Test|IT)\.java$/,
    extraIgnore: [],
  },
  kotlin: {
    glob: '**/*.kt',
    testPattern: /(Test|IT)\.kt$/,
    extraIgnore: [],
  },
}

export function getLanguageConfig(language: string | null): LanguageConfig {
  return LANGUAGE_CONFIGS[language ?? 'typescript'] ?? LANGUAGE_CONFIGS['typescript']
}
