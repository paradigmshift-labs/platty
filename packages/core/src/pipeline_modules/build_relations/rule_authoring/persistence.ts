// build_relations/rule_authoring — runtime persistence for loop-promoted relation rules (per-repo JSON blob
// in repository_phase_status.meta; no schema change). Mirrors build_models' persistence + the weak-DSL
// saveApprovedStaticAnalysisRules. So a discovered ORM/client/vendor rule survives across runs and is
// consumed by the live engine via composeRelationRuleContext.

import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { repositoryPhaseStatus } from '@/db/schema/core.js'
import type { DbAccessEmitRule } from './db_access_promote_gate.js'
import type { ApiCallEmitRule } from './api_call_promote_gate.js'
import type { ExternalServiceEmitRule } from './promote_gate.js'
import type { LibraryKind } from './library_identity.js'

const PROMOTED_RELATION_RULES_PHASE = 'build_relations'
const PROMOTED_RELATION_RULES_META_KEY = 'promotedRelationRules'
const LIBRARY_IDENTITIES_META_KEY = 'libraryIdentities'

export interface StoredPromotedRelationRules {
  version: number
  dbAccess: DbAccessEmitRule[]
  apiCall: ApiCallEmitRule[]
  externalService: ExternalServiceEmitRule[]
  updatedAt: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function dedupeBy<T>(rules: T[] | undefined, key: (r: T) => string | undefined): T[] {
  const byKey = new Map<string, T>()
  for (const r of rules ?? []) {
    const k = key(r)
    if (k) byKey.set(k, r)
  }
  return [...byKey.values()]
}

const dbKey = (r: DbAccessEmitRule) => (typeof r?.ormLabel === 'string' && Array.isArray(r.clientPackages) ? r.ormLabel : undefined)
const apiKey = (r: ApiCallEmitRule) => (typeof r?.clientLabel === 'string' && Array.isArray(r.clientPackages) ? r.clientLabel : undefined)
const extKey = (r: ExternalServiceEmitRule) => (typeof r?.label === 'string' && Array.isArray(r.packages) ? r.label : undefined)

export function loadPromotedRelationRules(args: { db: DB; repoId: string }): StoredPromotedRelationRules | null {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_RELATION_RULES_PHASE),
  )).get()
  const stored = asRecord(asRecord(row?.meta)?.[PROMOTED_RELATION_RULES_META_KEY])
  if (!stored) return null
  const dbAccess = dedupeBy(Array.isArray(stored.dbAccess) ? (stored.dbAccess as DbAccessEmitRule[]) : [], dbKey)
  const apiCall = dedupeBy(Array.isArray(stored.apiCall) ? (stored.apiCall as ApiCallEmitRule[]) : [], apiKey)
  const externalService = dedupeBy(Array.isArray(stored.externalService) ? (stored.externalService as ExternalServiceEmitRule[]) : [], extKey)
  if (dbAccess.length === 0 && apiCall.length === 0 && externalService.length === 0) return null
  return {
    version: typeof stored.version === 'number' ? stored.version : 1,
    dbAccess, apiCall, externalService,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
  }
}

