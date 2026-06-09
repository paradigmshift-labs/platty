/*
 * Express adapter.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.3
 *
 * 룰:
 *   - entrypoint_files: fallback chain (src/index.ts → src/app.ts → src/server.ts → src/main.ts → index.js)
 *   - schema_sources: orm 따라
 *   - routing_files: [] + needsLLMRouting=false (build_route code graph 스캔이 더 정확함)
 *   - needsLLMApiBasePaths: 항상 true
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FrameworkAdapter } from './_base.js'
import type { StandardSlots, SchemaSourceFromLLM } from '../../types.js'

const ENTRYPOINT_CHAIN = [
  'src/index.ts', 'src/app.ts', 'src/server.ts', 'src/main.ts',
  'index.ts', 'app.ts', 'server.ts',
  'src/index.js', 'src/app.js', 'src/server.js', 'index.js', 'app.js', 'server.js',
]

export const expressAdapter: FrameworkAdapter = {
  framework: 'express',
  async extractSlots(_manifests, identity, repoPath, signal): Promise<Partial<StandardSlots>> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const entrypoints: string[] = []
    for (const candidate of ENTRYPOINT_CHAIN) {
      if (existsSync(resolve(repoPath, candidate))) {
        entrypoints.push(candidate)
        break // 첫 번째 매칭만 (express는 단일 entry)
      }
    }

    const schemaSources = expressSchemaSources(identity.orm, _manifests.packageJson, repoPath)

    return {
      entrypoint_files: entrypoints,
      schema_sources: schemaSources,
      routing_files: [],
      needsLLMRouting: false,
      needsLLMCustomDecorators: false,
    }
  },
}

function expressSchemaSources(
  orm: string | null,
  packageJson: Record<string, unknown> | null,
  repoPath: string,
): SchemaSourceFromLLM[] {
  if (orm === null) return []
  switch (orm) {
    case 'prisma':
      return [{ orm: 'prisma', provider: null, schema_paths: [resolveExpressPrismaSchemaPath(packageJson, repoPath)], label: 'main' }]
    case 'drizzle':
      return [{ orm: 'drizzle', provider: null, schema_paths: ['src/db/schema/**/*.ts'], label: 'main' }]
    case 'typeorm':
      return [{ orm: 'typeorm', provider: null, schema_paths: resolveExpressTypeormSchemaPaths(repoPath), label: 'main' }]
    case 'sequelize':
      return [{ orm: 'sequelize', provider: null, schema_paths: resolveExpressSequelizeSchemaPaths(repoPath), label: 'main' }]
    case 'mongoose':
      return [{ orm: 'mongoose', provider: null, schema_paths: resolveExpressMongooseSchemaPaths(repoPath), label: 'main' }]
    case 'mikro-orm':
      return [{ orm: 'mikro-orm', provider: null, schema_paths: resolveExpressMikroOrmSchemaPaths(repoPath), label: 'main' }]
    default:
      return []
  }
}

function resolveExpressPrismaSchemaPath(packageJson: Record<string, unknown> | null, repoPath: string): string {
  const prismaConfig = packageJson?.['prisma']
  if (typeof prismaConfig === 'object' && prismaConfig !== null) {
    const schema = (prismaConfig as Record<string, unknown>)['schema']
    if (typeof schema === 'string' && schema.length > 0) {
      if (existsSync(resolve(repoPath, schema)) && !schema.endsWith('.prisma')) {
        return `${schema.replace(/\/$/, '')}/*.prisma`
      }
      return schema
    }
  }

  for (const candidate of ['prisma/schema.prisma', 'src/prisma/schema.prisma']) {
    if (existsSync(resolve(repoPath, candidate))) return candidate
  }
  if (existsSync(resolve(repoPath, 'prisma/schema'))) return 'prisma/schema/*.prisma'
  if (existsSync(resolve(repoPath, 'src/prisma/schema'))) return 'src/prisma/schema/*.prisma'
  return 'prisma/schema.prisma'
}

function resolveExpressTypeormSchemaPaths(repoPath: string): string[] {
  const candidates = [
    'src/**/*.entity.ts',
    'src/entity/**/*.ts',
    'src/entities/**/*.ts',
  ]
  const existing = candidates.filter((candidate) => {
    const baseDir = candidate.slice(0, candidate.indexOf('/**'))
    return existsSync(resolve(repoPath, baseDir))
  })
  return existing.length > 0 ? existing : ['src/**/*.entity.ts']
}

function resolveExpressSequelizeSchemaPaths(repoPath: string): string[] {
  const candidates = [
    'src/**/*.model.ts',
    'src/**/*.model.js',
    'sequelize/models/*.js',
    'sequelize/models/*.ts',
  ]
  const existing = candidates.filter((candidate) => {
    /* v8 ignore next -- Sequelize candidates currently all use wildcard conventions. */
    const base = candidate.includes('*') ? candidate.slice(0, candidate.indexOf('*')).replace(/\/$/, '') : candidate
    return existsSync(resolve(repoPath, base))
  })
  return existing.length > 0 ? existing : ['src/**/*.model.ts']
}

function resolveExpressMongooseSchemaPaths(repoPath: string): string[] {
  const candidates = [
    'src/**/*.schema.ts',
    'src/**/*.model.ts',
    'src/**/*.model.js',
    'server/**/*.model.js',
    'server/**/*.schema.js',
    'models/**/*.js',
    'models/**/*.ts',
  ]
  const existing = candidates.filter((candidate) => {
    /* v8 ignore next -- Mongoose candidates currently all use wildcard conventions. */
    const base = candidate.includes('*') ? candidate.slice(0, candidate.indexOf('*')).replace(/\/$/, '') : candidate
    return existsSync(resolve(repoPath, base))
  })
  return existing.length > 0 ? existing : ['src/**/*.schema.ts']
}

function resolveExpressMikroOrmSchemaPaths(repoPath: string): string[] {
  const candidates = [
    'src/**/*.entity.ts',
    'src/**/*.entity.js',
    'src/entities/**/*.ts',
    'src/entities/**/*.js',
    'app/entities/**/*.ts',
    'app/entities/**/*.js',
  ]
  const existing = candidates.filter((candidate) => {
    /* v8 ignore next -- MikroORM candidates currently all use wildcard conventions. */
    const base = candidate.includes('*') ? candidate.slice(0, candidate.indexOf('*')).replace(/\/$/, '') : candidate
    return existsSync(resolve(repoPath, base))
  })
  return existing.length > 0 ? existing : ['src/**/*.entity.ts']
}
