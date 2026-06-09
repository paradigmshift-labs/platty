// build_route/rule_authoring — runtime persistence for loop-promoted route rules (per-repo JSON blob in
// repository_phase_status.meta; no schema change). Mirrors build_models/build_relations persistence. A
// discovered framework's route rule survives across runs and is consumed by the live engine via
// composeRoutePromotedAdapters.

import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositoryPhaseStatus } from '@/db/schema/core.js'
import type { RouteAdapterRuleCandidate } from './types.js'

const PROMOTED_ROUTE_RULES_PHASE = 'build_route'
const PROMOTED_ROUTE_RULES_META_KEY = 'promotedRouteRules'

export interface StoredPromotedRouteRules {
  version: number
  rules: RouteAdapterRuleCandidate[]
  updatedAt: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function dedupeById(rules: RouteAdapterRuleCandidate[]): RouteAdapterRuleCandidate[] {
  const byId = new Map<string, RouteAdapterRuleCandidate>()
  for (const r of rules) {
    if (r && typeof r.id === 'string' && Array.isArray(r.requiresImport)) byId.set(r.id, r)
  }
  return [...byId.values()]
}

export function loadPromotedRouteRules(args: { db: DB; repoId: string }): StoredPromotedRouteRules | null {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_ROUTE_RULES_PHASE),
  )).get()
  const stored = asRecord(asRecord(row?.meta)?.[PROMOTED_ROUTE_RULES_META_KEY])
  if (!stored || !Array.isArray(stored.rules)) return null
  const rules = dedupeById(stored.rules as RouteAdapterRuleCandidate[])
  if (rules.length === 0) return null
  return {
    version: typeof stored.version === 'number' ? stored.version : 1,
    rules,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
  }
}

export function savePromotedRouteRules(args: { db: DB; repoId: string; rules: RouteAdapterRuleCandidate[] }): StoredPromotedRouteRules {
  const existing = loadPromotedRouteRules({ db: args.db, repoId: args.repoId })
  const rules = dedupeById([...(existing?.rules ?? []), ...args.rules])
  const changed = JSON.stringify(existing?.rules ?? []) !== JSON.stringify(rules)
  const now = new Date().toISOString()
  const stored: StoredPromotedRouteRules = {
    version: changed ? (existing?.version ?? 0) + 1 : existing?.version ?? 1,
    rules,
    updatedAt: now,
  }
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_ROUTE_RULES_PHASE),
  )).get()
  const meta = { ...(asRecord(row?.meta) ?? {}), [PROMOTED_ROUTE_RULES_META_KEY]: stored }
  if (row) {
    args.db.update(repositoryPhaseStatus)
      .set({ meta, updatedAt: now })
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, args.repoId),
        eq(repositoryPhaseStatus.phase, PROMOTED_ROUTE_RULES_PHASE),
      ))
      .run()
    return stored
  }
  args.db.insert(repositoryPhaseStatus).values({
    repositoryId: args.repoId,
    phase: PROMOTED_ROUTE_RULES_PHASE,
    validity: 'fresh',
    meta,
    updatedAt: now,
  }).run()
  return stored
}
