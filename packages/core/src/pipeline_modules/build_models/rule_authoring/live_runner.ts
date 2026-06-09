// build_models/rule_authoring — the live runner that activates the model-adapter loop on a real repo: load the
// repo's graph (already in the DB from build_graph), find new-ORM gaps, run the loop with an INJECTED author,
// referee, and persist promotions so the next runBuildModels uses them.
//
// LLM-FREE: this file no longer resolves an in-code LLM author. The DSL authoring intelligence lives OUTSIDE
// the code — the agent (the dsl-build skill) drives the deterministic `dsl` CLI (dsl_builder/) which exposes
// gaps, validates+referees an agent-authored candidate, and promotes it. The loop here stays as the
// deterministic activation primitive: it runs with whatever author is injected (a test stub or a null/no-op
// author) and persists promotions. Mirrors build_relations' live_runner. See specs/refactor/llm-free-dsl-builder.md.

import type { DB } from '@/db/client.js'
import { runModelAdapterDiscovery, type ModelRuleAuthor, type ModelDiscoveryResult } from './autonomous_loop.js'
import { PROMOTED_MODEL_ADAPTERS } from './promoted_model_adapters.js'
import { loadPromotedModelAdapters, savePromotedModelAdapters } from './persistence.js'

/** Import specifiers of the built-in (hand-written) ORM adapters — excluded from gap detection. */
export const KNOWN_ORM_PACKAGES: string[] = [
  '@prisma/client', 'prisma', 'typeorm', '@mikro-orm/core', 'sequelize', 'sequelize-typescript',
  'mongoose', 'kysely', 'objection', 'knex', 'drizzle-orm', 'drift',
  'jakarta.persistence', 'javax.persistence',
]

// NOTE: the in-code LLM author resolver (resolveLiveModelAuthor) and its env gate (isLiveModelDiscoveryAllowed)
// were REMOVED — the codebase is LLM-free. The author is now injected (a test stub, or the agent-driven dsl
// CLI's promote path). No callSynthesizer in this import graph.

/** The known package set for gap detection: built-ins + compiled-in + already-persisted promotions. */
export function knownModelPackages(db: DB, repoId: string): string[] {
  const persisted = loadPromotedModelAdapters({ db, repoId })?.specs ?? []
  return [
    ...KNOWN_ORM_PACKAGES,
    ...PROMOTED_MODEL_ADAPTERS.flatMap((s) => s.clientPackages),
    ...persisted.flatMap((s) => s.clientPackages),
  ]
}

/**
 * Run the loop on a real repo with the given author and persist the promotions. The author is injected so
 * this is testable with a stub; production callers pass either a null/no-op author (the deterministic default)
 * or a test stub. The agent-driven path authors+promotes via the dsl CLI instead.
 */
export async function runLiveModelAdapterDiscovery(input: {
  db: DB
  repoId: string
  author: ModelRuleAuthor
  /** other repos for the referee's cross-clean check (optional). */
  foreign?: Array<{ fixture: string; db: DB; repoId: string }>
  /** set false to dry-run without persisting (default true). */
  persist?: boolean
}): Promise<ModelDiscoveryResult> {
  const knownPackages = knownModelPackages(input.db, input.repoId)
  const knownRuleIds = [
    ...PROMOTED_MODEL_ADAPTERS.map((s) => s.id),
    ...(loadPromotedModelAdapters({ db: input.db, repoId: input.repoId })?.specs.map((s) => s.id) ?? []),
  ]
  const result = await runModelAdapterDiscovery({
    db: input.db, repoId: input.repoId, knownPackages, knownRuleIds,
    foreign: input.foreign ?? [], authorCandidate: input.author,
  })
  if (input.persist !== false && result.promoted.length > 0) {
    savePromotedModelAdapters({ db: input.db, repoId: input.repoId, specs: result.promoted })
  }
  return result
}
