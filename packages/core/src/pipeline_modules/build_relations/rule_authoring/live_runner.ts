// build_relations/rule_authoring — the live runner that activates the relation-rule loop on a real repo:
// load the repo's graph, find imported packages no relation rule covers, run the loop with an INJECTED author,
// referee, and persist the promotions so the next runBuildRelations consumes them (composeRelationRuleContext).
//
// LLM-FREE: this file no longer resolves an in-code LLM author/classifier. The DSL authoring intelligence lives
// OUTSIDE the code — the agent (the dsl-build skill) drives the deterministic `dsl` CLI (dsl_builder/) which
// exposes gaps, validates+referees an agent-authored candidate, and promotes it. The loop here stays as the
// deterministic activation primitive: it runs with whatever author is injected (a test stub or a null/no-op
// author) and persists promotions. See specs/refactor/llm-free-dsl-builder.md.

import type { DB } from '@/db/client.js'
import type { BuildRelationsInputs, SemanticIndex } from '../types.js'
import { DB_CLIENT_PACKAGES } from '../adapters/db/packages.js'
import { JS_API_CLIENT_PACKAGES, DART_API_CLIENT_PACKAGES } from '../adapters/api/packages.js'
import {
  runRelationRuleDiscovery, type RelationRuleAuthor, type LibraryClassifier, type AuthoredRelationRule, type DiscoveryResult,
} from './autonomous_loop.js'
import { savePromotedRelationRules, loadPromotedRelationRules, loadLibraryIdentities, saveLibraryIdentities } from './persistence.js'
import type { LibraryKind } from './library_identity.js'

/**
 * Wrap a classifier so each DEFINITIVE classification is cached in the per-repo identity rulebook — it GROWS
 * (the build_graph per-language-rulebook analog): a package is asked to the LLM at most once across runs, so
 * the hand-written seed denylist shrinks toward an agent-grown cache. 'unknown' is NOT cached (re-tryable).
 */
export function createPersistentLibraryClassifier(db: DB, repoId: string, base: LibraryClassifier): LibraryClassifier {
  const cache: Record<string, LibraryKind> = { ...(loadLibraryIdentities({ db, repoId })?.identities ?? {}) }
  return async (pkg, gap, ctx) => {
    const hit = cache[pkg]
    if (hit) return { kind: hit, reason: 'identity rulebook (persisted)' }
    const identity = await base(pkg, gap, ctx)
    if (identity.kind !== 'unknown') {
      cache[pkg] = identity.kind
      saveLibraryIdentities({ db, repoId, identities: { [pkg]: identity.kind } })
    }
    return identity
  }
}

/** Import specifiers the hard-coded relation engine already covers — excluded from gap detection. */
export const HARD_CODED_RELATION_PACKAGES: string[] = [
  ...DB_CLIENT_PACKAGES, ...JS_API_CLIENT_PACKAGES, ...DART_API_CLIENT_PACKAGES,
]

// NOTE: the in-code LLM author/classifier resolvers (resolveLiveRelationAuthor / resolveLiveRelationClassifier)
// and their env gate (isLiveRelationDiscoveryAllowed) were REMOVED — the codebase is LLM-free. The author is now
// injected (a test stub, or the agent-driven dsl CLI's promote path). No callSynthesizer in this import graph.

/** Known package set for gap detection: hard-coded engine packages + already-persisted promotions. */
export function knownRelationPackages(db: DB, repoId: string): string[] {
  const persisted = loadPromotedRelationRules({ db, repoId })
  return [
    ...HARD_CODED_RELATION_PACKAGES,
    ...(persisted?.dbAccess.flatMap((r) => r.clientPackages) ?? []),
    ...(persisted?.apiCall.flatMap((r) => r.clientPackages) ?? []),
    ...(persisted?.externalService.flatMap((r) => r.packages) ?? []),
  ]
}

// toPersistedRelationRules lives in ./persisted_rule_shape.js (a pure, LLM-free module) so dsl_builder consumers
// import it directly. Imported here for local use (runLiveRelationDiscovery below) + re-exported for back-compat.
import { toPersistedRelationRules } from './persisted_rule_shape.js'
export { toPersistedRelationRules }

/**
 * Run the loop on a real repo's graph with the given author and persist the promotions. The author + inputs
 * are injected so this is testable with stubs; production callers pass either a null/no-op author (the
 * deterministic default) or a test stub. The agent-driven path authors+promotes via the dsl CLI instead.
 */
export async function runLiveRelationDiscovery(input: {
  db: DB
  repoId: string
  inputs: BuildRelationsInputs
  index: SemanticIndex
  author: RelationRuleAuthor
  /** classify-first library classifier (unknown packages skipped if absent). */
  classifier?: LibraryClassifier
  foreignInputs?: Array<{ fixture: string; inputs: BuildRelationsInputs; index: SemanticIndex }>
  persist?: boolean
}): Promise<DiscoveryResult> {
  const knownPackages = knownRelationPackages(input.db, input.repoId)
  // wrap the classifier so its classifications are cached + GROW the per-repo identity rulebook (≤1 LLM
  // classify per package across runs; the hand-seed shrinks toward an agent-grown cache).
  const classifyPackage = input.classifier
    ? createPersistentLibraryClassifier(input.db, input.repoId, input.classifier)
    : undefined
  const result = await runRelationRuleDiscovery({
    inputs: input.inputs, index: input.index, foreignInputs: input.foreignInputs ?? [],
    knownPackages, knownRuleIds: [], authorCandidate: input.author, classifyPackage,
  })
  if (input.persist !== false && result.promoted.length > 0) {
    savePromotedRelationRules({ db: input.db, repoId: input.repoId, ...toPersistedRelationRules(result.promoted) })
  }
  return result
}
