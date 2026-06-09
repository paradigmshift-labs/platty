// build_relations/rule_authoring — make the live engine CONSUME loop-promoted rules. Mirrors build_models'
// composeModelAdapterRegistry: hard-coded definitions win, promoted rules fire ONLY for packages the
// hard-coded engine doesn't recognize (so existing repos are unchanged; new ORMs/clients/vendors gain
// relations). The emitted relations append to F4's output and share each referee's detection, so output ==
// exactly what was promoted (faithful by construction).

import type { BuildRelationsInputs, SemanticIndex, ExtractedRelation } from '../types.js'
import { isDbClientPackage } from '../adapters/db/packages.js'
import { isApiClientPackage } from '../adapters/api/packages.js'
import { serviceForPackage } from '../adapters/external/definitions.js'
import { emitDbAccessRelationsForRule, type DbAccessEmitRule } from './db_access_promote_gate.js'
import { emitApiCallRelationsForRule, type ApiCallEmitRule } from './api_call_promote_gate.js'
import { emitExternalServiceRelationsForRule, type ExternalServiceEmitRule } from './promote_gate.js'

export interface RelationRuleContext {
  /** rules for ORMs/clients/vendors the hard-coded engine doesn't cover (hard-coded packages stripped). */
  dbAccess: DbAccessEmitRule[]
  apiCall: ApiCallEmitRule[]
  externalService: ExternalServiceEmitRule[]
}

export interface PromotedRelationRules {
  dbAccess?: DbAccessEmitRule[]
  apiCall?: ApiCallEmitRule[]
  externalService?: ExternalServiceEmitRule[]
}

/** Keep only packages the hard-coded engine does NOT recognize; drop a rule left with no novel package. */
function stripCovered<T extends { clientPackages?: string[]; packages?: string[] }>(
  rules: T[] | undefined,
  pkgKey: 'clientPackages' | 'packages',
  isCovered: (pkg: string) => boolean,
): T[] {
  const out: T[] = []
  for (const rule of rules ?? []) {
    const novel = ((rule[pkgKey] as string[] | undefined) ?? []).filter((p) => !isCovered(p))
    if (novel.length === 0) continue
    out.push({ ...rule, [pkgKey]: novel })
  }
  return out
}

/**
 * Build the consumption context from promoted rules, stripping any package the hard-coded engine already
 * handles. The "hard-coded wins, no double-emit" invariant keeps existing output unchanged even though the
 * rulebooks ship entries (prisma/axios/stripe/…) that duplicate the hard-coded engine.
 */
export function composeRelationRuleContext(opts: PromotedRelationRules = {}): RelationRuleContext {
  return {
    dbAccess: stripCovered(opts.dbAccess, 'clientPackages', isDbClientPackage),
    apiCall: stripCovered(opts.apiCall, 'clientPackages', isApiClientPackage),
    externalService: stripCovered(opts.externalService, 'packages', (p) => serviceForPackage(p) !== null),
  }
}

/** Emit the relations produced by the promoted rules in the context (appended to F4's hard-coded output). */
export function emitPromotedRelations(
  ctx: RelationRuleContext,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): ExtractedRelation[] {
  return [
    ...ctx.dbAccess.flatMap((rule) => emitDbAccessRelationsForRule(rule, inputs, index)),
    ...ctx.apiCall.flatMap((rule) => emitApiCallRelationsForRule(rule, inputs, index)),
    ...ctx.externalService.flatMap((rule) => emitExternalServiceRelationsForRule(rule, inputs, index)),
  ]
}

export const EMPTY_RELATION_RULE_CONTEXT: RelationRuleContext = { dbAccess: [], apiCall: [], externalService: [] }
