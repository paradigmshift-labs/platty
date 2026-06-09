import { describe, expect, it } from 'vitest'
import {
  activateDefaultRuleIds,
  lookupStaticAnalysisRole,
  supportedStaticAnalysisEcosystems,
} from '@/pipeline_modules/shared/static_config/role_registry/index.js'

describe('static analysis role registry', () => {
  it('returns deterministic official TypeScript package role metadata', () => {
    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: '@prisma/client' }))
      .toMatchObject({
        ecosystem: 'typescript',
        packageName: '@prisma/client',
        role: 'db_client',
        curation: 'official',
        confidence: 'high',
        defaultRuleIds: expect.arrayContaining(['db.prisma.direct']),
      })
  })

  it('activates the TypeORM getRepository factory default rules', () => {
    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: 'typeorm' }))
      .toMatchObject({
        ecosystem: 'typescript',
        packageName: 'typeorm',
        role: 'db_client',
        curation: 'official',
        confidence: 'high',
        defaultRuleIds: expect.arrayContaining(['db.typeorm.getRepository']),
      })

    expect(activateDefaultRuleIds([{ ecosystem: 'typescript', packageName: 'typeorm' }]))
      .toEqual(expect.arrayContaining([
        'db.typeorm.getRepository',
        'db.typeorm.datasource-getRepository',
        'db.typeorm.this-datasource-getRepository',
        'db.typeorm.manager-getRepository',
      ]))
  })

  it('activates the Drizzle relational query default rules', () => {
    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: 'drizzle-orm/libsql' }))
      .toMatchObject({
        ecosystem: 'typescript',
        packageName: 'drizzle-orm',
        role: 'db_client',
        curation: 'official',
        confidence: 'high',
        defaultRuleIds: expect.arrayContaining(['db.drizzle.query-relational']),
      })

    expect(activateDefaultRuleIds([{ ecosystem: 'typescript', packageName: 'drizzle-orm' }]))
      .toEqual(['db.drizzle.query-relational'])
  })

  it('activates the Mongoose NestJS injected-model default rules', () => {
    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: 'mongoose' }))
      .toMatchObject({
        ecosystem: 'typescript',
        packageName: 'mongoose',
        role: 'db_client',
        curation: 'official',
        confidence: 'high',
        defaultRuleIds: expect.arrayContaining(['db.mongoose.this-model']),
      })

    expect(activateDefaultRuleIds([{ ecosystem: 'typescript', packageName: 'mongoose' }]))
      .toEqual(['db.mongoose.this-model'])
  })

  it('normalizes Dart package import specifiers', () => {
    expect(lookupStaticAnalysisRole({ ecosystem: 'dart', packageName: 'package:go_router/go_router.dart' }))
      .toMatchObject({
        ecosystem: 'dart',
        packageName: 'go_router',
        role: 'mobile_navigation',
        curation: 'official',
        confidence: 'high',
      })
  })

  it('normalizes JavaScript and package subpath import specifiers', () => {
    expect(lookupStaticAnalysisRole({ ecosystem: 'javascript', packageName: '@prisma/client/runtime/library' }))
      .toMatchObject({
        ecosystem: 'typescript',
        packageName: '@prisma/client',
        role: 'db_client',
      })
    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: 'axios/index.js' }))
      .toMatchObject({
        packageName: 'axios',
        role: 'api_client',
      })
  })

  it('does not activate unknown, community, or heuristic entries as default config', () => {
    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: 'unknown-router' }))
      .toBeNull()

    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: '@trpc/server' }))
      .toMatchObject({
        curation: 'community',
        confidence: 'medium',
      })
    expect(lookupStaticAnalysisRole({ ecosystem: 'typescript', packageName: 'internal-http-client' }))
      .toMatchObject({
        curation: 'heuristic',
        confidence: 'low',
      })

    expect(activateDefaultRuleIds([
      { ecosystem: 'typescript', packageName: '@trpc/server' },
      { ecosystem: 'typescript', packageName: 'internal-http-client' },
      { ecosystem: 'typescript', packageName: 'unknown-router' },
    ])).toEqual([])
  })

  it('keeps Java, Kotlin, and Swift ecosystems available without curated entries yet', () => {
    expect(supportedStaticAnalysisEcosystems()).toEqual(expect.arrayContaining([
      'java',
      'kotlin',
      'swift',
    ]))
    expect(lookupStaticAnalysisRole({ ecosystem: 'java', packageName: 'org.springframework.web.bind.annotation' }))
      .toBeNull()
  })
})
