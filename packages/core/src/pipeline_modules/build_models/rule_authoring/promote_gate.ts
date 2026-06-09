// build_models/rule_authoring — deterministic referee for an agent-authored ModelAdapterSpec.
// Runs the candidate spec through the REAL GraphQuerySpecAdapter on an anchor graph fixture and grades:
// it must reproduce the anchor's expected model shapes exactly, add nothing extra (precision), produce a
// non-degenerate result, and stay silent on other ORMs' repos (cross-clean via the import gate). Mirrors
// build_relations' promote gates — no LLM here; the gate is pure execution + comparison.

import type { DB } from '@/db/client.js'
import { GraphQuerySpecAdapter } from './graph_query_spec_adapter.js'
import { diffModelShapes, type ModelAdapterSpec, type ModelShape } from './types.js'

export interface ModelAdapterPromotionInput {
  candidate: ModelAdapterSpec
  /** a seeded code graph for the ORM (the anchor) + the repoId it lives under. */
  anchorDb: DB
  anchorRepoId: string
  /** the model shapes the spec is expected to produce from the anchor. */
  anchorExpected: ModelShape[]
  /** other-ORM repos the candidate must NOT fire on (cross-ORM isolation). */
  foreign: Array<{ fixture: string; db: DB; repoId: string }>
}

export interface ModelAdapterPromotionResult {
  promote: boolean
  reason: string
  checks: {
    clientPackagesNonEmpty: { pass: boolean }
    nonDegenerate: { pass: boolean }
    anchorReproduction: { pass: boolean; missing: string[]; mismatched: string[] }
    precision: { pass: boolean; extra: string[] }
    crossClean: { pass: boolean; polluted: string[] }
  }
}

export async function evaluateModelAdapterForPromotion(
  input: ModelAdapterPromotionInput,
): Promise<ModelAdapterPromotionResult> {
  const { candidate } = input
  const adapter = new GraphQuerySpecAdapter(candidate)

  const clientPackagesNonEmpty = candidate.clientPackages.length > 0
  const nonDegenerate =
    input.anchorExpected.length > 0 && input.anchorExpected.every((m) => m.fields.length > 0)

  const actual = await adapter.queryFromGraph(input.anchorDb, input.anchorRepoId)
  const diff = diffModelShapes(actual, input.anchorExpected)
  const anchorReproduction = diff.missing.length === 0 && diff.mismatched.length === 0
  const precision = diff.extra.length === 0

  const polluted: string[] = []
  for (const f of input.foreign) {
    const got = await adapter.queryFromGraph(f.db, f.repoId)
    if (got.length > 0) polluted.push(f.fixture)
  }
  const crossClean = polluted.length === 0

  const checks = {
    clientPackagesNonEmpty: { pass: clientPackagesNonEmpty },
    nonDegenerate: { pass: nonDegenerate },
    anchorReproduction: { pass: anchorReproduction, missing: diff.missing, mismatched: diff.mismatched },
    precision: { pass: precision, extra: diff.extra },
    crossClean: { pass: crossClean, polluted },
  }

  const promote = clientPackagesNonEmpty && nonDegenerate && anchorReproduction && precision && crossClean
  const reason = promote
    ? 'promoted'
    : !clientPackagesNonEmpty ? 'empty_client_packages'
    : !nonDegenerate ? 'degenerate_anchor'
    : !anchorReproduction ? `anchor_not_reproduced(missing=[${diff.missing}] mismatched=[${diff.mismatched}])`
    : !precision ? `over_extract(extra=[${diff.extra}])`
    : `cross_pollution(${polluted})`

  return { promote, reason, checks }
}
