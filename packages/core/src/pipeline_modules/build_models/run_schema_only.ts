/**
 * runSchemaOnly — schema-diversity fixture runner helper.
 *
 * The real `runBuildModels` orchestrator (`./index.ts`) needs a seeded SQLite
 * `repositories` row, optional `build_graph` output, and writes results back
 * into the `models` table. For schema-diversity fixtures we only have a
 * handful of ORM schema *source files* on disk and we want to verify the
 * adapter's deterministic output (F2 parseModels + F3 mergeRelations) without
 * touching the DB.
 *
 * This helper exposes a thin slice that mirrors what F1/F2/F3 do for a
 * dsl-parse adapter:
 *   - resolve the adapter from the registry (or a custom registry)
 *   - ensureReady → collectNames → prepareChunks → parseChunk per chunk
 *   - dedupe duplicate model names across chunks (same rule as F2)
 *   - mergeRelations across the full set
 *   - return ModelRaw[] + skippedFiles
 *
 * It is intentionally schema-only:
 *   - graph-query adapters (TypeORM / JPA / MikroORM defineEntity) are
 *     rejected with a clear error — callers (the schema-only fixture runner)
 *     should skip those fixtures upfront via `requiresBuildGraph: true`.
 *   - F4 validateModels and F5 upsertModels are deliberately *not* executed
 *     because they (a) need verdict policy decisions that are downstream of
 *     pure parser correctness and (b) hit the DB.
 *
 * The companion `normalizeForFixture` utility strips the only known sources
 * of non-determinism in `ModelRaw` so that expected snapshots can be diffed
 * byte-for-byte across machines (absolute `source_file` paths are rewritten
 * relative to the fixture root; line numbers are preserved because they're
 * stable for a given source text).
 */

import type {
  BuildModelsAdapter,
  ModelRaw,
  SchemaFile,
} from './types.js'
import { DEFAULT_ADAPTER_REGISTRY } from './f1_load_schema_sources.js'
import { mergeRelations } from './f3_merge_relations.js'

export type SchemaOnlyOrm = 'prisma' | 'mongoose' | 'drizzle' | 'mikro-orm'

export interface RunSchemaOnlyInput {
  orm: SchemaOnlyOrm | string
  schemaFiles: SchemaFile[]
  _adapterRegistry?: Map<string, () => BuildModelsAdapter>
}

export interface RunSchemaOnlyResult {
  models: ModelRaw[]
  skippedFiles: string[]
}

/**
 * Run F2 (parseModels for a single dsl-parse adapter) + F3 (mergeRelations)
 * over an in-memory schema file set.
 *
 * Throws on:
 *   - unknown ORM (no adapter registered)
 *   - adapter.strategy !== 'dsl-parse' (graph-query needs build_graph; callers
 *     should set `requiresBuildGraph: true` on the fixture and skip it before
 *     calling this helper)
 *   - empty `schemaFiles` (caller bug — fixture should always supply at least
 *     one file)
 */
export async function runSchemaOnly(input: RunSchemaOnlyInput): Promise<RunSchemaOnlyResult> {
  if (input.schemaFiles.length === 0) {
    throw new Error('runSchemaOnly requires at least one schema file')
  }

  const registry = input._adapterRegistry ?? DEFAULT_ADAPTER_REGISTRY
  const factory = registry.get(input.orm)
  if (!factory) {
    throw new Error(`runSchemaOnly: unsupported ORM '${input.orm}'`)
  }

  const adapter = factory()
  if (adapter.strategy !== 'dsl-parse') {
    throw new Error(
      `runSchemaOnly: ORM '${input.orm}' uses '${adapter.strategy}' strategy which requires build_graph; ` +
      `mark the fixture with "requiresBuildGraph": true and skip it.`,
    )
  }

  await adapter.ensureReady?.()

  const ctx = adapter.collectNames!(input.schemaFiles)
  const chunks = adapter.prepareChunks!(input.schemaFiles)

  // F2 dedupe rule: first occurrence wins, later duplicates are dropped.
  // Mirrors `parseModels` in src/pipeline_modules/build_models/f2_parse_models.ts.
  const seenNames = new Set<string>()
  const parsed: ModelRaw[] = []
  const skippedFiles: string[] = []
  for (const chunk of chunks) {
    let chunkModels: ModelRaw[]
    try {
      chunkModels = await adapter.parseChunk!(chunk, ctx)
    } catch (err) {
      // Same conservative behaviour as F2: parser failure on a chunk is
      // logged via skippedFiles and the run continues with the rest.
      const paths = chunk.files.map((f) => f.path)
      skippedFiles.push(...paths)
      console.warn(`[runSchemaOnly] failed to parse chunk for ${input.orm}: ${(err as Error).message}`)
      continue
    }
    for (const model of chunkModels) {
      if (seenNames.has(model.name)) continue
      seenNames.add(model.name)
      parsed.push(model)
    }
  }

  // F3 mergeRelations is only applied to dsl-parse adapters in the real
  // pipeline (see src/pipeline_modules/build_models/index.ts). We've already
  // asserted dsl-parse above.
  const merged = mergeRelations(parsed)
  return { models: merged, skippedFiles }
}

/**
 * Strip non-deterministic fields from ModelRaw[] before snapshotting.
 *
 * Only `source_file` is non-deterministic across machines (it's an absolute
 * path resolved by the runner). We rewrite it relative to `repoRoot` so the
 * snapshot is portable. `line` / `line_start` / `line_end` are kept because
 * they're stable for a given source text and any drift indicates a real
 * parser regression.
 *
 * The function returns a deep copy — callers can safely mutate the result
 * without affecting the original parser output.
 */
export function normalizeForFixture(models: ModelRaw[], repoRoot: string): ModelRaw[] {
  const root = trimTrailingSep(repoRoot)
  return models.map((m) => normalizeModel(m, root))
}

function normalizeModel(model: ModelRaw, repoRoot: string): ModelRaw {
  const cloned: ModelRaw = structuredClone(model)
  if (typeof cloned.source_file === 'string' && cloned.source_file.length > 0) {
    cloned.source_file = toRelativePath(cloned.source_file, repoRoot)
  }
  return cloned
}

function toRelativePath(absPath: string, repoRoot: string): string {
  // Normalise both sides so the prefix check is robust against trailing
  // separators and Windows-style backslashes. We deliberately use a simple
  // string-prefix comparison instead of `path.relative` so that fixtures
  // with paths under the fixture root produce stable, forward-slash output
  // on every platform.
  const normalized = absPath.replace(/\\/g, '/')
  const rootNormalized = repoRoot.replace(/\\/g, '/')
  if (normalized === rootNormalized) return ''
  if (normalized.startsWith(rootNormalized + '/')) {
    return normalized.slice(rootNormalized.length + 1)
  }
  // Path escaped the fixture root — fall back to the raw value so the
  // regression surfaces in the diff instead of being silently masked.
  return normalized
}

function trimTrailingSep(p: string): string {
  let out = p.replace(/\\/g, '/')
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}
