// rule_authoring/autonomous_loop — the full-autonomy wiring: scan a repo for relation patterns no current
// rule covers (imported packages the rulebooks don't know), have an agent author a candidate for each, run
// the deterministic referee, and auto-promote the ones that PASS. Mirrors the weak-DSL discovery loop
// (`static_analysis_dsl_discovery/promote_candidates.ts`) but for the STRONG relation rules + their referees.
// The author is pluggable (real = an LLM agent; tests = a stub), so the orchestration is deterministic + testable.

import type { BuildRelationsInputs, SemanticIndex } from '../types.js'
import { evaluateExternalServiceRuleForPromotion } from './promote_gate.js'
import { evaluateDbAccessRuleForPromotion } from './db_access_promote_gate.js'
import { evaluateApiCallRuleForPromotion } from './api_call_promote_gate.js'
import type { ExternalServiceRuleCandidate } from './types.js'
import type { DbAccessRuleCandidate } from './db_access_types.js'
import type { ApiCallRuleCandidate } from './api_call_types.js'
import { classifyFromSeed, relationKindFor, type LibraryIdentity, type LibraryKind } from './library_identity.js'

/** The relation loops a classified library can map to. */
export type RelationKind = 'api_call' | 'db_access' | 'external_service'

/** A package imported by the repo that no current rulebook entry covers — a candidate target for the loop. */
export interface RelationGap {
  packageSpecifier: string
  /** files that import it (where its calls live). */
  files: string[]
}

/** A rule an agent authored for a gap, tagged by relation kind so the loop dispatches to the right referee. */
export type AuthoredRelationRule =
  | { kind: 'external_service'; candidate: ExternalServiceRuleCandidate }
  | { kind: 'db_access'; candidate: DbAccessRuleCandidate }
  | { kind: 'api_call'; candidate: ApiCallRuleCandidate }

export interface RelationRuleAuthorContext {
  inputs: BuildRelationsInputs
  index: SemanticIndex
}

/**
 * Pluggable author: given a gap + the relation kind it was CLASSIFIED as, returns a candidate (or null to
 * skip). The kindHint comes from library-identity classification (classify-first), so the author no longer
 * guesses the kind from call sites — it authors the rule for the kind the library actually is.
 */
export type RelationRuleAuthor = (gap: RelationGap, ctx: RelationRuleAuthorContext, kindHint: RelationKind) => Promise<AuthoredRelationRule | null>

/** Classify an unknown (not-seeded) package's library identity. Real impl = a gated LLM classifier. */
export type LibraryClassifier = (pkg: string, gap: RelationGap, ctx: RelationRuleAuthorContext) => Promise<LibraryIdentity>

export interface DiscoveryInput {
  inputs: BuildRelationsInputs
  index: SemanticIndex
  /** other repos used by the referees' cross-clean check. */
  foreignInputs: { fixture: string; inputs: BuildRelationsInputs; index: SemanticIndex }[]
  /** package specifiers already covered by some rule (gaps exclude these). */
  knownPackages: string[]
  /** rule ids already in the rulebook (dedup). */
  knownRuleIds: string[]
  authorCandidate: RelationRuleAuthor
  /** classify packages the seed rulebook doesn't know. Absent → unknown packages are skipped (no LLM). */
  classifyPackage?: LibraryClassifier
}

export interface DiscoveryResult {
  gaps: RelationGap[]
  promoted: AuthoredRelationRule[]
  rejected: { ruleId: string; reason: string }[]
  /** gaps the loop did NOT author for, because their library identity is not a relation source. */
  skipped: { package: string; kind: LibraryKind }[]
}

/**
 * The npm package a module specifier belongs to, or null if it is NOT a package import (relative `./`/`../`,
 * absolute `/`, or a tsconfig/path alias `@/`/`~/`). Subpaths collapse to the package root so the loop
 * classifies/authors once per package (`next/head`+`next/router` → `next`; `@scope/pkg/sub` → `@scope/pkg`).
 * A relation gap must be a real third-party package — a service/client/vendor lives in node_modules, never in
 * a relative file. This is the deterministic first filter that kept the loop from authoring bogus rules for
 * `@/utils/...` and local modules on real repos.
 */
/** Node.js builtin modules — never a third-party relation source (fs/path/crypto/os/…); `node:` prefix is always a builtin. */
const NODE_BUILTINS: ReadonlySet<string> = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
])

export function packageRoot(specifier: string): string | null {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('~/') || specifier.startsWith('@/')) return null
  if (specifier.startsWith('node:')) return null // node:fs etc. — always a builtin, never a relation source
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  const root = parts[0]!
  if (NODE_BUILTINS.has(root)) return null
  return root
}

