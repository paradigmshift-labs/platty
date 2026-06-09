// G7 — corpus self-improvement sweep. Runs the relation-rule discovery loop across many fixtures in sequence,
// ACCUMULATING the rulebook so a rule learned on one repo is reused (not re-authored) on the next. This is the
// orchestration layer the per-repo loop (G3–G5) was missing: "self-improvement across the corpus" = the LLM is
// asked once per novel package across the whole sweep, and coverage compounds. Pure orchestration over in-memory
// {fixture, inputs, index} items + an injected author/classifier — no DB, no LLM, no pipeline run — so it is
// fully testable with stubs and CI-safe. See specs/refactor/g7-corpus-self-improvement-sweep.md.

import type { BuildRelationsInputs, SemanticIndex } from '../types.js'
import {
  runRelationRuleDiscovery, packageRoot,
  type RelationRuleAuthor, type LibraryClassifier, type AuthoredRelationRule,
} from './autonomous_loop.js'
import { toPersistedRelationRules } from './live_runner.js'
import { composeRelationRuleContext, emitPromotedRelations } from './consumption.js'

/** A corpus item: a fixture's loaded build_relations inputs + its semantic index. */
export interface CorpusFixture {
  fixture: string
  inputs: BuildRelationsInputs
  index: SemanticIndex
}

export interface CorpusFixtureReport {
  fixture: string
  /** imported packages with no rule (seed or accumulated) — the loop authored for these this round. */
  gapPackages: string[]
  /** imported packages already covered by the accumulated rulebook (learned earlier) — NOT re-authored. */
  reusedPackages: string[]
  /** net-new rules promoted from this fixture. */
  promotedRuleIds: string[]
  rejectedRuleIds: string[]
  /** relations the ACCUMULATED rulebook emits on this fixture (hard-coded-covered packages stripped). */
  coverageRelations: number
}

export interface CorpusSweepReport {
  perFixture: CorpusFixtureReport[]
  totals: {
    fixturesSwept: number
    /** distinct novel packages the rulebook learned over the sweep. */
    packagesLearned: number
    rulesPromoted: number
    /** how many times the author was invoked — accumulation reduces this (a learned package is no longer a gap). */
    llmAuthorCalls: number
    /** sum of per-fixture coverage relations (the rulebook's footprint across the corpus). */
    coverageRelationsTotal: number
  }
  learnedPackages: string[]
}

function packagesOf(a: AuthoredRelationRule): string[] {
  return a.kind === 'external_service' ? a.candidate.packages : a.candidate.clientPackages
}

/** The package roots a fixture imports (collapsed to the npm package, relative/alias dropped — see packageRoot). */
function importedPackageRoots(inputs: BuildRelationsInputs): string[] {
  const out = new Set<string>()
  for (const e of inputs.edges) {
    if (e.relation !== 'imports' || !e.targetSpecifier) continue
    const root = packageRoot(e.targetSpecifier)
    if (root) out.add(root)
  }
  return [...out]
}

/**
 * Sweep the corpus, growing the rulebook. Fixtures are processed in order; the known-package / known-rule sets
 * accumulate, so a package learned on an earlier fixture is excluded from later fixtures' gaps (the LLM is not
 * re-asked) while its promoted rule still emits coverage everywhere it applies.
 */
export async function runCorpusSelfImprovement(input: {
  fixtures: CorpusFixture[]
  author: RelationRuleAuthor
  classifyPackage?: LibraryClassifier
  seedKnownPackages: string[]
}): Promise<CorpusSweepReport> {
  const knownPackages = new Set(input.seedKnownPackages)
  const knownRuleIds = new Set<string>()
  const accumulatedRules: AuthoredRelationRule[] = []
  const learnedPackages = new Set<string>()
  let llmAuthorCalls = 0

  // count every author invocation so the report can show the savings accumulation buys.
  const countingAuthor: RelationRuleAuthor = async (gap, ctx, kind) => {
    llmAuthorCalls++
    return input.author(gap, ctx, kind)
  }

  const perFixture: CorpusFixtureReport[] = []

  for (const f of input.fixtures) {
    // packages this fixture imports that the accumulated rulebook already covers → reused, not re-authored.
    const reusedPackages = importedPackageRoots(f.inputs).filter((p) => knownPackages.has(p))

    // foreignInputs: [] — matches the live runner. Cross-pollution is a referee-test concern with curated
    // foreign repos; sibling fixtures that legitimately share a package would otherwise cause false rejections.
    const result = await runRelationRuleDiscovery({
      inputs: f.inputs, index: f.index, foreignInputs: [],
      knownPackages: [...knownPackages], knownRuleIds: [...knownRuleIds],
      authorCandidate: countingAuthor, classifyPackage: input.classifyPackage,
    })

    for (const promoted of result.promoted) {
      accumulatedRules.push(promoted)
      knownRuleIds.add(promoted.candidate.id)
      for (const pkg of packagesOf(promoted)) {
        knownPackages.add(pkg)
        learnedPackages.add(pkg)
      }
    }

    // coverage = what the ACCUMULATED rulebook emits on this fixture (genuinely new: hard-coded packages stripped).
    const coverage = emitPromotedRelations(
      composeRelationRuleContext(toPersistedRelationRules(accumulatedRules)),
      f.inputs, f.index,
    )

    perFixture.push({
      fixture: f.fixture,
      gapPackages: result.gaps.map((g) => g.packageSpecifier),
      reusedPackages,
      promotedRuleIds: result.promoted.map((p) => p.candidate.id),
      rejectedRuleIds: result.rejected.map((r) => r.ruleId),
      coverageRelations: coverage.length,
    })
  }

  return {
    perFixture,
    totals: {
      fixturesSwept: input.fixtures.length,
      packagesLearned: learnedPackages.size,
      rulesPromoted: knownRuleIds.size,
      llmAuthorCalls,
      coverageRelationsTotal: perFixture.reduce((sum, r) => sum + r.coverageRelations, 0),
    },
    learnedPackages: [...learnedPackages].sort(),
  }
}
