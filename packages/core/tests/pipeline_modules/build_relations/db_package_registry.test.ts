import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DB_CLIENT_PACKAGE_SET,
  detectOrmFromPackage,
  isDbClientPackage,
  isKnexPackage,
  isKyselyPackage,
  isMikroOrmPackage,
  isMongoosePackage,
  isRedisPackage,
  isSequelizePackage,
  isSqflitePackage,
  isSupabaseDbPackage,
} from '@/pipeline_modules/build_relations/adapters/db/packages.js'

const SOURCE_PATHS = {
  semanticIndex: 'src/pipeline_modules/build_relations/semantic_index.ts',
  receiverIdentity: 'src/pipeline_modules/build_relations/graph_trace/receiver_identity.ts',
  dbAccessCandidate: 'src/pipeline_modules/build_relations/candidates/db_access.ts',
  knex: 'src/pipeline_modules/build_relations/adapters/db/knex.ts',
  kysely: 'src/pipeline_modules/build_relations/adapters/db/kysely.ts',
  mikroorm: 'src/pipeline_modules/build_relations/adapters/db/mikroorm.ts',
  mongoose: 'src/pipeline_modules/build_relations/adapters/db/mongoose.ts',
  redis: 'src/pipeline_modules/build_relations/adapters/db/redis.ts',
  sequelize: 'src/pipeline_modules/build_relations/adapters/db/sequelize.ts',
  sqflite: 'src/pipeline_modules/build_relations/adapters/db/sqflite.ts',
  supabase: 'src/pipeline_modules/build_relations/adapters/db/supabase.ts',
} as const

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('DB package registry', () => {
  it('owns DB package family detection from one registry', () => {
    expect(isDbClientPackage('@prisma/client')).toBe(true)
    expect(isDbClientPackage('@nestjs/typeorm')).toBe(true)
    expect(isDbClientPackage('package:sqflite/sqflite.dart')).toBe(true)
    expect(isKnexPackage('knex')).toBe(true)
    expect(isKyselyPackage('kysely')).toBe(true)
    expect(isMikroOrmPackage('@mikro-orm/core')).toBe(true)
    expect(isMongoosePackage('@nestjs/mongoose')).toBe(true)
    expect(isRedisPackage('ioredis')).toBe(true)
    expect(isSequelizePackage('sequelize-typescript')).toBe(true)
    expect(isSqflitePackage('sqflite')).toBe(true)
    expect(isSupabaseDbPackage('package:supabase_flutter/supabase_flutter.dart')).toBe(true)
    expect(DB_CLIENT_PACKAGE_SET.has('better-sqlite3')).toBe(true)
    expect(isDbClientPackage('not-a-db-client')).toBe(false)
  })

  it('maps package families to ORM names without owning package checks in callers', () => {
    expect(detectOrmFromPackage('@prisma/client')).toBe('prisma')
    expect(detectOrmFromPackage('@nestjs/typeorm')).toBe('typeorm')
    expect(detectOrmFromPackage('mongoose')).toBe('mongoose')
    expect(detectOrmFromPackage('@nestjs/sequelize')).toBe('sequelize')
    expect(detectOrmFromPackage('drizzle-orm')).toBe('drizzle')
    expect(detectOrmFromPackage('knex')).toBe('knex')
    expect(detectOrmFromPackage('kysely')).toBe('kysely')
    expect(detectOrmFromPackage('ioredis')).toBe('redis')
    expect(detectOrmFromPackage('@supabase/supabase-js')).toBe('supabase')
    expect(detectOrmFromPackage('@mikro-orm/core')).toBe('mikroorm')
    expect(detectOrmFromPackage('package:sqflite/sqflite.dart')).toBe('sqflite')
    expect(detectOrmFromPackage('pg')).toBe('unknown')
  })

  it('keeps shared DB wrapper and candidate detection delegated to the registry', () => {
    const semanticIndex = readSource(SOURCE_PATHS.semanticIndex)
    const receiverIdentity = readSource(SOURCE_PATHS.receiverIdentity)
    const dbAccessCandidate = readSource(SOURCE_PATHS.dbAccessCandidate)

    expect(semanticIndex).toContain('isDbClientPackage')
    expect(receiverIdentity).toContain('isDbClientPackage')
    expect(receiverIdentity).toContain('detectOrmFromPackage')
    expect(dbAccessCandidate).toContain('isDbClientPackage')
    expect(dbAccessCandidate).toContain('detectOrmFromPackage')

    expect(semanticIndex).not.toContain('const DB_PACKAGES')
    expect(receiverIdentity).not.toContain('const DB_PACKAGES')
    expect(dbAccessCandidate).not.toContain('const ORM_PACKAGES')
  })

  it('keeps DB adapter package checks delegated to package-family helpers', () => {
    const adapterSources = {
      knex: readSource(SOURCE_PATHS.knex),
      kysely: readSource(SOURCE_PATHS.kysely),
      mikroorm: readSource(SOURCE_PATHS.mikroorm),
      mongoose: readSource(SOURCE_PATHS.mongoose),
      redis: readSource(SOURCE_PATHS.redis),
      sequelize: readSource(SOURCE_PATHS.sequelize),
      sqflite: readSource(SOURCE_PATHS.sqflite),
      supabase: readSource(SOURCE_PATHS.supabase),
    }

    expect(adapterSources.knex).toContain('isKnexPackage')
    expect(adapterSources.kysely).toContain('isKyselyPackage')
    expect(adapterSources.mikroorm).toContain('isMikroOrmPackage')
    expect(adapterSources.mongoose).toContain('isMongoosePackage')
    expect(adapterSources.redis).toContain('isRedisPackage')
    expect(adapterSources.sequelize).toContain('isSequelizePackage')
    expect(adapterSources.sqflite).toContain('isSqflitePackage')
    expect(adapterSources.supabase).toContain('isSupabaseDbPackage')

    expect(adapterSources.mikroorm).not.toContain("pkg === '@mikro-orm/core'")
    expect(adapterSources.mongoose).not.toContain("pkg === 'mongoose'")
    expect(adapterSources.redis).not.toContain("pkg === 'redis'")
    expect(adapterSources.sequelize).not.toContain("pkg === 'sequelize'")
    expect(adapterSources.sqflite).not.toContain("pkg === 'sqflite'")
    expect(adapterSources.supabase).not.toContain("pkg === '@supabase/supabase-js'")
  })
})
