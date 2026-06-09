/**
 * V2 공유 enum 상수.
 *
 * Drizzle SQLite의 text({ enum: ... })는 TS 타입만 강제하고 SQLite는 자유 text.
 * 즉 enum 확장은 schema 마이그레이션 없이 TS 코드만 변경.
 */

// ────────────────────────────────────────
// Lifecycle (실행 단위 상태)
// ────────────────────────────────────────
export const lifecycleEnum = ['queued', 'running', 'done', 'failed', 'cancelled', 'waiting_for_user'] as const
export type Lifecycle = (typeof lifecycleEnum)[number]

// ────────────────────────────────────────
// Pipeline run kind — 어떤 종류의 작업을 실행 중인가
// CLAUDE.md 모듈명 표와 1:1 일치 (단일 진실 출처)
// ────────────────────────────────────────
export const runKindEnum = [
  'analyze_project',       // project-level orchestration through service map preview
  'analyze_repo',          // P1 — repo 메타 분석
  'build_models',          // P2 — ORM 모델 추출
  'build_graph',           // P3 — 코드 그래프
  'build_node_summaries',  // 코드 그래프 노드 요약
  'build_pattern_profile', // P3.5 — deterministic pattern profile 생성
  'build_route',           // P4 — route 추출
  'build_relations',       // route/code relation 추출
  'build_docs',            // P5 — 기술 문서 추출
  'build_service_map',     // service map edge 생성
  'build_epics',           // P6 — EPIC 분류
  'build_business_docs',   // P6+ — 비즈니스 문서 생성 (design/dd/br/ucl/ucs/glossary)
  'build_design',          // P7 — design.md
  'build_ucl',             // P8-1 — UCL
  'build_ucs',             // P8-2 — UCS
  'sync',                  // 증분 업데이트
  'full_pipeline',         // 전체 파이프라인 한 번에
] as const
export type RunKind = (typeof runKindEnum)[number]

// ────────────────────────────────────────
// LLM provider (P12 — pipeline_steps 자동 기록)
// ────────────────────────────────────────
export const llmProviderEnum = [
  'claude_code',
  'codex_sdk',
  'codex_cli',
  'antigravity_cli',
  'claude_api',
  'openai_api',
  'gemini_api',
  'gemini_cli',
] as const
export type LlmProvider = (typeof llmProviderEnum)[number]

// ────────────────────────────────────────
// Pipeline event kind
// ────────────────────────────────────────
export const eventKindEnum = ['progress', 'log', 'warning', 'milestone', 'requires_user_action', 'resumed'] as const
export type EventKind = (typeof eventKindEnum)[number]

// ────────────────────────────────────────
// Triggered by — pipeline_runs.triggered_by
// ────────────────────────────────────────
export const triggeredByEnum = ['user', 'system', 'sync_auto'] as const
export type TriggeredBy = (typeof triggeredByEnum)[number]

// ────────────────────────────────────────
// Repository 분류 (M2 analyze_repo F2a)
// ────────────────────────────────────────
export const repoTypeEnum = ['backend', 'frontend', 'fullstack', 'mobile'] as const
export type RepoType = (typeof repoTypeEnum)[number]

export const repoLanguageEnum = ['typescript', 'javascript', 'dart', 'java', 'kotlin', 'other'] as const
export type RepoLanguage = (typeof repoLanguageEnum)[number]

export const frameworkEnum = [
  // backend
  'nestjs',
  'nextjs',
  'nuxt',
  'sveltekit',
  'astro',
  'express',
  'fastify',
  'koa',
  'hono',
  'elysia',
  'spring',
  // frontend
  'react',
  'vue',
  'svelte',
  // mobile
  'flutter',
  // fallback
  'other',
] as const
export type Framework = (typeof frameworkEnum)[number]

// ────────────────────────────────────────
// 산출물 lifecycle validity (산출물 중심 모델 — spec §11)
// ────────────────────────────────────────
export const validityEnum = ['fresh', 'stale', 'orphaned'] as const
export type Validity = (typeof validityEnum)[number]

// ────────────────────────────────────────
// 코드 그래프 (M3 build_graph)
// ────────────────────────────────────────
export const codeNodeTypeEnum = [
  'file',
  // 범용
  'function',
  'class',
  'method',
  'property',     // E7 — class field/property (TypeORM @Column / Swagger @ApiProperty 등)
  'interface',
  'variable',
  'enum',
  // TS 전용
  'type',
  'namespace',
  // Dart 전용
  'mixin',
  'extension',
] as const
export type CodeNodeType = (typeof codeNodeTypeEnum)[number]

export const edgeRelationEnum = [
  'imports',
  're_exports',
  're_exports_ns',
  'contains',
  'calls',
  'extends',
  'implements',
  'mixes',           // Dart mixin with
  'uses_type',
  'decorates',
  'type_ref',        // 시그니처 타입 참조 (constructor_param/method_param/return_type/generic_arg)
  'type_resolved',   // CHA 단계 추가
  'depends_on',      // decorator 객체 인자 분해 (예: @Module({providers:[X,Y]}) → X/Y에 depends_on)
  'renders',         // E5 — JSX 컴포넌트 사용 (<Foo /> → renders edge)
  'resolves_to',     // def-use: this.<field> receiver → field declaration node (LSP-style symbol link)
] as const
export type EdgeRelation = (typeof edgeRelationEnum)[number]

export const resolveStatusEnum = ['pending', 'resolved', 'external', 'external_chain', 'failed'] as const
export type ResolveStatus = (typeof resolveStatusEnum)[number]

export const parseStatusEnum = ['ok', 'failed'] as const
export type ParseStatus = (typeof parseStatusEnum)[number]

export const edgeConfidenceEnum = ['high', 'low'] as const
export type EdgeConfidence = (typeof edgeConfidenceEnum)[number]

export const edgeSourceEnum = ['static', 'llm-verified'] as const
export type EdgeSource = (typeof edgeSourceEnum)[number]

// ────────────────────────────────────────
// Build route (M6 build_route)
// ────────────────────────────────────────
export const entryPointKindEnum = ['api', 'page', 'job', 'event'] as const
export type EntryPointKind = (typeof entryPointKindEnum)[number]

export const confidenceEnum = ['high', 'medium', 'low'] as const
export type Confidence = (typeof confidenceEnum)[number]

export const truncatedByEnum = ['node_count', 'depth', 'fan_out'] as const
export type TruncatedBy = (typeof truncatedByEnum)[number]

export const detectedViaEnum = ['manifest', 'imports', 'pattern'] as const
export type DetectedVia = (typeof detectedViaEnum)[number]

export const typeRefSubtypeEnum = [
  'import',             // a3 — import type { X }
  'generic_arg',        // a5 heritage / 다른 곳의 제네릭 인자
  'constructor_param',  // a5 — constructor(parameter property) 타입
  'method_param',       // a5 — method 인자 타입
  'return_type',        // a5 — method return 타입
  'field_type',         // a5 — class field/property 타입
  'decorator_type_fn',  // A2-1 — @Resolver(() => User) 같이 데코레이터 인자가 화살표 함수일 때 body 안 type
] as const
export type TypeRefSubtype = (typeof typeRefSubtypeEnum)[number]
