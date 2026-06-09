import type {
  ResolvedConfigSource,
  StaticAnalysisPatternRule,
  StaticAnalysisPatternRuleMatch,
  StaticAnalysisPatternRuleState,
  StaticAnalysisPatternRuleTarget,
  StaticAnalysisPatternValueSource,
} from './types.js'

export interface PatternDslRuleDiagnostic {
  ruleId: string
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface PatternDslRuleConflict {
  ruleIds: string[]
  code: string
  message: string
}

export interface ValidatePatternDslRulesResult {
  errors: PatternDslRuleDiagnostic[]
  warnings: PatternDslRuleDiagnostic[]
  conflicts: PatternDslRuleConflict[]
  valid: boolean
}

// Valid enum values. These mirror the union types in ./types.ts. They are
// re-listed here as runtime sets because those types are compile-time-only
// aliases (no exported const arrays exist to reuse). Keep in sync with types.ts.
const VALID_STATES: ReadonlySet<StaticAnalysisPatternRuleState> = new Set([
  'active',
  'candidate',
  'disabled',
])

const VALID_SOURCES: ReadonlySet<ResolvedConfigSource> = new Set([
  'default',
  'repository_metadata',
  'user',
  'approved',
  'fixture',
  'agent_candidate',
])

const VALID_TARGETS: ReadonlySet<StaticAnalysisPatternRuleTarget> = new Set([
  'route.entrypoint',
  'relation.db_access',
  'relation.api_call',
  'relation.navigation',
  'relation.external_link',
  'relation.event',
  'relation.schedule_trigger',
  'service_map.hint',
])

/**
 * Source rank for conflict resolution (spec §8.1):
 * approved > user > fixture > repository_metadata > default > agent_candidate.
 * The validator does NOT resolve conflicts; it only reports them and notes which
 * source would win so a downstream consumer can resolve deterministically.
 */
const SOURCE_RANK: Record<ResolvedConfigSource, number> = {
  approved: 5,
  user: 4,
  fixture: 3,
  repository_metadata: 2,
  default: 1,
  agent_candidate: 0,
}

/**
 * Pure static validator for pattern DSL rules.
 *
 * Building block for safely accepting user/approved/agent_candidate rules and
 * discovery-loop candidates. NOT wired into the live pipeline — it is a pure
 * utility (no IO, no DB). See specs/static_analysis_pattern_dsl.md §8.
 *
 * Checks (errors unless noted):
 *  - duplicate_rule_id   duplicate `id` within the input set (flagged on each duplicate)
 *  - invalid_rule_id     empty/blank `id`
 *  - invalid_state       `state` not in {active,candidate,disabled}
 *  - invalid_source      `source` not in ResolvedConfigSource
 *  - invalid_target      `target` not in StaticAnalysisPatternRuleTarget
 *  - missing_relation    `match.relation` blank
 *  - broad_match         WARNING: match has only `relation`, no discriminating predicate
 *  - unbound_capture     emit targetFrom/operationFrom references a chainPath capture
 *                        not bound by `{name}` in `match.chainPathPattern`
 *  - emit_conflict       CONFLICT (not error): two active rules with same target and
 *                        structurally-overlapping match but different emit
 *
 * Note on literalArg emit (engine reality, pattern_dsl.ts `resolveValue`):
 * `targetFrom: 'literalArg:KEY'` reads `literalArgs` by KEY independently; it does
 * NOT require a matching `match.literalArgKey`, and KEY may differ. So literalArg
 * emit is intentionally NOT flagged.
 */
export function validatePatternDslRules(
  rules: StaticAnalysisPatternRule[],
): ValidatePatternDslRulesResult {
  const errors: PatternDslRuleDiagnostic[] = []
  const warnings: PatternDslRuleDiagnostic[] = []
  const conflicts: PatternDslRuleConflict[] = []

  // 1. Duplicate ids across the input set (flag each occurrence of a duplicated id).
  const idCounts = new Map<string, number>()
  for (const rule of rules) {
    const id = rule.id
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }

  for (const rule of rules) {
    const ruleId = rule.id

    // 2. Empty/blank id.
    if (typeof rule.id !== 'string' || rule.id.trim().length === 0) {
      errors.push({
        ruleId,
        code: 'invalid_rule_id',
        message: 'Rule id must be a non-empty string.',
        severity: 'error',
      })
    } else if ((idCounts.get(rule.id) ?? 0) > 1) {
      // 1. Duplicate id (only meaningful for non-blank ids).
      errors.push({
        ruleId,
        code: 'duplicate_rule_id',
        message: `Duplicate rule id "${rule.id}" within the rule set.`,
        severity: 'error',
      })
    }

    // 3. Unknown state.
    if (!VALID_STATES.has(rule.state)) {
      errors.push({
        ruleId,
        code: 'invalid_state',
        message: `Unknown rule state "${String(rule.state)}".`,
        severity: 'error',
      })
    }

    // 4. Unknown source.
    if (!VALID_SOURCES.has(rule.source)) {
      errors.push({
        ruleId,
        code: 'invalid_source',
        message: `Unknown rule source "${String(rule.source)}".`,
        severity: 'error',
      })
    }

    // 5. Unknown target.
    if (!VALID_TARGETS.has(rule.target)) {
      errors.push({
        ruleId,
        code: 'invalid_target',
        message: `Unknown rule target "${String(rule.target)}".`,
        severity: 'error',
      })
    }

    const match = rule.match

    // 6. Blank relation.
    if (typeof match?.relation !== 'string' || match.relation.trim().length === 0) {
      errors.push({
        ruleId,
        code: 'missing_relation',
        message: 'match.relation must be a non-empty string.',
        severity: 'error',
      })
    }

    // 7. No discriminating predicate → broad_match warning.
    if (match && !hasDiscriminatingPredicate(match)) {
      warnings.push({
        ruleId,
        code: 'broad_match',
        message: 'Rule matches every edge of its relation; add a discriminating predicate.',
        severity: 'warning',
      })
    }

    // 8. Capture-binding: chainPathSegment:/chainPathCallArg: emit sources must
    //    reference a {name} declared in match.chainPathPattern.
    const boundCaptures = parseChainPatternCaptures(match?.chainPathPattern)
    for (const captureName of captureRefs(rule.emit.targetFrom, rule.emit.operationFrom)) {
      if (!boundCaptures.has(captureName)) {
        errors.push({
          ruleId,
          code: 'unbound_capture',
          message: `emit references capture "${captureName}" not bound by match.chainPathPattern.`,
          severity: 'error',
        })
      }
    }
  }

  // 10. Conflicts: active rules with the same target + overlapping match but
  //     different emit. Conservative — only flags clearly overlapping pairs.
  detectEmitConflicts(rules, conflicts)

  return {
    errors,
    warnings,
    conflicts,
    valid: errors.length === 0,
  }
}

const DISCRIMINATING_PREDICATE_KEYS: ReadonlyArray<keyof StaticAnalysisPatternRuleMatch> = [
  'targetSymbolIn',
  'chainPathEquals',
  'chainPathPrefix',
  'chainPathPattern',
  'decoratorName',
  'literalArgKey',
  'fileGlob',
  'importsContain',
]

function hasDiscriminatingPredicate(match: StaticAnalysisPatternRuleMatch): boolean {
  return DISCRIMINATING_PREDICATE_KEYS.some((key) => {
    const value = match[key]
    if (value === undefined || value === null) return false
    if (Array.isArray(value)) return value.length > 0
    return true
  })
}

/** Parse `{name}` placeholders from a chainPathPattern (same syntax the engine uses). */
function parseChainPatternCaptures(pattern: string | undefined): Set<string> {
  const names = new Set<string>()
  if (!pattern) return names
  for (const m of pattern.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    names.add(m[1])
  }
  return names
}

/** Capture names referenced by chainPathSegment:/chainPathCallArg: emit sources. */
function captureRefs(...sources: Array<StaticAnalysisPatternValueSource | undefined>): string[] {
  const refs: string[] = []
  for (const source of sources) {
    if (!source) continue
    if (source.startsWith('chainPathSegment:')) {
      refs.push(source.slice('chainPathSegment:'.length))
    } else if (source.startsWith('chainPathCallArg:')) {
      refs.push(source.slice('chainPathCallArg:'.length))
    }
  }
  return refs
}

/**
 * Conservative structural-overlap conflict detection.
 *
 * Two active rules conflict when:
 *  - same `target`, AND
 *  - same `match.relation`, AND
 *  - their `targetSymbolIn` sets overlap (or either is unconstrained), AND
 *  - their chain predicate is the same or compatible
 *    (same chainPathPattern / chainPathEquals / chainPathPrefix, or one side
 *     leaves the chain unconstrained), AND
 *  - their emit differs.
 *
 * The overlap test is deliberately narrow: it requires the same relation+target
 * and a non-disjoint symbol set, and it treats differing concrete chain
 * predicates as non-overlapping. This avoids false positives at the cost of
 * missing some subtle overlaps — acceptable for a gate that only warns.
 *
 * Per spec §8.1 the conflict message notes which source has the higher rank
 * (approved > user > fixture > repository_metadata > default > agent_candidate);
 * the validator does not resolve the conflict.
 */
function detectEmitConflicts(
  rules: StaticAnalysisPatternRule[],
  conflicts: PatternDslRuleConflict[],
): void {
  const active = rules.filter(
    (rule) =>
      rule.state === 'active' &&
      typeof rule.id === 'string' &&
      rule.id.trim().length > 0 &&
      VALID_TARGETS.has(rule.target),
  )

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      if (a.target !== b.target) continue
      if (!matchesOverlap(a.match, b.match)) continue
      if (emitEqual(a.emit, b.emit)) continue
      conflicts.push({
        ruleIds: [a.id, b.id],
        code: 'emit_conflict',
        message: conflictMessage(a, b),
      })
    }
  }
}

