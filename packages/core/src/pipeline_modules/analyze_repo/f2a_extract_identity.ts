/**
 * F2a-2: extractIdentity — 부스 1 (정적 신원 추출).
 *
 * SOT: specs/analyze_repo/specs/f2a_extract_identity/spec.md
 *
 * LLM 호출 0. 매핑 테이블 + 우선순위 룰만 사용.
 * `ambiguous=true` → orchestrator가 F2a-3 LLM fallback 호출.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Dirent } from 'node:fs'
import type {
  IdentitySignal,
  ManifestSet,
  PackageJson,
} from './types.js'
import type { Framework, RepoLanguage, RepoType } from '@/db/schema/enums.js'

// ────────────────────────────────────────
// otherManifest → language_raw 매핑 + 우선순위
// ────────────────────────────────────────

const OTHER_LANGUAGE_PRIORITY: Array<{ file: string; raw: string }> = [
  { file: 'go.mod', raw: 'go' },
  { file: 'Cargo.toml', raw: 'rust' },
  { file: 'requirements.txt', raw: 'python' },
  { file: 'setup.py', raw: 'python' },
  { file: 'pyproject.toml', raw: 'python' },
  { file: 'build.gradle.kts', raw: 'kotlin' },
  { file: 'build.gradle', raw: 'java' },
  { file: 'pom.xml', raw: 'java' },
  { file: 'Gemfile', raw: 'ruby' },
  { file: 'composer.json', raw: 'php' },
]

// ────────────────────────────────────────
// framework 매핑 + 우선순위
// ────────────────────────────────────────

interface FrameworkRule {
  /** package.json deps 매칭 키 */
  depKey: string
  framework: Framework
  /** 본 framework (true) — 흡수 안 됨 / 라이브러리 (false) — 본 framework에 흡수 */
  isPrimary: boolean
}

/**
 * 우선순위 순서. 위에서 아래로 매칭 시도, 첫 매칭이 결정.
 *   nextjs > nuxt > sveltekit > astro > nestjs > hono > elysia > fastify > koa > express > react > vue > svelte > flutter
 *
 * `react`는 isPrimary=true이지만 nextjs와 동시 매칭 시 nextjs가 흡수 (special case).
 */
const FRAMEWORK_RULES: FrameworkRule[] = [
  { depKey: 'next', framework: 'nextjs', isPrimary: true },
  { depKey: 'nuxt', framework: 'nuxt', isPrimary: true },
  { depKey: '@sveltejs/kit', framework: 'sveltekit', isPrimary: true },
  { depKey: 'astro', framework: 'astro', isPrimary: true },
  { depKey: '@nestjs/core', framework: 'nestjs', isPrimary: true },
  { depKey: 'hono', framework: 'hono', isPrimary: true },
  { depKey: 'elysia', framework: 'elysia', isPrimary: true },
  { depKey: '@springframework/boot', framework: 'spring', isPrimary: true },
  { depKey: 'fastify', framework: 'fastify', isPrimary: true },
  { depKey: 'koa', framework: 'koa', isPrimary: true },
  { depKey: 'express', framework: 'express', isPrimary: true },
  { depKey: 'react', framework: 'react', isPrimary: true },
  { depKey: 'vue', framework: 'vue', isPrimary: true },
  { depKey: 'svelte', framework: 'svelte', isPrimary: true },
]

/**
 * 흡수 룰: nextjs가 매칭되면 react는 흡수 대상.
 */
const ABSORB_RULES: Record<Framework, Framework[]> = {
  nextjs: ['react'],
  nuxt: ['vue'],
  sveltekit: ['svelte'],
  astro: ['react', 'vue', 'svelte'],
  nestjs: [],
  spring: [],
  hono: [],
  elysia: [],
  fastify: ['express'],
  koa: [],
  express: [],
  react: [],
  vue: [],
  svelte: [],
  flutter: [],
  other: [],
}

