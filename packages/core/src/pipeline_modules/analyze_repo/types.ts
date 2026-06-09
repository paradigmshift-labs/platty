/* istanbul ignore file */
/* c8 ignore start */
/* v8 ignore start -- type-only module. */

/**
 * analyze_repo 모듈 입출력 타입.
 *
 * V2 MVP는 source: 'local'만. 'git-url'/'github-app'은 V2 비범위.
 */

import type { CustomDecoratorMapping } from '@/db/schema/json_types/custom_decorator.js'
import type { RepoType, RepoLanguage, Framework } from '@/db/schema/enums.js'

export type RepoSourceType = 'local'

export interface RepoInfo {
  /** 절대경로 (forward slash 정규화) */
  path: string
  /** 디렉토리명 (basename) */
  name: string
  source: RepoSourceType
}

/** F2a collectKeyFiles 결과 — LLM 분류 input */
export interface KeyFile {
  /** repo 루트 기준 상대경로 (forward slash) */
  path: string
  /** 파일 내용 (BOM 제거 + 주석 제거됨) */
  content: string
}

// ────────────────────────────────────────
// F2a-1 readManifests 출력 (v2 신규)
// ────────────────────────────────────────

export interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
  main?: string
  workspaces?: string[] | { packages: string[] }
  [key: string]: unknown
}

export interface PubspecYaml {
  name?: string
  dependencies?: Record<string, unknown>
  dev_dependencies?: Record<string, unknown>
}

export interface TsConfig {
  compilerOptions?: {
    baseUrl?: string
    paths?: Record<string, string[]>
  }
  extends?: string
}

export interface ManifestSet {
  packageJson: PackageJson | null
  pubspecYaml: PubspecYaml | null
  tsconfig: TsConfig | null
  /** ['go.mod', 'Cargo.toml', 'requirements.txt', 'pom.xml', 'Gemfile', 'composer.json', 'setup.py', 'pyproject.toml', 'build.gradle', 'build.gradle.kts'] */
  otherManifests: string[]
}

// ────────────────────────────────────────
// F2a-2 extractIdentity 출력 (v2 신규 — 부스 1)
// ────────────────────────────────────────

// ────────────────────────────────────────
// F2b extractStandardSlots 출력 (v2 신규 — 부스 2)
// ────────────────────────────────────────

/**
 * 부스 2 출력 — 정적 슬롯 추출.
 *
 * needsLLM* 중 하나라도 true → orchestrator가 F2b-2 (extractAmbiguousSlots) 호출.
 */
export interface StandardSlots {
  path_aliases: Record<string, string>
  base_url: string | null
  entrypoint_files: string[]
  routing_files: string[]
  routing_libs: string[]                       // ★ v2 신규
  schema_sources: SchemaSourceFromLLM[]

  // 부스 3 신호 (2개 — controller/page/apiBasePaths 신호 제거됨)
  needsLLMRouting: boolean
  needsLLMCustomDecorators: boolean
}

/**
 * 정적 신원 추출 결과.
 * `ambiguous=true` → orchestrator가 F2a-3 LLM fallback 호출.
 * `framework='other'` 또는 `null` → F2b/F3 SKIP.
 */
export interface IdentitySignal {
  language: RepoLanguage | null
  /** 'other'일 때 'go'/'rust'/'python'/'java'/'kotlin'/'ruby'/'php' 등 */
  language_raw: string | null
  framework: Framework | null
  /** 'other'일 때 LLM 또는 deps top key 보존 */
  framework_raw: string | null
  type: RepoType | null
  orm: string | null
  build_tool: string | null
  confidence: 'high' | 'medium' | 'low'
  /** 결정 trace — "deps:@nestjs/core + tsconfig + prisma" 등 */
  reasoning: string
  ambiguous: boolean
}

// ────────────────────────────────────────
// F2b 출력 (v2 — 부스 2 통합 결과 = StackInfo)
// ────────────────────────────────────────

export interface SchemaSourceFromLLM {
  orm: string
  provider: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'mariadb' | null
  schema_paths: string[]
  label: string
}

/**
 * StackInfo — F2b 부스 2/3 통합 결과.
 */
export interface StackInfo {
  type: 'backend' | 'frontend' | 'fullstack' | 'mobile'
  language: string
  framework: string
  schema_sources: SchemaSourceFromLLM[]
  routing_files: string[]
  routing_libs: string[]                                          // ★ v2 신규
  entrypoint_files: string[]
  path_aliases: Record<string, string>
  base_url: string | null
  custom_decorators: Record<string, CustomDecoratorMapping>       // ★ v2 신규
}
