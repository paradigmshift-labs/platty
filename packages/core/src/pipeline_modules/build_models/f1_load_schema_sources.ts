import path from 'path'
import fs from 'fs'
import fg from 'fast-glob'
import type { BuildModelsAdapter, LoadedSource } from './types.js'
import type { SchemaSource } from '@/db/schema/json_types/schema_source.js'
import { PrismaAdapter } from './adapters/prisma.js'
import { TypeOrmGraphAdapter } from './adapters/typeorm.js'
import { DrizzleAdapter } from './adapters/drizzle.js'
import { MikroOrmGraphAdapter } from './adapters/mikro_orm.js'
import { SequelizeAdapter } from './adapters/sequelize.js'
import { MongooseAdapter } from './adapters/mongoose.js'
import { KyselyAdapter } from './adapters/kysely.js'
import { ObjectionAdapter } from './adapters/objection.js'
import { KnexAdapter } from './adapters/knex.js'
import { DriftAdapter } from './adapters/drift.js'
import { JpaGraphAdapter } from './adapters/jpa.js'
import { getRepositoryPaths } from '@/repo/repository-paths.js'

// ─── 기본 어댑터 레지스트리 ──────────────────────────────────────────────────

export const DEFAULT_ADAPTER_REGISTRY: Map<string, () => BuildModelsAdapter> = new Map<string, () => BuildModelsAdapter>([
  ['prisma', () => new PrismaAdapter()],
  ['typeorm', () => new TypeOrmGraphAdapter()],
  ['drizzle', () => new DrizzleAdapter()],
  ['mikro-orm', () => new MikroOrmGraphAdapter()],
  ['sequelize', () => new SequelizeAdapter()],
  ['mongoose', () => new MongooseAdapter()],
  ['kysely', () => new KyselyAdapter()],
  ['objection', () => new ObjectionAdapter()],
  ['knex', () => new KnexAdapter()],
  ['drift', () => new DriftAdapter()],
  ['jpa', () => new JpaGraphAdapter()],
])

// ─── Path Traversal 방어 ──────────────────────────────────────────────────────

/**
 * targetPath가 repoPath 내부(또는 동일)에 있는지 확인한다.
 * symlink 해소 후 비교하여 symlink 기반 탈출 공격도 방어한다.
 */
export function assertWithinRepoPath(repoPath: string, targetPath: string): boolean {
  if (targetPath.includes('\x00')) return false

  let resolvedRepo: string
  try {
    resolvedRepo = fs.realpathSync(repoPath)
  } catch {
    resolvedRepo = path.resolve(repoPath)
  }

  let resolvedTarget: string
  try {
    resolvedTarget = fs.realpathSync(targetPath)
  } catch {
    resolvedTarget = path.resolve(targetPath)
  }

  return resolvedTarget.startsWith(resolvedRepo + path.sep) || resolvedTarget === resolvedRepo
}

// ─── F1 loadSchemaSources ────────────────────────────────────────────────────

export function loadSchemaSources(
  repo: {
    id: string
    repoPath: string
    analysisWorktreePath?: string | null
    sourceRoot?: string | null
    schemaSources: SchemaSource[] | null | undefined
  },
  adapterRegistry: Map<string, () => BuildModelsAdapter>,
): LoadedSource[] {
  if (!repo.schemaSources || repo.schemaSources.length === 0) return []

  const paths = getRepositoryPaths(repo)
  const result: LoadedSource[] = []

  for (const source of repo.schemaSources) {
    const factory = adapterRegistry.get(source.orm)
    if (!factory) {
      console.warn(`[F1] unsupported ORM '${source.orm}', skipping`)
      continue
    }

    const adapter = factory()

    let absolutePaths: string[] = []

    if (adapter.strategy === 'dsl-parse') {
      if (source.schema_paths.length === 0) {
        console.warn(`[F1] ORM '${source.orm}' has no schema_paths, skipping`)
        continue
      }

      absolutePaths = expandSchemaPaths(paths.analysisRoot, source.schema_paths)

      let traversalDetected = false
      for (const absPath of absolutePaths) {
        if (!assertWithinRepoPath(paths.analysisRoot, absPath)) {
          console.warn(`[F1] path '${absPath}' escapes repoPath, skipping entire source`)
          traversalDetected = true
          break
        }
      }
      if (traversalDetected) continue
    }

    result.push({ source, adapter, strategy: adapter.strategy, absolutePaths })
  }

  return result
}

function expandSchemaPaths(repoPath: string, schemaPaths: string[]): string[] {
  const out: string[] = []

  for (const schemaPath of schemaPaths) {
    if (hasGlobMagic(schemaPath)) {
      const matches = fg.sync(schemaPath, {
        cwd: path.isAbsolute(schemaPath) ? undefined : repoPath,
        absolute: true,
        onlyFiles: true,
        dot: true,
        followSymbolicLinks: false,
        unique: true,
      })
      out.push(...matches)
      continue
    }

    const absPath = path.isAbsolute(schemaPath) ? schemaPath : path.join(repoPath, schemaPath)
    if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
      const matches = fg.sync('*.prisma', {
        cwd: absPath,
        absolute: true,
        onlyFiles: true,
        dot: true,
        followSymbolicLinks: false,
        unique: true,
      })
      out.push(...matches)
      continue
    }

    out.push(absPath)
  }

  return [...new Set(out)].sort()
}

function hasGlobMagic(schemaPath: string): boolean {
  return /[*?[\]{}()!+@]/.test(schemaPath)
}