export function savePromotedRelationRules(args: {
  db: DB; repoId: string
  dbAccess?: DbAccessEmitRule[]; apiCall?: ApiCallEmitRule[]; externalService?: ExternalServiceEmitRule[]
}): StoredPromotedRelationRules {
  const existing = loadPromotedRelationRules({ db: args.db, repoId: args.repoId })
  const dbAccess = dedupeBy([...(existing?.dbAccess ?? []), ...(args.dbAccess ?? [])], dbKey)
  const apiCall = dedupeBy([...(existing?.apiCall ?? []), ...(args.apiCall ?? [])], apiKey)
  const externalService = dedupeBy([...(existing?.externalService ?? []), ...(args.externalService ?? [])], extKey)
  const changed = JSON.stringify([existing?.dbAccess ?? [], existing?.apiCall ?? [], existing?.externalService ?? []])
    !== JSON.stringify([dbAccess, apiCall, externalService])
  const now = new Date().toISOString()
  const stored: StoredPromotedRelationRules = {
    version: changed ? (existing?.version ?? 0) + 1 : existing?.version ?? 1,
    dbAccess, apiCall, externalService, updatedAt: now,
  }
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_RELATION_RULES_PHASE),
  )).get()
  const meta = { ...(asRecord(row?.meta) ?? {}), [PROMOTED_RELATION_RULES_META_KEY]: stored }
  if (row) {
    args.db.update(repositoryPhaseStatus)
      .set({ meta, updatedAt: now })
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, args.repoId),
        eq(repositoryPhaseStatus.phase, PROMOTED_RELATION_RULES_PHASE),
      ))
      .run()
    return stored
  }
  args.db.insert(repositoryPhaseStatus).values({
    repositoryId: args.repoId,
    phase: PROMOTED_RELATION_RULES_PHASE,
    validity: 'fresh',
    meta,
    updatedAt: now,
  }).run()
  return stored
}

// ── library identity rulebook (classify-first growth) ──────────────────────────────────────────────────
// The agent classifies an imported package's identity (http_client / db_client / vendor_service / ui / …)
// once; persisting it means the rulebook GROWS (the build_graph per-language-rulebook analog the user wants)
// so a package is asked to the LLM at most once across runs — the hand-written seed denylist shrinks toward
// an agent-grown cache. Same per-repo meta blob, separate key.

export interface StoredLibraryIdentities {
  version: number
  identities: Record<string, LibraryKind> // package specifier → kind
  updatedAt: string
}

export function loadLibraryIdentities(args: { db: DB; repoId: string }): StoredLibraryIdentities | null {
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_RELATION_RULES_PHASE),
  )).get()
  const stored = asRecord(asRecord(row?.meta)?.[LIBRARY_IDENTITIES_META_KEY])
  const identities = asRecord(stored?.identities) as Record<string, LibraryKind> | null
  if (!stored || !identities || Object.keys(identities).length === 0) return null
  return {
    version: typeof stored.version === 'number' ? stored.version : 1,
    identities,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
  }
}

export function saveLibraryIdentities(args: { db: DB; repoId: string; identities: Record<string, LibraryKind> }): StoredLibraryIdentities {
  const existing = loadLibraryIdentities({ db: args.db, repoId: args.repoId })
  const merged = { ...(existing?.identities ?? {}), ...args.identities }
  const changed = JSON.stringify(existing?.identities ?? {}) !== JSON.stringify(merged)
  const now = new Date().toISOString()
  const stored: StoredLibraryIdentities = {
    version: changed ? (existing?.version ?? 0) + 1 : existing?.version ?? 1,
    identities: merged,
    updatedAt: now,
  }
  const row = args.db.select().from(repositoryPhaseStatus).where(and(
    eq(repositoryPhaseStatus.repositoryId, args.repoId),
    eq(repositoryPhaseStatus.phase, PROMOTED_RELATION_RULES_PHASE),
  )).get()
  const meta = { ...(asRecord(row?.meta) ?? {}), [LIBRARY_IDENTITIES_META_KEY]: stored }
  if (row) {
    args.db.update(repositoryPhaseStatus)
      .set({ meta, updatedAt: now })
      .where(and(
        eq(repositoryPhaseStatus.repositoryId, args.repoId),
        eq(repositoryPhaseStatus.phase, PROMOTED_RELATION_RULES_PHASE),
      ))
      .run()
    return stored
  }
  args.db.insert(repositoryPhaseStatus).values({
    repositoryId: args.repoId,
    phase: PROMOTED_RELATION_RULES_PHASE,
    validity: 'fresh',
    meta,
    updatedAt: now,
  }).run()
  return stored
}
