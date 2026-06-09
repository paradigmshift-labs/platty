import type { SchemaSource } from '@/db/schema/json_types/schema_source.js'

export type { SchemaSource }

// ── 파싱 전략 ─────────────────────────────────────────────

export type BuildModelsStrategy = 'dsl-parse' | 'graph-query'

// ── 도메인 타입 ───────────────────────────────────────────

export interface ModelField {
  name: string
  comment?: string
  type: string           // 'String' | 'Int' | 'Boolean' | 'DateTime' | ...
  nullable: boolean
  default?: string
  primary: boolean
  unique: boolean
  line: number
}

export interface ModelRelation {
  name: string
  target_model: string
  type: 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany' | 'embedded'
  relation_name?: string
  fk_fields?: string[]
  references?: string[]
  auto_generated?: boolean  // mergeRelations에서 역방향 자동 삽입 시 true
  line: number
}

export interface ModelRaw {
  name: string               // 'User', 'Order'
  table_name: string         // 'users', 'orders'
  comment: string
  fields: ModelField[]
  relations: ModelRelation[]
  source_file: string | null // DSL 전략: 파일 경로 / Graph 전략: null
  line_start: number | null
  line_end: number | null
  is_deprecated: boolean
  // description 없음 — DB에만 존재, upsert 시 기존 값 보존
  // orm 필드 없음 — bySource.source.orm으로 전달
}

// ── 파서 컨텍스트 (Prisma DSL pass-1) ─────────────────────

export interface ParseContext {
  enumNames: Set<string>
  modelNames: Set<string>
  compositeTypeNames: Set<string>
}

export interface SchemaFile {
  path: string
  content: string
}

export interface SchemaChunk {
  files: SchemaFile[]
  orm: string
}

// ── 어댑터 인터페이스 ──────────────────────────────────────

export interface BuildModelsAdapter {
  readonly orm: string
  readonly strategy: BuildModelsStrategy

  // DSL-parse 전용 (Prisma 등 독자 DSL)
  ensureReady?(): Promise<void>
  collectNames?(files: SchemaFile[]): ParseContext
  prepareChunks?(files: SchemaFile[]): SchemaChunk[]
  parseChunk?(chunk: SchemaChunk, ctx: ParseContext): ModelRaw[] | Promise<ModelRaw[]>

  // Graph-query 전용 (TypeORM / MikroORM / Drizzle / Sequelize-TS)
  queryFromGraph?(db: import('@/db/client.js').DB, repoId: string): Promise<ModelRaw[]>
}

// ── F1 반환 타입 ───────────────────────────────────────────

export interface LoadedSource {
  source: SchemaSource          // repositories.schemaSources[i] 원본
  adapter: BuildModelsAdapter   // adapterRegistry에서 resolve된 어댑터 인스턴스
  strategy: BuildModelsStrategy // adapter.strategy
  absolutePaths: string[]       // schema_paths를 repo.repoPath 기준으로 절대경로 변환 (DSL 전략만)
}

// ── 검증 verdict ────────────────────────────────────────────

export interface BuildModelsVerdict {
  model_name: string
  level: 'error' | 'warning'
  code: 'NO_PK' | 'ORPHAN_RELATION' | 'FK_MISMATCH' | 'DUPLICATE_FIELD'
  detail: string
}

// ── 파이프라인 결과 ──────────────────────────────────────────

export interface BuildModelsResult {
  runId:         string
  modelsCount:   number
  upsertedCount: number
  orphanedCount: number
  skippedFiles:  string[]
  warnings:      BuildModelsVerdict[]
  errors:        BuildModelsVerdict[]
}
