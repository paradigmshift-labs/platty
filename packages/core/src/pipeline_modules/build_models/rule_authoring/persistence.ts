// build_models/rule_authoring — runtime persistence for loop-promoted ModelAdapterSpecs.
// Mirrors shared/static_config's saveApprovedStaticAnalysisRules: a per-repository JSON blob in
// repository_phase_status.meta (no schema change). Promotions survive across runs and are loaded back into
// the adapter registry by runBuildModels, so a newly-discovered ORM keeps producing models.

import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositoryPhaseStatus } from '@/db/schema/core.js'
import type { ModelAdapterSpec } from './types.js'

const PROMOTED_MODEL_ADAPTERS_PHASE = 'build_models'
const PROMOTED_MODEL_ADAPTERS_META_KEY = 'promotedModelAdapters'

export interface StoredPromotedModelAdapters {
  version: number
  specs: ModelAdapterSpec[]
  updatedAt: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** dedupe by spec.id, last write wins. */
function dedupeSpecs(specs: ModelAdapterSpec[]): ModelAdapterSpec[] {
  const byId = new Map<string, ModelAdapterSpec>()
  for (const s of specs) {
    if (s && typeof s.id === 'string') byId.set(s.id, s)
  }
  return [...byId.values()]
}

function specsEqual(a: ModelAdapterSpec[], b: ModelAdapterSpec[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function loadPromotedModelAdapters(args: { db: DB; repoId: string }): StoredPromotedModelAdapters | null {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_MODEL_ADAPTERS_PHASE),
  )).get()
  const stored = asRecord(asRecord(row?.meta)?.[PROMOTED_MODEL_ADAPTERS_META_KEY])
  if (!stored || !Array.isArray(stored.specs)) return null
  const specs = (stored.specs as ModelAdapterSpec[]).filter((s) => s && typeof s.id === 'string' && Array.isArray(s.clientPackages))
  if (specs.length === 0) return null
  return {
    version: typeof stored.version === 'number' ? stored.version : 1,
    specs,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
  }
}

/** Merge new promoted specs into the per-repo store (existing keys/specs preserved; bump version on change). */
export function savePromotedModelAdapters(args: { db: DB; repoId: string; specs: ModelAdapterSpec[] }): StoredPromotedModelAdapters {
  const existing = loadPromotedModelAdapters({ db: args.db, repoId: args.repoId })
  const merged = dedupeSpecs([...(existing?.specs ?? []), ...args.specs])
  const changed = !specsEqual(existing?.specs ?? [], merged)
  const now = new Date().toISOString()
  const stored: StoredPromotedModelAdapters = {
    version: changed ? (existing?.version ?? 0) + 1 : existing?.version ?? 1,
    specs: merged,
    updatedAt: now,
  }
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_MODEL_ADAPTERS_PHASE),
  )).get()
  const meta = { ...(asRecord(row?.meta) ?? {}), [PROMOTED_MODEL_ADAPTERS_META_KEY]: stored }
  if (row) {
    args.db.update(repositoryPhaseStatus)
      .set({ meta, updatedAt: now })
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, args.repoId),
        eq(repositoryPhaseStatus.phase, PROMOTED_MODEL_ADAPTERS_PHASE),
      ))
      .run()
    return stored
  }
  args.db.insert(repositoryPhaseStatus).values({
    repositoryId: args.repoId,
    phase: PROMOTED_MODEL_ADAPTERS_PHASE,
    validity: 'fresh',
    meta,
    updatedAt: now,
  }).run()
  return stored
}
