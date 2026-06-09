/*
 * Next.js adapter.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.2
 *
 * 룰:
 *   - entrypoint_files: next.config.{js,mjs,ts} (각 존재 시)
 *   - schema_sources: orm 따라 (nestjs와 동일)
 *   - routing_files: next.config.* + middleware/proxy files
 *   - needsLLMApiBasePaths: next.config.basePath 정적 리터럴 시도, 동적이면 true
 *   (controller/page 패턴 탐색 제거 — build_route가 code_graph에서 직접 수행)
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FrameworkAdapter } from './_base.js'
import type { StandardSlots, SchemaSourceFromLLM } from '../../types.js'
import { safeGlob } from '../helpers/glob.js'

const NEXT_CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts']

export const nextjsAdapter: FrameworkAdapter = {
  framework: 'nextjs',
  async extractSlots(_manifests, identity, repoPath, signal): Promise<Partial<StandardSlots>> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    void identity

    // ── routing_files / entrypoint_files ──
    // middleware/proxy alter request routing, but they are not app bootstrap entrypoints.
    const routingFiles: string[] = []
    const entrypointFiles: string[] = []
    for (const cfg of NEXT_CONFIG_FILES) {
      if (existsSync(resolve(repoPath, cfg))) {
        routingFiles.push(cfg)
        entrypointFiles.push(cfg)
      }
    }
    for (const mw of [
      'middleware.ts',
      'middleware.js',
      'src/middleware.ts',
      'src/middleware.js',
      'proxy.ts',
      'proxy.js',
      'src/proxy.ts',
      'src/proxy.js',
    ]) {
      if (existsSync(resolve(repoPath, mw))) {
        routingFiles.push(mw)
      }
    }

    // ── schema_sources ──
    const schemaSources = await detectNextjsSchemaSources(identity.orm, repoPath)

    return {
      entrypoint_files: entrypointFiles,
      schema_sources: schemaSources,
      routing_files: routingFiles,
      needsLLMRouting: false,
      needsLLMCustomDecorators: false,
    }
  },
}


async function detectNextjsSchemaSources(
  orm: string | null,
  repoPath: string,
): Promise<SchemaSourceFromLLM[]> {
  if (orm === null) return []
  if (orm === 'prisma') {
    if (existsSync(resolve(repoPath, 'prisma/schema.prisma'))) {
      return [{ orm: 'prisma', provider: null, schema_paths: ['prisma/schema.prisma'], label: 'main' }]
    }
    return []
  }
  if (orm === 'drizzle') {
    const candidates = [
      'drizzle/**/*.ts',
      'db/schema.ts',
      'db/schema/**/*.ts',
      'src/db/schema.ts',
      'src/db/schema/**/*.ts',
      'lib/db/schema.ts',
      'lib/db/schema/**/*.ts',
      'src/lib/db/schema.ts',
      'src/lib/db/schema/**/*.ts',
      'lib/drizzle.ts',
      'src/lib/drizzle.ts',
    ]
    const schemaPaths: string[] = []
    for (const candidate of candidates) {
      const hasMatch = candidate.includes('*')
        ? (await safeGlob(candidate, repoPath)).matches.length > 0
        : existsSync(resolve(repoPath, candidate))
      if (hasMatch) schemaPaths.push(candidate)
    }
    if (schemaPaths.length === 0) {
      return [{ orm: 'drizzle', provider: null, schema_paths: ['drizzle/**/*.ts'], label: 'main' }]
    }
    return [{ orm: 'drizzle', provider: null, schema_paths: schemaPaths, label: 'main' }]
  }
  if (orm === 'kysely') {
    const candidates = [
      'lib/kysely.ts',
      'src/lib/kysely.ts',
      'db/kysely.ts',
      'src/db/kysely.ts',
      'lib/db.ts',
      'src/lib/db.ts',
    ]
    const schemaPaths = candidates.filter((candidate) => existsSync(resolve(repoPath, candidate)))
    if (schemaPaths.length === 0) return []
    return [{ orm: 'kysely', provider: null, schema_paths: schemaPaths, label: 'main' }]
  }
  if (orm === 'objection') {
    const candidates = [
      'database/Models/**/*.ts',
      'database/models/**/*.ts',
      'models/**/*.ts',
      'src/models/**/*.ts',
      'database/migrations/**/*.ts',
      'migrations/**/*.ts',
    ]
    const schemaPaths: string[] = []
    for (const candidate of candidates) {
      if ((await safeGlob(candidate, repoPath)).matches.length > 0) schemaPaths.push(candidate)
    }
    if (schemaPaths.length === 0) return []
    return [{ orm: 'objection', provider: null, schema_paths: schemaPaths, label: 'main' }]
  }
  if (orm === 'knex') {
    const candidates = [
      'knex/migrations/**/*.js',
      'knex/migrations/**/*.ts',
      'database/migrations/**/*.js',
      'database/migrations/**/*.ts',
      'migrations/**/*.js',
      'migrations/**/*.ts',
    ]
    const schemaPaths: string[] = []
    for (const candidate of candidates) {
      if ((await safeGlob(candidate, repoPath)).matches.length > 0) schemaPaths.push(candidate)
    }
    if (schemaPaths.length === 0) return []
    return [{ orm: 'knex', provider: null, schema_paths: schemaPaths, label: 'main' }]
  }
  if (orm === 'typeorm') {
    const candidates = [
      'app/**/*.entity.ts',
      'app/**/entities/**/*.ts',
      'src/app/**/*.entity.ts',
      'src/app/**/entities/**/*.ts',
      'db/**/*.entity.ts',
      'db/**/entities/**/*.ts',
      'src/db/**/*.entity.ts',
      'src/db/**/entities/**/*.ts',
      'entities/**/*.ts',
      'src/entities/**/*.ts',
    ]
    const schemaPaths: string[] = []
    for (const candidate of candidates) {
      if ((await safeGlob(candidate, repoPath)).matches.length > 0) schemaPaths.push(candidate)
    }
    if (schemaPaths.length === 0) return []
    return [{ orm: 'typeorm', provider: null, schema_paths: schemaPaths, label: 'main' }]
  }
  if (orm === 'mongoose') {
    const candidates = [
      'models/**/*.js',
      'models/**/*.ts',
      'src/models/**/*.js',
      'src/models/**/*.ts',
      'lib/models/**/*.js',
      'lib/models/**/*.ts',
      'src/lib/models/**/*.js',
      'src/lib/models/**/*.ts',
    ]
    const schemaPaths: string[] = []
    for (const candidate of candidates) {
      if ((await safeGlob(candidate, repoPath)).matches.length > 0) schemaPaths.push(candidate)
    }
    if (schemaPaths.length === 0) return []
    return [{ orm: 'mongoose', provider: null, schema_paths: schemaPaths, label: 'main' }]
  }
  return []
}