// ────────────────────────────────────────
// orm + build_tool 매핑 + 우선순위
// ────────────────────────────────────────

const ORM_RULES: Array<{ depKey: string; orm: string }> = [
  { depKey: 'prisma', orm: 'prisma' },
  { depKey: '@prisma/client', orm: 'prisma' },
  { depKey: 'drizzle-orm', orm: 'drizzle' },
  { depKey: 'kysely', orm: 'kysely' },
  { depKey: 'objection', orm: 'objection' },
  { depKey: 'knex', orm: 'knex' },
  { depKey: '@nestjs/mongoose', orm: 'mongoose' },
  { depKey: 'typeorm', orm: 'typeorm' },
  { depKey: '@mikro-orm/core', orm: 'mikro-orm' },
  { depKey: 'sequelize', orm: 'sequelize' },
  { depKey: 'mongoose', orm: 'mongoose' },
]

const PUBSPEC_ORM_RULES: Array<{ depKey: string; orm: string }> = [
  { depKey: 'drift', orm: 'drift' },
  { depKey: 'floor', orm: 'floor' },
]

const SOURCE_ORM_RULES: Array<{ pattern: RegExp; orm: string }> = [
  { pattern: /from\s+['"]drizzle-orm(?:\/[^'"]*)?['"]|require\(['"]drizzle-orm(?:\/[^'"]*)?['"]\)|\b(?:sqlite|pg|mysql|singlestore)Table\s*\(|\brelations\s*\(/, orm: 'drizzle' },
  { pattern: /from\s+['"]kysely['"]|require\(['"]kysely['"]\)|\bKysely\b/, orm: 'kysely' },
  { pattern: /from\s+['"]objection['"]|require\(['"]objection['"]\)|relationMappings\b|extends\s+Model[\s\S]{0,2000}static\s+get\s+tableName|static\s+get\s+tableName[\s\S]{0,2000}extends\s+Model/, orm: 'objection' },
  { pattern: /from\s+['"]knex['"]|require\(['"][^'"]*knex['"]\)|knex\.schema\b|\.schemaBuilder\s*\(/, orm: 'knex' },
  { pattern: /from\s+['"]@mikro-orm\/core['"]|require\(['"]@mikro-orm\/core['"]\)|@PrimaryKey\b|@Property\b/, orm: 'mikro-orm' },
  { pattern: /from\s+['"]typeorm['"]|require\(['"]typeorm['"]\)|@Entity\b|@Column\b|@PrimaryGeneratedColumn\b|BaseEntity\b|EntitySchema\b/, orm: 'typeorm' },
  { pattern: /from\s+['"](?:@sequelize\/core|sequelize)['"]|require\(['"](?:@sequelize\/core|sequelize)['"]\)|sequelize\.define\s*\(|DataTypes\./, orm: 'sequelize' },
  { pattern: /from\s+['"]mongoose['"]|require\(['"]mongoose['"]\)|mongoose\.Schema\b|new\s+Schema\s*\(|SchemaFactory\.createForClass\b/, orm: 'mongoose' },
  { pattern: /\bPrismaClient\b|schema\.prisma|^\s*model\s+\w+\s*\{/m, orm: 'prisma' },
  { pattern: /package:drift\/(?:drift|native)\.dart|extends\s+Table\b|@DriftDatabase\b/, orm: 'drift' },
  { pattern: /package:floor\/floor\.dart|@Database\b/, orm: 'floor' },
]

const BUILD_TOOL_RULES: Array<{ depKey: string; tool: string }> = [
  { depKey: 'turbo', tool: 'turbo' },
  { depKey: 'nx', tool: 'nx' },
  { depKey: 'vite', tool: 'vite' },
  { depKey: 'webpack', tool: 'webpack' },
  { depKey: 'rollup', tool: 'rollup' },
  { depKey: 'esbuild', tool: 'esbuild' },
  { depKey: 'parcel', tool: 'parcel' },
]

// ────────────────────────────────────────
// 메인
// ────────────────────────────────────────

export function extractIdentity(
  manifests: ManifestSet,
  repoPath: string,
): IdentitySignal {
  const trace: string[] = []

  // 1. language 결정
  const langResult = decideLanguage(manifests, repoPath, trace)

  // 2. orm 결정
  const orm = decideOrm(manifests, repoPath, trace)

  // 3. framework 결정 (deps 매핑 + 우선순위)
  const fwResult = decideFramework(manifests, langResult.language, repoPath, orm, trace)

  // 4. type 결정
  const type = decideType(fwResult.framework, repoPath, orm)

  // 5. build_tool 결정
  const build_tool = decideBuildTool(manifests, trace)

  // 6. confidence
  const confidence = decideConfidence(langResult.language, fwResult.framework, manifests.tsconfig !== null)

  // 7. ambiguous (langResult, fwResult 결과 + monorepo 신호)
  const monorepoSignal = detectMonorepo(manifests, repoPath, fwResult.matchedRules.length)
  const ambiguous = fwResult.ormOnly ? false :
    langResult.ambiguous ||
    fwResult.ambiguous ||
    monorepoSignal

  return {
    language: langResult.language,
    language_raw: langResult.language_raw,
    framework: fwResult.framework,
    framework_raw: fwResult.framework_raw,
    type,
    orm,
    build_tool,
    confidence,
    /* v8 ignore next -- every public path records at least one trace entry. */
    reasoning: trace.join(' + ') || 'no signals',
    ambiguous,
  }
}

// ────────────────────────────────────────
// language
// ────────────────────────────────────────

interface LanguageResult {
  language: RepoLanguage | null
  language_raw: string | null
  ambiguous: boolean
}

function decideLanguage(manifests: ManifestSet, repoPath: string, trace: string[]): LanguageResult {
  if (manifests.pubspecYaml !== null) {
    trace.push('pubspec.yaml')
    return { language: 'dart', language_raw: null, ambiguous: false }
  }
  if (manifests.packageJson !== null && manifests.tsconfig !== null) {
    const sourceLanguage = detectSourceFileLanguage(repoPath)
    if (sourceLanguage === 'javascript') {
      trace.push('package.json + tsconfig + js source')
      return { language: 'javascript', language_raw: null, ambiguous: false }
    }
    trace.push(sourceLanguage === 'typescript' ? 'package.json + tsconfig + ts source' : 'package.json + tsconfig')
    return { language: 'typescript', language_raw: null, ambiguous: false }
  }
  if (manifests.packageJson !== null) {
    const sourceLanguage = detectSourceFileLanguage(repoPath)
    if (sourceLanguage !== null) {
      trace.push(`package.json + ${sourceLanguage} source`)
      return { language: sourceLanguage, language_raw: null, ambiguous: false }
    }
    trace.push('package.json')
    return { language: 'javascript', language_raw: null, ambiguous: false }
  }

  // JVM build manifests can be authored in Kotlin DSL while the app source is Java.
  // Prefer source files when present, then fall back to manifest-level defaults.
  const hasJvmBuildManifest =
    manifests.otherManifests.includes('build.gradle.kts') ||
    manifests.otherManifests.includes('build.gradle') ||
    manifests.otherManifests.includes('pom.xml')
  if (hasJvmBuildManifest) {
    const jvmLanguage = detectJvmSourceLanguage(repoPath)
    if (jvmLanguage !== null) {
      trace.push(`jvm-source:${jvmLanguage}`)
      return { language: jvmLanguage, language_raw: null, ambiguous: false }
    }
  }

  // otherManifests 우선순위
  if (manifests.otherManifests.includes('build.gradle.kts')) {
    trace.push('manifest:build.gradle.kts')
    return { language: 'kotlin', language_raw: null, ambiguous: false }
  }
  if (manifests.otherManifests.includes('build.gradle') || manifests.otherManifests.includes('pom.xml')) {
    trace.push('manifest:java-build')
    return { language: 'java', language_raw: null, ambiguous: false }
  }
  for (const rule of OTHER_LANGUAGE_PRIORITY) {
    if (manifests.otherManifests.includes(rule.file)) {
      trace.push(`manifest:${rule.file}`)
      return { language: 'other', language_raw: rule.raw, ambiguous: true }
    }
  }

  const sourceLanguage = detectSourceFileLanguage(repoPath)
  if (sourceLanguage !== null) {
    trace.push(`source:${sourceLanguage}`)
    return { language: sourceLanguage, language_raw: null, ambiguous: true }
  }

  if (detectDartSource(repoPath)) {
    trace.push('source:dart')
    return { language: 'dart', language_raw: null, ambiguous: true }
  }

  const jvmLanguage = detectJvmSourceLanguage(repoPath)
  if (jvmLanguage !== null) {
    trace.push(`source:${jvmLanguage}`)
    return { language: jvmLanguage, language_raw: null, ambiguous: true }
  }

  // 매니페스트 0개
  trace.push('no manifests')
  return { language: null, language_raw: null, ambiguous: true }
}

function detectJvmSourceLanguage(repoPath: string): 'java' | 'kotlin' | null {
  if (!repoPath || !existsSync(repoPath)) return null
  if (hasFileMatching(repoPath, /\.kt$/)) return 'kotlin'
  if (hasFileMatching(repoPath, /\.java$/)) return 'java'
  return null
}

function detectSourceFileLanguage(repoPath: string): 'typescript' | 'javascript' | null {
  if (!repoPath || !existsSync(repoPath)) return null
  let hasTypeScript = false
  let hasJavaScript = false
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])

  const visit = (dir: string, depth: number): void => {
    if (depth > 8 || hasTypeScript) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(resolve(dir, entry.name), depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        hasTypeScript = true
        return
      }
      if (/\.(js|jsx|mjs|cjs)$/.test(entry.name)) {
        hasJavaScript = true
      }
    }
  }

  visit(repoPath, 0)
  if (hasTypeScript) return 'typescript'
  if (hasJavaScript) return 'javascript'
  return null
}

function detectDartSource(repoPath: string): boolean {
  return collectSourceContents(repoPath, /\.(dart)$/).length > 0
}

// ────────────────────────────────────────
// framework
// ────────────────────────────────────────

interface FrameworkResult {
  framework: Framework | null
  framework_raw: string | null
  matchedRules: FrameworkRule[]
  ambiguous: boolean
  ormOnly: boolean
}

function decideFramework(
  manifests: ManifestSet,
  language: RepoLanguage | null,
  repoPath: string,
  orm: string | null,
  trace: string[],
): FrameworkResult {
  // pubspec → flutter (단순)
  if (manifests.pubspecYaml !== null) {
    const flutterDep = manifests.pubspecYaml.dependencies?.flutter
    const deps = manifests.pubspecYaml.dependencies ?? {}
    const devDeps = manifests.pubspecYaml.dev_dependencies ?? {}
    const isDartWorkspace = deps.melos !== undefined || devDeps.melos !== undefined
    if (
      flutterDep !== undefined ||
      deps.go_router !== undefined ||
      devDeps.flutter_test !== undefined ||
      (!isDartWorkspace && detectFlutterRoutingSource(repoPath))
    ) {
      trace.push('pubspec.flutter')
      return { framework: 'flutter', framework_raw: null, matchedRules: [], ambiguous: false, ormOnly: false }
    }
  }

  // package.json deps → framework 매핑
  if (manifests.packageJson === null) {
    if (hasNextSourceSignal(repoPath)) {
      trace.push('framework:nextjs-source')
      return { framework: 'nextjs', framework_raw: null, matchedRules: [], ambiguous: false, ormOnly: false }
    }
    if (hasSpringSignal(manifests, repoPath)) {
      trace.push('spring:jvm-manifest-or-source')
      return { framework: 'spring', framework_raw: null, matchedRules: [], ambiguous: false, ormOnly: false }
    }
    if (orm !== null) {
      trace.push('framework:other (orm-only)')
      return { framework: 'other', framework_raw: null, matchedRules: [], ambiguous: false, ormOnly: true }
    }
    // language='other' (otherManifests로 결정됨) → framework도 'other'
    if (language === 'other') {
      return { framework: 'other', framework_raw: null, matchedRules: [], ambiguous: true, ormOnly: false }
    }
    // 매니페스트 0개 — language=null
    return { framework: null, framework_raw: null, matchedRules: [], ambiguous: true, ormOnly: false }
  }

  const allDeps = collectDeps(manifests.packageJson)

  // deps 비어있음
  if (Object.keys(allDeps).length === 0) {
    if (hasNextSourceSignal(repoPath)) {
      trace.push('framework:nextjs-source')
      return { framework: 'nextjs', framework_raw: null, matchedRules: [], ambiguous: false, ormOnly: false }
    }
    if (orm !== null) {
      trace.push('framework:other (orm-only)')
      return { framework: 'other', framework_raw: null, matchedRules: [], ambiguous: false, ormOnly: true }
    }
    trace.push('deps={}')
    return { framework: 'other', framework_raw: null, matchedRules: [], ambiguous: true, ormOnly: false }
  }

  // 우선순위 룰로 매칭
  const matchedRules: FrameworkRule[] = []
  for (const rule of FRAMEWORK_RULES) {
    if (allDeps[rule.depKey] !== undefined) {
      matchedRules.push(rule)
    }
  }

  if (matchedRules.length === 0) {
    if (isReactRouterApp(allDeps, repoPath)) {
      trace.push('deps:react-router')
      return {
        framework: 'react',
        framework_raw: null,
        matchedRules: [],
        ambiguous: false,
        ormOnly: false,
      }
    }
    if (hasNextSourceSignal(repoPath)) {
      trace.push('framework:nextjs-source')
      return {
        framework: 'nextjs',
        framework_raw: null,
        matchedRules: [],
        ambiguous: false,
        ormOnly: false,
      }
    }
    if (orm !== null) {
      trace.push('framework:other (orm-only)')
      return { framework: 'other', framework_raw: null, matchedRules: [], ambiguous: false, ormOnly: true }
    }
    // 미지원 framework — LLM fallback에 위임 (framework: null, ambiguous: true)
    const topDep = Object.keys(allDeps)[0]
    trace.push(`unknown framework (top dep: ${topDep})`)
    /* v8 ignore next -- `allDeps` was checked non-empty before this branch. */
    return { framework: null, framework_raw: topDep ?? null, matchedRules: [], ambiguous: true, ormOnly: false }
  }

  // 우선순위 첫 매칭이 framework
  const primary = matchedRules[0]

  if (primary.framework === 'express' && isViteReactRouterHostedApp(allDeps, repoPath)) {
    trace.push('deps:react-router + vite-hosted')
    return {
      framework: 'react',
      framework_raw: null,
      matchedRules,
      ambiguous: false,
      ormOnly: false,
    }
  }

  trace.push(`deps:${primary.depKey}`)

  const absorbed = ABSORB_RULES[primary.framework] ?? []
  const otherPrimaries = matchedRules
    .slice(1)
    .filter((r) => r.isPrimary && !absorbed.includes(r.framework))

  if (
    primary.framework === 'nestjs' &&
    otherPrimaries.every((r) => ['react', 'vue', 'svelte'].includes(r.framework))
  ) {
    return {
      framework: 'nestjs',
      framework_raw: null,
      matchedRules,
      ambiguous: false,
      ormOnly: false,
    }
  }

  // ambiguous — "본 framework 동시" 검출
  // primary가 흡수하는 framework는 제외
  if (otherPrimaries.length > 0) {
    // primary 둘 이상 충돌 — LLM fallback에 위임 (framework: null)
    return {
      framework: null,
      framework_raw: null,
      matchedRules,
      ambiguous: true,
      ormOnly: false,
    }
  }

  return {
    framework: primary.framework,
    framework_raw: null,
    matchedRules,
    ambiguous: false,
    ormOnly: false,
  }
}

function collectDeps(pkg: PackageJson): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  }
}

function hasNextSourceSignal(repoPath: string): boolean {
  if (!repoPath || !existsSync(repoPath)) return false
  if (
    existsSync(resolve(repoPath, 'next.config.js')) ||
    existsSync(resolve(repoPath, 'next.config.mjs')) ||
    existsSync(resolve(repoPath, 'next.config.ts'))
  ) {
    return true
  }

  return hasFileMatching(
    repoPath,
    /(?:^|\/)(?:src\/)?(?:app\/(?:[^/]+\/)*(?:page|layout|route)\.(?:tsx?|jsx?)|pages\/(?:api\/)?[^/].*\.(?:tsx?|jsx?))$/,
  )
}

function isViteReactRouterHostedApp(allDeps: Record<string, string>, repoPath: string): boolean {
  const hasReact = allDeps.react !== undefined
  const hasRouter = allDeps['react-router-dom'] !== undefined || allDeps['react-router'] !== undefined
  const hasVite = allDeps.vite !== undefined || allDeps['@vitejs/plugin-react'] !== undefined
  if (!hasReact || !hasRouter || !hasVite) return false

  const hasReactRouterFramework =
    allDeps['@react-router/express'] !== undefined ||
    allDeps['@react-router/node'] !== undefined ||
    allDeps['@react-router/dev'] !== undefined
  if (hasReactRouterFramework &&
    (existsSync(resolve(repoPath, 'app/routes.ts')) ||
      existsSync(resolve(repoPath, 'app/routes.js')) ||
      existsSync(resolve(repoPath, 'react-router.config.ts')) ||
      existsSync(resolve(repoPath, 'react-router.config.js')))
  ) {
    return true
  }

  const clientEntries = [
    'src/entry.client.tsx',
    'src/entry.client.jsx',
    'src/entry.client.ts',
    'src/entry.client.js',
    'src/entry.browser.tsx',
    'src/entry.browser.jsx',
    'src/entry.browser.ts',
    'src/entry.browser.js',
  ]
  const serverEntries = [
    'src/entry.server.tsx',
    'src/entry.server.jsx',
    'src/entry.server.ts',
    'src/entry.server.js',
    'src/entry.ssr.tsx',
    'src/entry.ssr.jsx',
    'src/entry.ssr.ts',
    'src/entry.ssr.js',
    'src/entry.rsc.tsx',
    'src/entry.rsc.jsx',
    'src/entry.rsc.ts',
    'src/entry.rsc.js',
  ]

  if (clientEntries.some((rel) => existsSync(resolve(repoPath, rel))) &&
    serverEntries.some((rel) => existsSync(resolve(repoPath, rel)))
  ) {
    return true
  }

  const appEntryRe = /^(?:[^/]+\/)?(?:main|index)\.[jt]sx$/
  return readdirSync(repoPath, { withFileTypes: true }).some((entry) => {
    if (entry.isFile() && appEntryRe.test(entry.name)) return true
    if (!entry.isDirectory()) return false
    return ['main.jsx', 'main.tsx', 'index.jsx', 'index.tsx'].some((name) =>
      existsSync(resolve(repoPath, entry.name, name)),
    )
  })
}

function isReactRouterApp(allDeps: Record<string, string>, repoPath: string): boolean {
  const hasRouter =
    allDeps['react-router-dom'] !== undefined ||
    allDeps['react-router'] !== undefined ||
    allDeps['@react-router/node'] !== undefined ||
    allDeps['@react-router/dev'] !== undefined ||
    allDeps['@react-router/express'] !== undefined
  if (!hasRouter) return false

  return [
    'app/routes.ts',
    'app/routes.tsx',
    'app/routes.js',
    'app/routes.jsx',
    'react-router.config.ts',
    'react-router.config.js',
    'src/routes.ts',
    'src/routes.tsx',
    'src/App.tsx',
    'src/App.jsx',
  ].some((rel) => existsSync(resolve(repoPath, rel)))
}

function detectFlutterRoutingSource(repoPath: string): boolean {
  return collectSourceContents(repoPath, /\.dart$/).some((content) =>
    /\b(GoRouter|GoRoute|MaterialApp\.router|GetMaterialApp|GetPage|AutoRoute|Beamer)\b/.test(content),
  )
}

// ────────────────────────────────────────
// type
// ────────────────────────────────────────

function decideType(framework: Framework | null, repoPath: string, orm: string | null = null): RepoType | null {
  if (framework === null) return null
  switch (framework) {
    case 'nestjs':
    case 'express':
    case 'fastify':
    case 'koa':
    case 'hono':
    case 'elysia':
    case 'spring':
      return 'backend'
    case 'react':
      if (orm !== null && existsSync(resolve(repoPath, 'prisma/schema.prisma'))) return 'fullstack'
      return 'frontend'
    case 'nuxt':
      if (existsSync(resolve(repoPath, 'server'))) return 'fullstack'
      return 'frontend'
    case 'sveltekit':
      if (hasFileMatching(repoPath, /^src\/routes\/.*\/?\+server\.(ts|js)$/)) return 'fullstack'
      return 'frontend'
    case 'astro':
      if (hasFileMatching(repoPath, /^src\/pages\/api\/.*\.(ts|js)$/)) return 'fullstack'
      return 'frontend'
    case 'vue':
    case 'svelte':
      return 'frontend'
    case 'flutter':
      return 'mobile'
    case 'nextjs': {
      // app/api/ 또는 src/app/api/ 또는 pages/api/ 또는 src/pages/api/ 존재 검사
      const candidates = [
        'app/api',
        'src/app/api',
        'pages/api',
        'src/pages/api',
      ]
      for (const rel of candidates) {
        if (existsSync(resolve(repoPath, rel))) return 'fullstack'
      }
      return 'frontend'
    }
    case 'other':
      return null
  }
}

function hasSpringSignal(manifests: ManifestSet, repoPath: string): boolean {
  const hasManifestSignal =
    manifests.otherManifests.includes('pom.xml') ||
    manifests.otherManifests.includes('build.gradle') ||
    manifests.otherManifests.includes('build.gradle.kts')
  if (!hasManifestSignal) return false

  const manifestHints = collectSourceContents(repoPath, /^(pom\.xml|build\.gradle|build\.gradle\.kts|settings\.gradle|settings\.gradle\.kts)$/)
  if (manifestHints.some((content) => /org\.springframework\.boot|spring-boot-gradle-plugin|spring-boot-starter/i.test(content))) {
    return true
  }

  const springHints = collectSourceContents(repoPath, /\.(java|kt)$/)
  return springHints.some((content) =>
    /@SpringBootApplication|@RestController|@Controller|@RestControllerAdvice|@ControllerAdvice|@ExceptionHandler|@RequestMapping|@GetMapping|@PostMapping|@PutMapping|@DeleteMapping|@PatchMapping|@Scheduled|@EventListener|@KafkaListener|@RabbitListener|@JmsListener|@SqsListener|@MessageMapping|@SubscribeMapping/.test(content),
  )
}

function hasFileMatching(repoPath: string, pattern: RegExp): boolean {
  if (!repoPath || !existsSync(repoPath)) return false
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage'])
  const visit = (dir: string, depth: number): boolean => {
    if (depth > 8) return false
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const abs = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && visit(abs, depth + 1)) return true
        continue
      }
      if (!entry.isFile()) continue
      const rel = abs.slice(repoPath.length).replace(/^[/\\]/, '').replace(/\\/g, '/')
      if (pattern.test(rel)) return true
    }
    return false
  }
  return visit(repoPath, 0)
}

// ────────────────────────────────────────
// orm
// ────────────────────────────────────────

function decideOrm(manifests: ManifestSet, repoPath: string, trace: string[]): string | null {
  if (manifests.packageJson !== null) {
    const allDeps = collectDeps(manifests.packageJson)
    for (const rule of ORM_RULES) {
      if (allDeps[rule.depKey] !== undefined) {
        trace.push(`orm:${rule.orm}`)
        return rule.orm
      }
    }
  }
  if (manifests.pubspecYaml !== null) {
    const deps = manifests.pubspecYaml.dependencies ?? {}
    for (const rule of PUBSPEC_ORM_RULES) {
      if (deps[rule.depKey] !== undefined) {
        trace.push(`orm:${rule.orm}`)
        return rule.orm
      }
    }
  }
  const sourceOrm = detectSourceOrm(repoPath, trace)
  if (sourceOrm !== null) return sourceOrm
  return null
}

function detectSourceOrm(repoPath: string, trace: string[]): string | null {
  const contents = collectSourceContents(repoPath, /\.(ts|tsx|js|jsx|mjs|cjs|dart|prisma)$/)
  for (const content of contents) {
    for (const rule of SOURCE_ORM_RULES) {
      if (rule.pattern.test(content)) {
        trace.push(`source-orm:${rule.orm}`)
        return rule.orm
      }
    }
  }
  return null
}

function collectSourceContents(repoPath: string, filePattern: RegExp): string[] {
  if (!repoPath || !existsSync(repoPath)) return []
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])
  const out: string[] = []

  const visit = (dir: string, depth: number): void => {
    if (depth > 8 || out.length >= 1000) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(resolve(dir, entry.name), depth + 1)
        continue
      }
      if (!entry.isFile() || !filePattern.test(entry.name)) continue
      try {
        out.push(readFileSync(resolve(dir, entry.name), 'utf-8').slice(0, 64_000))
      } catch {
        continue
      }
    }
  }

  visit(repoPath, 0)
  return out
}

// ────────────────────────────────────────
// build_tool
// ────────────────────────────────────────

function decideBuildTool(manifests: ManifestSet, trace: string[]): string | null {
  if (manifests.packageJson === null) return null
  const allDeps = collectDeps(manifests.packageJson)
  for (const rule of BUILD_TOOL_RULES) {
    if (allDeps[rule.depKey] !== undefined) {
      trace.push(`build:${rule.tool}`)
      return rule.tool
    }
  }
  return null
}

// ────────────────────────────────────────
// confidence
// ────────────────────────────────────────

function decideConfidence(
  language: RepoLanguage | null,
  framework: Framework | null,
  hasTsconfig: boolean,
): 'high' | 'medium' | 'low' {
  if (framework === null || framework === 'other') return 'low'
  if (language === 'typescript' && hasTsconfig) return 'high'
  if (language === 'dart') return 'high'
  return 'medium'
}

// ────────────────────────────────────────
// monorepo 신호
// ────────────────────────────────────────

function detectMonorepo(
  manifests: ManifestSet,
  repoPath: string,
  matchedFrameworkCount: number,
): boolean {
  if (matchedFrameworkCount < 2) return false
  // workspaces 필드
  if (manifests.packageJson?.workspaces !== undefined) return true
  // pnpm-workspace.yaml 존재
  if (existsSync(resolve(repoPath, 'pnpm-workspace.yaml'))) return true
  return false
}