function matchesOverlap(
  a: StaticAnalysisPatternRuleMatch,
  b: StaticAnalysisPatternRuleMatch,
): boolean {
  if ((a?.relation ?? '') !== (b?.relation ?? '')) return false
  if (!symbolSetsOverlap(a.targetSymbolIn, b.targetSymbolIn)) return false
  if (!chainPredicatesCompatible(a, b)) return false
  return true
}

/** Unconstrained on either side → overlaps. Otherwise sets must intersect. */
function symbolSetsOverlap(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || a.length === 0) return true
  if (!b || b.length === 0) return true
  const set = new Set(a)
  return b.some((value) => set.has(value))
}

/**
 * Chain predicates are compatible (overlap) if either rule leaves the chain
 * unconstrained, or both pin the same concrete chain predicate. Two different
 * concrete chain predicates are treated as disjoint (conservative).
 */
function chainPredicatesCompatible(
  a: StaticAnalysisPatternRuleMatch,
  b: StaticAnalysisPatternRuleMatch,
): boolean {
  const ka = chainPredicateKey(a)
  const kb = chainPredicateKey(b)
  if (ka === null || kb === null) return true
  return ka === kb
}

function chainPredicateKey(match: StaticAnalysisPatternRuleMatch): string | null {
  if (match.chainPathPattern) return `pattern:${match.chainPathPattern}`
  if (match.chainPathEquals) return `equals:${match.chainPathEquals}`
  if (match.chainPathPrefix) return `prefix:${match.chainPathPrefix}`
  return null
}

function emitEqual(
  a: StaticAnalysisPatternRule['emit'],
  b: StaticAnalysisPatternRule['emit'],
): boolean {
  return (
    a.targetFrom === b.targetFrom &&
    (a.operationFrom ?? null) === (b.operationFrom ?? null) &&
    (a.operationValue ?? null) === (b.operationValue ?? null)
  )
}

function conflictMessage(a: StaticAnalysisPatternRule, b: StaticAnalysisPatternRule): string {
  const rankA = SOURCE_RANK[a.source] ?? -1
  const rankB = SOURCE_RANK[b.source] ?? -1
  const base = `Rules "${a.id}" and "${b.id}" overlap on target ${a.target} but emit differently.`
  if (rankA === rankB) {
    return `${base} Both come from source "${a.source}"; resolve by priority/specificity.`
  }
  const winner = rankA > rankB ? a : b
  return `${base} Higher source rank "${winner.source}" (rule "${winner.id}") would win.`
}
