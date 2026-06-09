import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expressAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/express.js'
import { fastifyAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/fastify.js'
import { reactAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/react.js'
import { flutterAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/flutter.js'
import { genericAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/generic.js'
import * as grepHelpers from '@/pipeline_modules/analyze_repo/static/helpers/grep.js'
import type { ManifestSet, IdentitySignal } from '@/pipeline_modules/analyze_repo/types.js'

const TMP = resolve(process.cwd(), '.tmp-test-other-adapters')

function mkRepo(name: string, files: Record<string, string> = {}): string {
  const repoPath = join(TMP, name)
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return repoPath
}

const baseIdentity = (overrides: Partial<IdentitySignal> = {}): IdentitySignal => ({
  language: 'typescript', language_raw: null,
  framework: 'express', framework_raw: null,
  type: 'backend', orm: null, build_tool: null,
  confidence: 'high', reasoning: '', ambiguous: false,
  ...overrides,
})

const npmManifests = (deps: Record<string, string> = {}): ManifestSet => ({
  packageJson: { dependencies: deps },
  pubspecYaml: null, tsconfig: {}, otherManifests: [],
})

const pubspecManifests = (deps: Record<string, unknown> = {}): ManifestSet => ({
  packageJson: null,
  pubspecYaml: { dependencies: deps },
  tsconfig: null, otherManifests: [],
})

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

// ────────────────────────────────────────
// express
// ────────────────────────────────────────

describe('expressAdapter', () => {
  it('E1: Express — routing은 build_route에 위임, needsLLMRouting=false', async () => {
    const repo = mkRepo('e1', { 'src/index.ts': '', 'src/routes/users.ts': '' })
    const r = await expressAdapter.extractSlots(npmManifests({ express: '^4' }), baseIdentity(), repo)
    expect(r.needsLLMRouting).toBe(false)
  })

  it('E2: entrypoint fallback chain (src/index.ts 우선)', async () => {
    const repo = mkRepo('e2', { 'src/index.ts': '', 'src/server.ts': '' })
    const r = await expressAdapter.extractSlots(npmManifests({ express: '^4' }), baseIdentity(), repo)
    expect(r.entrypoint_files).toEqual(['src/index.ts'])
  })

  it('E3: entrypoint 못 찾음 → []', async () => {
    const repo = mkRepo('e3', { 'README.md': '' })
    const r = await expressAdapter.extractSlots(npmManifests({ express: '^4' }), baseIdentity(), repo)
    expect(r.entrypoint_files).toEqual([])
  })

  it('E4: schema_sources sequelize', async () => {
    const repo = mkRepo('e4', { 'src/index.ts': '' })
    const r = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', sequelize: '^6' }),
      baseIdentity({ orm: 'sequelize' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('sequelize')
  })

  it('E4b: schema_sources drizzle', async () => {
    const repo = mkRepo('e4b', { 'src/index.ts': '' })
    const r = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', 'drizzle-orm': '^0.30' }),
      baseIdentity({ orm: 'drizzle' }),
      repo,
    )
    expect(r.schema_sources).toEqual([
      { orm: 'drizzle', provider: null, schema_paths: ['src/db/schema/**/*.ts'], label: 'main' },
    ])
  })

  it('E5: prisma schema path honors package.json prisma.schema', async () => {
    const repo = mkRepo('e5', { 'src/main.ts': '', 'src/prisma/schema.prisma': '' })
    const r = await expressAdapter.extractSlots(
      {
        ...npmManifests({ express: '^4', prisma: '^5' }),
        packageJson: {
          dependencies: { express: '^4', prisma: '^5' },
          prisma: { schema: 'src/prisma/schema.prisma' },
        },
      },
      baseIdentity({ orm: 'prisma' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.schema_paths).toEqual(['src/prisma/schema.prisma'])
  })

  it('E5b: prisma schema folder falls back to glob path', async () => {
    const repo = mkRepo('e5b', {
      'src/main.ts': '',
      'prisma/schema/schema.prisma': '',
      'prisma/schema/user.prisma': '',
    })
    const r = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', prisma: '^6' }),
      baseIdentity({ orm: 'prisma' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.schema_paths).toEqual(['prisma/schema/*.prisma'])
  })

  it('E5c: prisma.schema directory in package.json becomes folder glob', async () => {
    const repo = mkRepo('e5c', {
      'src/main.ts': '',
      'src/prisma/schema/schema.prisma': '',
      'src/prisma/schema/user.prisma': '',
    })
    const r = await expressAdapter.extractSlots(
      {
        ...npmManifests({ express: '^4', prisma: '^6' }),
        packageJson: {
          dependencies: { express: '^4', prisma: '^6' },
          prisma: { schema: './src/prisma/schema' },
        },
      },
      baseIdentity({ orm: 'prisma' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.schema_paths).toEqual(['./src/prisma/schema/*.prisma'])
  })

  it('E6: typeorm schema paths include common entity directory', async () => {
    const repo = mkRepo('e6', { 'src/index.ts': '', 'src/entity/Post.ts': '' })
    const r = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', typeorm: '^0.3' }),
      baseIdentity({ orm: 'typeorm' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.schema_paths).toContain('src/entity/**/*.ts')
  })

  it('E7: sequelize schema paths include common sequelize/models directory', async () => {
    const repo = mkRepo('e7', { 'express/app.js': '', 'sequelize/models/user.model.js': '' })
    const r = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', sequelize: '^6' }),
      baseIdentity({ language: 'javascript', orm: 'sequelize' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.schema_paths).toContain('sequelize/models/*.js')
  })

  it('E8: mongoose schema paths include common server model files', async () => {
    const repo = mkRepo('e8', { 'index.js': '', 'server/user/user.model.js': '' })
    const r = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', mongoose: '^7' }),
      baseIdentity({ language: 'javascript', orm: 'mongoose' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.schema_paths).toContain('server/**/*.model.js')
  })

  it('E9: mikro-orm schema paths include common app entity files', async () => {
    const repo = mkRepo('e9', { 'app/server.js': '', 'app/entities/Author.js': '' })
    const r = await expressAdapter.extractSlots(
      npmManifests({ express: '^5', '@mikro-orm/core': '^7' }),
      baseIdentity({ language: 'javascript', orm: 'mikro-orm' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.schema_paths).toContain('app/entities/**/*.js')
  })

  it('E10: unsupported or absent ORM yields no schema sources', async () => {
    const repo = mkRepo('e10', { 'src/index.ts': '' })
    expect((await expressAdapter.extractSlots(npmManifests({ express: '^4' }), baseIdentity(), repo)).schema_sources).toEqual([])
    expect((await expressAdapter.extractSlots(
      npmManifests({ express: '^4' }),
      baseIdentity({ orm: 'unknown-orm' }),
      repo,
    )).schema_sources).toEqual([])
  })

  it('E11: prisma default and src/prisma folder fallback paths are stable', async () => {
    const defaultRepo = mkRepo('e11-default', { 'src/index.ts': '' })
    const defaultResult = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', prisma: '^6' }),
      baseIdentity({ orm: 'prisma' }),
      defaultRepo,
    )
    expect(defaultResult.schema_sources?.[0]?.schema_paths).toEqual(['prisma/schema.prisma'])

    const folderRepo = mkRepo('e11-folder', { 'src/prisma/schema/user.prisma': '' })
    const folderResult = await expressAdapter.extractSlots(
      npmManifests({ express: '^4', prisma: '^6' }),
      baseIdentity({ orm: 'prisma' }),
      folderRepo,
    )
    expect(folderResult.schema_sources?.[0]?.schema_paths).toEqual(['src/prisma/schema/*.prisma'])
  })

  it('E12: ORM schema path resolvers keep documented fallback globs when no directories exist', async () => {
    const repo = mkRepo('e12', { 'README.md': '' })
    expect((await expressAdapter.extractSlots(
      npmManifests({ express: '^4', sequelize: '^6' }),
      baseIdentity({ orm: 'sequelize' }),
      repo,
    )).schema_sources?.[0]?.schema_paths).toEqual(['src/**/*.model.ts'])
    expect((await expressAdapter.extractSlots(
      npmManifests({ express: '^4', mongoose: '^7' }),
      baseIdentity({ orm: 'mongoose' }),
      repo,
    )).schema_sources?.[0]?.schema_paths).toEqual(['src/**/*.schema.ts'])
    expect((await expressAdapter.extractSlots(
      npmManifests({ express: '^4', '@mikro-orm/core': '^7' }),
      baseIdentity({ orm: 'mikro-orm' }),
      repo,
    )).schema_sources?.[0]?.schema_paths).toEqual(['src/**/*.entity.ts'])
    expect((await expressAdapter.extractSlots(
      npmManifests({ express: '^4', typeorm: '^0.3' }),
      baseIdentity({ orm: 'typeorm' }),
      repo,
    )).schema_sources?.[0]?.schema_paths).toEqual(['src/**/*.entity.ts'])
  })
})

// ────────────────────────────────────────
// fastify
// ────────────────────────────────────────

describe('fastifyAdapter', () => {
  it('F1: Fastify — routing은 build_route에 위임, needsLLMRouting=false', async () => {
    const repo = mkRepo('f1', { 'src/index.ts': '', 'src/routes/users.ts': '' })
    const r = await fastifyAdapter.extractSlots(npmManifests({ fastify: '^4' }), baseIdentity({ framework: 'fastify' }), repo)
    expect(r.needsLLMRouting).toBe(false)
  })

  it('F2: schema_sources prisma', async () => {
    const repo = mkRepo('f2', { 'src/index.ts': '', 'prisma/schema.prisma': '' })
    const r = await fastifyAdapter.extractSlots(
      npmManifests({ fastify: '^4', prisma: '^5' }),
      baseIdentity({ framework: 'fastify', orm: 'prisma' }),
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('prisma')
  })
})

// ────────────────────────────────────────
// react
// ────────────────────────────────────────

describe('reactAdapter', () => {
  it('R4: router lib 없음 → routing_files=[] + needsLLMRouting=false (★ A1 자격)', async () => {
    const repo = mkRepo('r4', { 'src/main.tsx': '', 'src/pages/Home.tsx': '' })
    const r = await reactAdapter.extractSlots(npmManifests({ react: '^18' }), baseIdentity({ framework: 'react' }), repo)
    expect(r.routing_files).toEqual([])
    expect(r.needsLLMRouting).toBe(false)
  })

  it('R6: router lib + 컨벤션 위치 발견 → routing_files 정적', async () => {
    const repo = mkRepo('r6', { 'src/main.tsx': '', 'src/router/index.ts': '' })
    const r = await reactAdapter.extractSlots(
      npmManifests({ react: '^18', 'react-router-dom': '^6' }),
      baseIdentity({ framework: 'react' }),
      repo,
    )
    expect(r.routing_files).toContain('src/router/index.ts')
    expect(r.needsLLMRouting).toBe(false)
  })

  it('R7: router lib + 위치 미발견 → needsLLMRouting=true', async () => {
    const repo = mkRepo('r7', { 'src/main.tsx': '' })
    const r = await reactAdapter.extractSlots(
      npmManifests({ react: '^18', 'react-router-dom': '^6' }),
      baseIdentity({ framework: 'react' }),
      repo,
    )
    expect(r.needsLLMRouting).toBe(true)
  })

  it('R8: HOC 패턴 grep → needsLLMCustomDecorators=true', async () => {
    const repo = mkRepo('r8', {
      'src/main.tsx': '',
      'src/components/auth.tsx': "const Wrapped = withAuth(Component)",
    })
    const r = await reactAdapter.extractSlots(npmManifests({ react: '^18' }), baseIdentity({ framework: 'react' }), repo)
    expect(r.needsLLMCustomDecorators).toBe(true)
  })

  it('R9: Prisma schema가 있으면 React Router data app도 schema_sources에 포함', async () => {
    const repo = mkRepo('r9', {
      'app/routes.ts': '',
      'app/routes/home.tsx': '',
      'prisma/schema.prisma': 'datasource db { provider = "postgresql" }\nmodel Todo { id String @id }',
    })
    const r = await reactAdapter.extractSlots(
      npmManifests({ react: '^19', 'react-router': '^7', prisma: '^7' }),
      baseIdentity({ framework: 'react', orm: 'prisma' }),
      repo,
    )
    expect(r.schema_sources).toEqual([
      { orm: 'prisma', provider: null, schema_paths: ['prisma/schema.prisma'], label: 'main' },
    ])
  })

  it('R10: top-level app entrypoints are collected when src entrypoint chain is absent', async () => {
    const repo = mkRepo('r10', {
      'README.md': '',
      'admin/main.tsx': '',
      'shop/index.jsx': '',
    })
    const r = await reactAdapter.extractSlots(npmManifests({ react: '^18' }), baseIdentity({ framework: 'react' }), repo)
    expect(r.entrypoint_files).toEqual(['admin/main.tsx', 'shop/index.jsx'])
  })

  it('R11: missing packageJson and package without dependency maps are no-router defaults', async () => {
    const repo = mkRepo('r11', { 'src/main.tsx': '' })
    const noPackage = await reactAdapter.extractSlots(
      { packageJson: null, pubspecYaml: null, tsconfig: null, otherManifests: [] },
      baseIdentity({ framework: 'react' }),
      repo,
    )
    const emptyPackage = await reactAdapter.extractSlots(
      { packageJson: {}, pubspecYaml: null, tsconfig: null, otherManifests: [] },
      baseIdentity({ framework: 'react' }),
      repo,
    )
    expect(noPackage.routing_files).toEqual([])
    expect(emptyPackage.routing_files).toEqual([])
  })
})

// ────────────────────────────────────────
// flutter
// ────────────────────────────────────────

describe('flutterAdapter', () => {
  it('L1: BLoC + GoRouter → controller + routing_files 정적', async () => {
    const repo = mkRepo('fl1', {
      'lib/main.dart': "import 'package:go_router/go_router.dart';\nfinal r = GoRouter(routes: []);",
      'lib/screens/home.dart': '',
      'lib/blocs/counter.bloc.dart': '',
    })
    const r = await flutterAdapter.extractSlots(
      pubspecManifests({ flutter: {}, go_router: '^12', flutter_bloc: '^8' }),
      baseIdentity({ framework: 'flutter', type: 'mobile' }),
      repo,
    )
    expect((r.routing_files ?? []).length).toBeGreaterThan(0)
  })

  it('L1b: GoRouter source evidence infers routing_libs even without go_router pubspec dep', async () => {
    const repo = mkRepo('fl1b', {
      'lib/main.dart': "final r = GoRouter(routes: [GoRoute(path: '/home')]);",
    })
    const r = await flutterAdapter.extractSlots(
      pubspecManifests({ flutter: {} }),
      baseIdentity({ framework: 'flutter', type: 'mobile' }),
      repo,
    )
    expect(r.routing_libs).toEqual(['go_router'])
    expect(r.routing_files).toEqual(['lib/main.dart'])
  })

  it('L1c: GetX/AutoRoute/Beamer source evidence infers routing_libs', async () => {
    const repo = mkRepo('fl1c', {
      'lib/main.dart': [
        "final pages = [GetPage(name: '/', page: () => HomePage())];",
        "final routes = [AutoRoute(path: '/books', page: BooksRoute.page)];",
        "class BooksLocation { List<String> get pathPatterns => ['/books']; BeamPage? page; }",
      ].join('\n'),
    })
    const r = await flutterAdapter.extractSlots(
      pubspecManifests({ flutter: {} }),
      baseIdentity({ framework: 'flutter', type: 'mobile' }),
      repo,
    )
    expect(r.routing_libs).toEqual(['get', 'auto_route', 'beamer'])
    expect(r.routing_files).toEqual(['lib/main.dart'])
  })

  it('L2: Navigator 1.0 → routing_files=[]', async () => {
    const repo = mkRepo('fl2', {
      'lib/main.dart': "void main() { runApp(MyApp()); }",
      'lib/screens/home.dart': '',
    })
    const r = await flutterAdapter.extractSlots(
      pubspecManifests({ flutter: {} }),
      baseIdentity({ framework: 'flutter', type: 'mobile' }),
      repo,
    )
    expect(r.routing_files).toEqual([])
  })

  it('L7: Drift ORM → schema_sources includes Dart table files', async () => {
    const repo = mkRepo('fl7', {
      'lib/main.dart': '',
      'lib/domain/medicine.dart': "class Medicine extends Table {}",
    })
    const r = await flutterAdapter.extractSlots(
      pubspecManifests({ flutter: {}, drift: '^2' }),
      baseIdentity({ framework: 'flutter', orm: 'drift' }),
      repo,
    )
    expect(r.schema_sources).toEqual([
      { orm: 'drift', provider: 'sqlite', schema_paths: ['lib/**/*.dart'], label: 'main' },
    ])
  })

  it('L8: additional main files and missing pubspec dependencies are handled', async () => {
    const repo = mkRepo('fl8', {
      'lib/main.dart': '',
      'lib/main_dev.dart': '',
      'lib/main_stage.dart': '',
    })
    const r = await flutterAdapter.extractSlots(
      { packageJson: null, pubspecYaml: null, tsconfig: null, otherManifests: [] },
      baseIdentity({ framework: 'flutter', type: 'mobile' }),
      repo,
    )
    expect(r.entrypoint_files).toEqual(['lib/main.dart', 'lib/main_dev.dart', 'lib/main_stage.dart'])
  })

  it('L9: routing files that disappear before routing lib inference are skipped', async () => {
    const repo = mkRepo('fl9', { 'lib/main.dart': '' })
    const spy = vi.spyOn(grepHelpers, 'grepFiles').mockResolvedValue(['lib/missing.dart'])
    const r = await flutterAdapter.extractSlots(
      pubspecManifests({ flutter: {} }),
      baseIdentity({ framework: 'flutter', type: 'mobile' }),
      repo,
    )
    expect(r.routing_files).toEqual(['lib/missing.dart'])
    expect(r.routing_libs).toEqual([])
    spy.mockRestore()
  })
})

// ────────────────────────────────────────
// generic
// ────────────────────────────────────────

describe('genericAdapter', () => {
  it('Z4: 호출 시 throw (orchestrator skip 보장 후에만 호출됨)', async () => {
    await expect(
      genericAdapter.extractSlots(npmManifests({}), baseIdentity({ framework: 'other' }), '/tmp/x'),
    ).rejects.toThrow()
  })
})
