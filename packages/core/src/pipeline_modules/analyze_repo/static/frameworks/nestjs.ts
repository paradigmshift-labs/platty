/*
 * NestJS adapter.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.1
 *
 * 룰:
 *   - entrypoint_files: src/main.ts + src/app.module.ts (각 존재 시 추가)
 *   - schema_sources: orm별 분기 (prisma/typeorm/drizzle/...)
 *   - routing_files: [] (nestjs는 module 트리 — controller 탐색은 build_route가 code_graph에서 수행)
 *   - needsLLMCustomDecorators: applyDecorators import grep 시 true
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FrameworkAdapter } from './_base.js'
import type { ManifestSet, StandardSlots, SchemaSourceFromLLM } from '../../types.js'
import { globHasAny, safeGlob } from '../helpers/glob.js'
import { grepHasAny } from '../helpers/grep.js'

export const nestjsAdapter: FrameworkAdapter = {
  framework: 'nestjs',
  async extractSlots(manifests, identity, repoPath, signal): Promise<Partial<StandardSlots>> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const npmDeps = collectNpmDeps(manifests)
    void identity

    // ── entrypoint_files ──
    const entrypoints: string[] = []
    if (existsSync(resolve(repoPath, 'src/main.ts'))) entrypoints.push('src/main.ts')
    if (existsSync(resolve(repoPath, 'src/app.module.ts'))) entrypoints.push('src/app.module.ts')

    // ── schema_sources ──
    const schemaSources = await detectNestjsSchemaSources(npmDeps, identity.orm, repoPath, signal)

    // ── needsLLMCustomDecorators (applyDecorators import grep) ──
    const hasApplyDecorators = await grepHasAny(
      'src/**/*.ts',
      'applyDecorators',
      repoPath,
      signal,
    )

    return {
      entrypoint_files: entrypoints,
      schema_sources: schemaSources,
      routing_files: [],
      needsLLMRouting: false,
      needsLLMCustomDecorators: hasApplyDecorators,
    }
  },
}

function collectNpmDeps(manifests: ManifestSet): Record<string, string> {
  if (manifests.packageJson === null) return {}
  return {
    ...(manifests.packageJson.dependencies ?? {}),
    ...(manifests.packageJson.devDependencies ?? {}),
  }
}

async function detectNestjsSchemaSources(
  _deps: Record<string, string>,
  orm: string | null,
  repoPath: string,
  signal?: AbortSignal,
): Promise<SchemaSourceFromLLM[]> {
  if (orm === null) return []

  if (orm === 'prisma') {
    const path = 'prisma/schema.prisma'
    if (existsSync(resolve(repoPath, path))) {
      return [{ orm: 'prisma', provider: detectPrismaProvider(repoPath), schema_paths: [path], label: 'main' }]
    }
    return []
  }

  if (orm === 'drizzle') {
    const schemaCandidates = [
      'src/db/schema.ts',
      'src/db/schema/**/*.ts',
      'src/database/schema.ts',
      'src/database/schema/**/*.ts',
      'src/schema.ts',
      'drizzle/**/*.ts',
    ]
    const schemaPaths: string[] = []
    for (const candidate of schemaCandidates) {
      const hasMatch = candidate.includes('*')
        ? (await safeGlob(candidate, repoPath, signal)).matches.length > 0
        : existsSync(resolve(repoPath, candidate))
      if (hasMatch) schemaPaths.push(candidate)
    }
    if (schemaPaths.length > 0) {
      return [{ orm: 'drizzle', provider: null, schema_paths: schemaPaths, label: 'main' }]
    }

    const configCandidates = ['drizzle.config.ts', 'drizzle.config.js']
    for (const c of configCandidates) {
      if (existsSync(resolve(repoPath, c))) {
        return [{ orm: 'drizzle', provider: null, schema_paths: [c], label: 'main' }]
      }
    }
    return []
  }

  if (orm === 'typeorm') {
    // Entity glob 컨벤션. build_models 단계에서 실제 모델 파싱을 정밀화한다.
    return [{ orm: 'typeorm', provider: null, schema_paths: ['src/**/*.entity.ts'], label: 'main' }]
  }

  if (orm === 'mikro-orm') {
    return [{ orm: 'mikro-orm', provider: null, schema_paths: ['src/**/*.entity.ts'], label: 'main' }]
  }

  if (orm === 'sequelize') {
    const schemaPaths = ['src/**/*.model.ts']
    if (await globHasAny('src/**/*.entity.ts', repoPath, signal)) schemaPaths.push('src/**/*.entity.ts')
    return [{ orm: 'sequelize', provider: null, schema_paths: schemaPaths, label: 'main' }]
  }

  if (orm === 'mongoose') {
    return [{ orm: 'mongoose', provider: null, schema_paths: ['src/**/*.schema.ts'], label: 'main' }]
  }

  return []
}

function detectPrismaProvider(repoPath: string): SchemaSourceFromLLM['provider'] {
  try {
    const content = readFileSync(resolve(repoPath, 'prisma/schema.prisma'), 'utf-8')
    const datasource = content.match(/datasource\s+db\s*\{([\s\S]*?)\}/)
    if (!datasource) return null
    const m = datasource[1].match(/provider\s*=\s*["']([^"']+)["']/)
    if (!m) return null
    const v = m[1].toLowerCase()
    if (v === 'postgresql' || v === 'mysql' || v === 'sqlite' || v === 'mongodb' || v === 'mariadb') {
      return v
    }
    return null
  } catch {
    return null
  }
}