/** Top-level directories of the repo's own files (e.g. 'src', 'app') — a bare import root matching one is a
 *  baseUrl/path-alias local import, NOT a third-party package. Deterministic, repo-derived (no hard-coded list). */
function repoSourceRoots(inputs: BuildRelationsInputs): Set<string> {
  const roots = new Set<string>()
  for (const node of inputs.nodes) {
    const fp = node.filePath
    if (!fp) continue
    const slash = fp.indexOf('/')
    if (slash > 0) roots.add(fp.slice(0, slash))
  }
  return roots
}

/** Detect imported packages that no current rule covers (each becomes a gap the loop tries to author for). */
export function findRelationGaps(inputs: BuildRelationsInputs, index: SemanticIndex, knownPackages: Set<string>): RelationGap[] {
  const localRoots = repoSourceRoots(inputs)
  const byPkg = new Map<string, Set<string>>()
  for (const edge of inputs.edges) {
    if (edge.relation !== 'imports' || !edge.targetSpecifier) continue
    const root = packageRoot(edge.targetSpecifier)
    if (!root || knownPackages.has(root) || knownPackages.has(edge.targetSpecifier) || localRoots.has(root)) continue
    const fp = index.nodesById.get(edge.sourceId)?.filePath
    if (!fp) continue
    if (!byPkg.has(root)) byPkg.set(root, new Set())
    byPkg.get(root)!.add(fp)
  }
  return [...byPkg.entries()].map(([packageSpecifier, files]) => ({ packageSpecifier, files: [...files] }))
}

/** Run the referee for the candidate's kind (the deterministic promote gate). */
function refereeFor(authored: AuthoredRelationRule, input: DiscoveryInput): { promote: boolean; reason: string } {
  const common = { anchorInputs: input.inputs, anchorIndex: input.index, foreignInputs: input.foreignInputs }
  if (authored.kind === 'external_service') return evaluateExternalServiceRuleForPromotion({ candidate: authored.candidate, ...common })
  if (authored.kind === 'db_access') return evaluateDbAccessRuleForPromotion({ candidate: authored.candidate, ...common })
  return evaluateApiCallRuleForPromotion({ candidate: authored.candidate, ...common })
}

function candidateId(a: AuthoredRelationRule): string {
  return a.candidate.id
}

/**
 * The autonomous loop: gap → author → referee → promote. No LLM or IO here beyond the pluggable author;
 * the gate is deterministic. The known-id set grows within the batch so a re-authored rule is rejected as a
 * duplicate rather than promoted twice (same invariant as the weak-DSL discovery loop).
 */
export async function runRelationRuleDiscovery(input: DiscoveryInput): Promise<DiscoveryResult> {
  const gaps = findRelationGaps(input.inputs, input.index, new Set(input.knownPackages))
  const promoted: AuthoredRelationRule[] = []
  const rejected: { ruleId: string; reason: string }[] = []
  const skipped: { package: string; kind: LibraryKind }[] = []
  const knownIds = new Set(input.knownRuleIds)
  const ctx: RelationRuleAuthorContext = { inputs: input.inputs, index: input.index }

  for (const gap of gaps) {
    // CLASSIFY-FIRST: decide WHAT the library is (seed rulebook is deterministic; unknowns defer to the
    // gated LLM classifier) before authoring. Only http_client / db_client / vendor_service map to a loop;
    // ui frameworks, utilities, etc. are skipped — this is what stops the `react.signIn() → fake vendor`
    // hallucination at the source instead of relying on the referee to catch it after the fact.
    const identity = classifyFromSeed(gap.packageSpecifier)
      ?? (input.classifyPackage ? await input.classifyPackage(gap.packageSpecifier, gap, ctx) : { kind: 'unknown' as const, reason: 'no classifier' })
    const kind = relationKindFor(identity.kind)
    if (!kind) {
      skipped.push({ package: gap.packageSpecifier, kind: identity.kind })
      continue
    }

    const authored = await input.authorCandidate(gap, ctx, kind)
    if (!authored) continue
    const id = candidateId(authored)
    if (knownIds.has(id)) {
      rejected.push({ ruleId: id, reason: 'duplicate_id' })
      continue
    }
    const verdict = refereeFor(authored, input)
    if (verdict.promote) {
      promoted.push(authored)
      knownIds.add(id)
    } else {
      rejected.push({ ruleId: id, reason: verdict.reason })
    }
  }

  return { gaps, promoted, rejected, skipped }
}
