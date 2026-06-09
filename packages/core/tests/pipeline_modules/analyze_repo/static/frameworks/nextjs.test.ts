import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { nextjsAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/nextjs.js'
import type { ManifestSet, IdentitySignal } from '@/pipeline_modules/analyze_repo/types.js'

const TMP = resolve(process.cwd(), '.tmp-test-nextjs-adapter')

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

const baseIdentity: IdentitySignal = {
  language: 'typescript', language_raw: null,
  framework: 'nextjs', framework_raw: null,
  type: 'fullstack', orm: null, build_tool: null,
  confidence: 'high', reasoning: '', ambiguous: false,
}

const baseManifests: ManifestSet = {
  packageJson: { dependencies: { next: '^14.0.0' } },
  pubspecYaml: null,
  tsconfig: {},
  otherManifests: [],
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('nextjsAdapter', () => {
  it('X1: app router 표준', async () => {
    const repo = mkRepo('x1', {
      'next.config.js': 'module.exports = {}',
      'app/page.tsx': '',
      'app/api/users/route.ts': '',
    })
    const r = await nextjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    expect(r.routing_files).toContain('next.config.js')
    expect(r.entrypoint_files).toContain('next.config.js')
  })

  it('X8: middleware.ts 검출 → routing_files 포함', async () => {
    const repo = mkRepo('x8', {
      'next.config.js': '',
      'middleware.ts': '// auth middleware',
      'app/page.tsx': '',
    })
    const r = await nextjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    expect(r.routing_files).toContain('middleware.ts')
  })

  it('X11: drizzle schema가 lib/drizzle.ts에 있으면 schema_sources에 포함', async () => {
    const repo = mkRepo('x11', {
      'next.config.js': '',
      'app/page.tsx': '',
      'lib/drizzle.ts': "export const UsersTable = pgTable('profiles', {})",
    })
    const r = await nextjsAdapter.extractSlots(
      baseManifests,
      { ...baseIdentity, orm: 'drizzle' },
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('drizzle')
    expect(r.schema_sources?.[0]?.schema_paths).toContain('lib/drizzle.ts')
  })

  it('X12: kysely schema가 lib/kysely.ts에 있으면 schema_sources에 포함', async () => {
    const repo = mkRepo('x12', {
      'next.config.js': '',
      'app/page.tsx': '',
      'lib/kysely.ts': 'export interface Database { profiles: ProfileTable }',
    })
    const r = await nextjsAdapter.extractSlots(
      baseManifests,
      { ...baseIdentity, orm: 'kysely' },
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('kysely')
    expect(r.schema_sources?.[0]?.schema_paths).toContain('lib/kysely.ts')
  })

  it('X13: typeorm entity가 app/db/entities에 있으면 schema_sources에 포함', async () => {
    const repo = mkRepo('x13', {
      'next.config.js': '',
      'app/page.tsx': '',
      'app/db/entities/Project.ts': '@Entity() export class Project {}',
    })
    const r = await nextjsAdapter.extractSlots(
      baseManifests,
      { ...baseIdentity, orm: 'typeorm' },
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('typeorm')
    expect(r.schema_sources?.[0]?.schema_paths).toContain('app/**/entities/**/*.ts')
  })

  it('X14: mongoose model이 models 디렉터리에 있으면 schema_sources에 포함', async () => {
    const repo = mkRepo('x14', {
      'next.config.js': '',
      'pages/index.tsx': '',
      'models/Pet.ts': 'export default mongoose.model("Pet", PetSchema)',
    })
    const r = await nextjsAdapter.extractSlots(
      baseManifests,
      { ...baseIdentity, orm: 'mongoose' },
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('mongoose')
    expect(r.schema_sources?.[0]?.schema_paths).toContain('models/**/*.ts')
  })

  it('X15: config variants, middleware variants, and no basePath config stay static', async () => {
    const repo = mkRepo('x15', {
      'next.config.mjs': 'export default {}',
      'next.config.ts': 'export default {}',
      'src/middleware.js': '',
    })
    const r = await nextjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    expect(r.entrypoint_files).toEqual(['next.config.mjs', 'next.config.ts'])
    expect(r.routing_files).toEqual(['next.config.mjs', 'next.config.ts', 'src/middleware.js'])
  })

  it('X16: prisma and null ORM schema branches are stable', async () => {
    const prismaRepo = mkRepo('x16-prisma', { 'prisma/schema.prisma': '' })
    expect((await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'prisma' }, prismaRepo)).schema_sources?.[0]?.orm).toBe('prisma')

    const missingPrismaRepo = mkRepo('x16-prisma-missing')
    expect((await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'prisma' }, missingPrismaRepo)).schema_sources).toEqual([])

    const nullOrmRepo = mkRepo('x16-null')
    expect((await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: null }, nullOrmRepo)).schema_sources).toEqual([])
  })

  it('X17: drizzle fallback uses broad schema glob when no concrete file exists', async () => {
    const repo = mkRepo('x17', {})
    const r = await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'drizzle' }, repo)
    expect(r.schema_sources).toEqual([
      { orm: 'drizzle', provider: null, schema_paths: ['drizzle/**/*.ts'], label: 'main' },
    ])
  })

  it('X18: kysely without known DB file returns no schema sources', async () => {
    const repo = mkRepo('x18', {})
    const r = await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'kysely' }, repo)
    expect(r.schema_sources).toEqual([])
  })

  it('X19: objection, knex, typeorm, and mongoose no-match branches return []', async () => {
    const repo = mkRepo('x19', {})
    for (const orm of ['objection', 'knex', 'typeorm', 'mongoose']) {
      const r = await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm }, repo)
      expect(r.schema_sources).toEqual([])
    }
  })

  it('X20: objection and knex matched schemas are returned', async () => {
    const objectionRepo = mkRepo('x20-objection', { 'models/User.ts': '' })
    const objection = await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'objection' }, objectionRepo)
    expect(objection.schema_sources?.[0]?.schema_paths).toContain('models/**/*.ts')

    const knexRepo = mkRepo('x20-knex', { 'migrations/001.ts': '' })
    const knex = await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'knex' }, knexRepo)
    expect(knex.schema_sources?.[0]?.schema_paths).toContain('migrations/**/*.ts')
  })

  it('X21: unsupported ORM returns no schema sources', async () => {
    const repo = mkRepo('x21', {})
    const r = await nextjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'unknown' }, repo)
    expect(r.schema_sources).toEqual([])
  })

})
