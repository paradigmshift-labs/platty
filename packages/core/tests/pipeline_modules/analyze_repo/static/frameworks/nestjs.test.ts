import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { nestjsAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/nestjs.js'
import type { ManifestSet, IdentitySignal } from '@/pipeline_modules/analyze_repo/types.js'

const TMP = resolve(process.cwd(), '.tmp-test-nestjs-adapter')

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
  language: 'typescript',
  language_raw: null,
  framework: 'nestjs',
  framework_raw: null,
  type: 'backend',
  orm: null,
  build_tool: null,
  confidence: 'high',
  reasoning: '',
  ambiguous: false,
}

const baseManifests: ManifestSet = {
  packageJson: { dependencies: { '@nestjs/core': '^10.0.0' } },
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

describe('nestjsAdapter', () => {
  it('N1: prisma 표준 — entrypoint + schema + controller 정적', async () => {
    const repo = mkRepo('n1', {
      'src/main.ts': 'import { NestFactory } from "@nestjs/core";',
      'src/app.module.ts': 'export class AppModule {}',
      'src/orders/orders.controller.ts': '@Controller("orders") export class C {}',
      'prisma/schema.prisma': 'datasource db { provider = "postgresql" }\nmodel User {}',
    })
    const r = await nestjsAdapter.extractSlots(
      { ...baseManifests, packageJson: { dependencies: { '@nestjs/core': '^10', prisma: '^5' } } },
      { ...baseIdentity, orm: 'prisma' },
      repo,
    )
    expect(r.entrypoint_files).toEqual(['src/main.ts', 'src/app.module.ts'])
    expect(r.schema_sources?.[0]?.orm).toBe('prisma')
    expect(r.schema_sources?.[0]?.provider).toBe('postgresql')
    expect(r.schema_sources?.[0]?.schema_paths).toEqual(['prisma/schema.prisma'])
  })

  it('N3: typeorm — entity glob 컨벤션', async () => {
    const repo = mkRepo('n3', { 'src/main.ts': '', 'src/users/user.entity.ts': '' })
    const r = await nestjsAdapter.extractSlots(
      { ...baseManifests, packageJson: { dependencies: { '@nestjs/core': '^10', typeorm: '^0.3' } } },
      { ...baseIdentity, orm: 'typeorm' },
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('typeorm')
    expect(r.schema_sources?.[0]?.schema_paths).toEqual(['src/**/*.entity.ts'])
  })

  it('N4: bullmq dep + workers/ 디렉토리 → entrypoint 정상 추출', async () => {
    const repo = mkRepo('n4', {
      'src/main.ts': '',
      'src/workers/email.worker.ts': '',
      'src/jobs/cleanup.processor.ts': '',
    })
    const r = await nestjsAdapter.extractSlots(
      { ...baseManifests, packageJson: { dependencies: { '@nestjs/core': '^10', bullmq: '^5' } } },
      baseIdentity,
      repo,
    )
    expect(r.entrypoint_files).toContain('src/main.ts')
  })

  it('N5: nestjs 기본 슬롯 안전', async () => {
    const repo = mkRepo('n5', { 'src/main.ts': '' })
    const r = await nestjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    expect(r.schema_sources).toEqual([])
  })

  it('N6: applyDecorators import 검출 → needsLLMCustomDecorators=true', async () => {
    const repo = mkRepo('n6', {
      'src/main.ts': '',
      'src/common/decorators/api-get.ts': "import { applyDecorators, Get } from '@nestjs/common'\nexport const ApiGet = applyDecorators(Get)",
    })
    const r = await nestjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    expect(r.needsLLMCustomDecorators).toBe(true)
  })

  it('N7: applyDecorators 없음 → needsLLMCustomDecorators=false', async () => {
    const repo = mkRepo('n7', { 'src/main.ts': 'import {} from "@nestjs/core"' })
    const r = await nestjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    expect(r.needsLLMCustomDecorators).toBe(false)
  })

  it('N8: monorepo apps/ — entrypoint이 없을 수도 (root에서)', async () => {
    const repo = mkRepo('n8', {
      'apps/admin/src/main.ts': '',
      'apps/user/src/main.ts': '',
    })
    const r = await nestjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    // root에 src/main.ts 없으니 entrypoints 빈
    expect(r.entrypoint_files).toEqual([])
  })

  it('N9: needsLLMCustomDecorators=false + needsLLMRouting=false', async () => {
    const repo = mkRepo('n9', {
      'src/main.ts': '',
      'src/x/x.controller.ts': '',
    })
    const r = await nestjsAdapter.extractSlots(baseManifests, baseIdentity, repo)
    expect(r.needsLLMCustomDecorators).toBe(false)
    expect(r.needsLLMRouting).toBe(false)
  })

  it('N10: drizzle schema가 src/db/schema.ts에 있으면 schema_sources에 포함', async () => {
    const repo = mkRepo('n10', {
      'src/main.ts': '',
      'src/app.controller.ts': '@Controller() export class C {}',
      'src/db/schema.ts': "export const books = pgTable('Books', {})",
    })
    const r = await nestjsAdapter.extractSlots(
      { ...baseManifests, packageJson: { dependencies: { '@nestjs/core': '^10', 'drizzle-orm': '^0.30.0' } } },
      { ...baseIdentity, orm: 'drizzle' },
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('drizzle')
    expect(r.schema_sources?.[0]?.schema_paths).toContain('src/db/schema.ts')
  })

  it('N11: sequelize entity 파일도 schema_sources에 포함', async () => {
    const repo = mkRepo('n11', {
      'src/main.ts': '',
      'src/photo/photo.entity.ts': "import { Table } from 'sequelize-typescript';\n@Table({})\nexport class Photo {}",
    })
    const r = await nestjsAdapter.extractSlots(
      { ...baseManifests, packageJson: { dependencies: { '@nestjs/core': '^11', sequelize: '^6', 'sequelize-typescript': '^2' } } },
      { ...baseIdentity, orm: 'sequelize' },
      repo,
    )
    expect(r.schema_sources?.[0]?.orm).toBe('sequelize')
    expect(r.schema_sources?.[0]?.schema_paths).toContain('src/**/*.entity.ts')
  })

  it('N12: packageJson이 없어도 기본 슬롯은 안전하게 비어 있다', async () => {
    const repo = mkRepo('n12', { 'src/main.ts': '' })
    const r = await nestjsAdapter.extractSlots(
      { packageJson: null, pubspecYaml: null, tsconfig: null, otherManifests: [] },
      baseIdentity,
      repo,
    )
    expect(r.schema_sources).toEqual([])
  })

  it('N12-b: packageJson에 dependency maps가 없어도 기본 슬롯은 안전하다', async () => {
    const repo = mkRepo('n12b', { 'src/main.ts': '' })
    const r = await nestjsAdapter.extractSlots(
      { packageJson: {}, pubspecYaml: null, tsconfig: null, otherManifests: [] },
      baseIdentity,
      repo,
    )
    expect(r.schema_sources).toEqual([])
  })

  it('N13: drizzle config fallback과 no-match fallback을 구분한다', async () => {
    const configRepo = mkRepo('n13-config', { 'drizzle.config.ts': '' })
    const configResult = await nestjsAdapter.extractSlots(
      baseManifests,
      { ...baseIdentity, orm: 'drizzle' },
      configRepo,
    )
    expect(configResult.schema_sources?.[0]?.schema_paths).toEqual(['drizzle.config.ts'])

    const emptyRepo = mkRepo('n13-empty', {})
    const emptyResult = await nestjsAdapter.extractSlots(
      baseManifests,
      { ...baseIdentity, orm: 'drizzle' },
      emptyRepo,
    )
    expect(emptyResult.schema_sources).toEqual([])
  })

  it('N14: mikro-orm, mongoose, unknown ORM branches are stable', async () => {
    const repo = mkRepo('n14', {})
    expect((await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'mikro-orm' }, repo)).schema_sources?.[0]?.orm).toBe('mikro-orm')
    expect((await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'mongoose' }, repo)).schema_sources?.[0]?.orm).toBe('mongoose')
    expect((await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'unknown' }, repo)).schema_sources).toEqual([])
  })

  it('N15: prisma provider parser returns null when missing or unsupported', async () => {
    const missingProviderRepo = mkRepo('n15-missing', { 'prisma/schema.prisma': 'model User { id String @id }' })
    const missing = await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'prisma' }, missingProviderRepo)
    expect(missing.schema_sources?.[0]?.provider).toBeNull()

    const unsupportedProviderRepo = mkRepo('n15-unsupported', { 'prisma/schema.prisma': 'datasource db { provider = "cockroachdb" }' })
    const unsupported = await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'prisma' }, unsupportedProviderRepo)
    expect(unsupported.schema_sources?.[0]?.provider).toBeNull()
  })

  it('N15-b: prisma provider parser ignores generator providers', async () => {
    const repo = mkRepo('n15b-generators', {
      'prisma/schema.prisma': [
        'generator markdown {',
        '  provider = "prisma-markdown"',
        '}',
        '',
        'generator kysely {',
        '  provider = "prisma-kysely"',
        '}',
        '',
        'datasource db {',
        '  provider = "postgresql"',
        '}',
      ].join('\n'),
    })
    const r = await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'prisma' }, repo)
    expect(r.schema_sources?.[0]?.provider).toBe('postgresql')
  })

  it('N16: prisma ORM without schema file returns no schema source', async () => {
    const repo = mkRepo('n16', {})
    const r = await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'prisma' }, repo)
    expect(r.schema_sources).toEqual([])
  })

  it('N17: unreadable prisma schema keeps provider null', async () => {
    const repo = mkRepo('n17', { 'prisma/schema.prisma': 'datasource db { provider = "postgresql" }' })
    const schema = join(repo, 'prisma/schema.prisma')
    chmodSync(schema, 0o000)
    try {
      const r = await nestjsAdapter.extractSlots(baseManifests, { ...baseIdentity, orm: 'prisma' }, repo)
      expect(r.schema_sources?.[0]?.provider).toBeNull()
    } finally {
      chmodSync(schema, 0o644)
    }
  })
})
