// rule_authoring/db_access_promote_gate — deterministic referee for an agent-authored db_access (ORM)
// rule. Like the external_service referee, but resolves a (table, operation) tuple: it REUSES the real
// engine's extractModelName (chainPath → model) + modelTablesByModelLower (model → table), and applies
// the rule's method→operation map. Detection is import-based (a call whose file imports the ORM client),
// so the referee can grade a NEW ORM the global registry doesn't know yet. See spec §2.

import type { BuildRelationsInputs, SemanticIndex, ExtractedRelation } from '../types.js'
import { extractModelName } from '../resolvers/db_access.js'
import { runGraphQuery, type GraphQuery, type GraphAdjacency } from '@/pipeline_modules/graph_query/index.js'
import { traceReceiverIdentity } from '../graph_trace/receiver_identity.js'
import type {
  DbAccessRuleCandidate,
  DbAccessPromotionInput,
  DbAccessPromotionVerdict,
} from './db_access_types.js'

interface Match {
  edgeId: number
  table: string
  operation: string
}

/** File paths that import one of `packages` (the simple-case ORM-client detection). */
function ormImportFiles(inputs: BuildRelationsInputs, index: SemanticIndex, packages: string[]): Set<string> {
  const want = new Set(packages)
  const files = new Set<string>()
  for (const edge of inputs.edges) {
    if (edge.relation !== 'imports' || !edge.targetSpecifier || !want.has(edge.targetSpecifier)) continue
    const fp = index.nodesById.get(edge.sourceId)?.filePath
    if (fp) files.add(fp)
  }
  return files
}

/** F3+F4: db calls in an ORM-importing file whose method the rule classifies, resolved to (table, op). */
function runDetect(
  candidate: DbAccessRuleCandidate,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
  ormFiles: Set<string>,
): Match[] {
  const out: Match[] = []
  for (const node of inputs.nodes) {
    if (!node.filePath || !ormFiles.has(node.filePath)) continue
    for (const call of index.callsBySource.get(node.id) ?? []) {
      const method = call.targetSymbol
      if (!method || typeof call.id !== 'number') continue
      const operation = candidate.operationByMethod[method]
      if (!operation) continue
      // table source: query-builder ORMs (drizzle db.insert(users), kysely db.insertInto('user')) carry
      // the model in the call's first argument; chain ORMs (prisma.user.x, User.find) carry it in chainPath.
      const rawModel =
        candidate.tableSource === 'first_arg'
          ? cleanFirstArgTable(call.firstArg)
          : extractModelName(call.chainPath ?? '', method)
      if (!rawModel) continue
      const { table } = resolveTable(rawModel, candidate.tableSource, node.id, index, candidate.modelQuery)
      out.push({ edgeId: call.id, table, operation })
    }
  }
  return out
}

/** A query-builder ORM's table from the call's first arg: a string literal ('user') or bare identifier. */
function cleanFirstArgTable(firstArg: string | null | undefined): string | null {
  if (!firstArg) return null
  const t = firstArg.replace(/^['"`]|['"`]$/g, '').trim()
  if (!t || t.includes('${') || /[^\w.-]/.test(t)) return null // reject dynamic/templated args
  return t
}

/**
 * def-use receiver-tracing, expressed as DATA (G1 graph-query primitive): a chain receiver that isn't itself a
 * model (e.g. `userRepo` = Repository<User>, `userModel` = Model<User>) → follow the calling method's
 * `resolves_to` edge (build_graph def-use) to the field declaration, then read the model from the field's
 * decorator first-arg or generic type ref. A KNOWN table only — never a guess. The traversal IS the
 * RECEIVER_MODEL_QUERY below, run by the shared bounded interpreter (≤3 hops). Behavior-identical to the prior
 * hardcoded walk (dual-run zero-drift); see specs/refactor/graph-query-primitive.md.
 */
const RECEIVER_MODEL_QUERY: GraphQuery = {
  steps: [
    { edge: 'resolves_to', direction: 'out', viaReceiver: true }, // call-site → field declaration node
    { edge: ['decorates', 'type_ref'], direction: 'out' },        // field → @InjectModel / Repository<User> (terminal)
  ],
  read: { decorates: 'firstArgToken', type_ref: 'targetSymbol' }, // @InjectModel(User.name)→User, Repository<User>→User
  resolveThrough: 'known',                                        // only a model that maps to a real table
}

/** Adjacency adapter over the build_relations SemanticIndex (model→table is the terminal verifier). */
function semanticIndexAdjacency(index: SemanticIndex): GraphAdjacency {
  return {
    out: (id) => index.edgesBySource.get(id) ?? [],
    in: (id) => index.edgesByTarget.get(id) ?? [],
    resolveKnown: (token) => (index.modelTablesByModelLower.has(token.toLowerCase()) ? token : undefined),
  }
}

// G3: the traversal is AUTHORABLE — a rule may ship its own `modelQuery` (a GraphQuery the agent wrote for a
// non-standard ORM, e.g. a 3-hop field→type_ref(entity class)→decorates(@Entity)→table) which the engine
// interprets here instead of the default RECEIVER_MODEL_QUERY. The referee validates it by running the rule.
function traceReceiverModel(callSourceId: string, receiver: string, index: SemanticIndex, query: GraphQuery = RECEIVER_MODEL_QUERY): string | null {
  return runGraphQuery(query, callSourceId, receiver, semanticIndexAdjacency(index))[0] ?? null
}

/**
 * Resolve (table, verified) for a db_access match. chain ORMs map model→table; an unresolved chain receiver
 * is traced via the def-use resolves_to edge; otherwise the raw token is an UNVERIFIED heuristic (low
 * confidence — see B). first_arg ORMs carry the table literally → verified.
 */
function resolveTable(
  rawModel: string,
  tableSource: 'chain' | 'first_arg' | undefined,
  callSourceId: string,
  index: SemanticIndex,
  modelQuery?: GraphQuery, // G3: the rule's authored traversal (default RECEIVER_MODEL_QUERY)
): { table: string; verified: boolean } {
  if (tableSource === 'first_arg') return { table: rawModel, verified: true }
  const direct = index.modelTablesByModelLower.get(rawModel.toLowerCase())
  if (direct) return { table: direct, verified: true }
  const traced = traceReceiverModel(callSourceId, rawModel, index, modelQuery ?? RECEIVER_MODEL_QUERY)
  if (traced) return { table: index.modelTablesByModelLower.get(traced.toLowerCase()) ?? traced, verified: true }
  return { table: rawModel, verified: false }
}

const canonical = (m: Match): string => `db:${m.table}:${m.operation}`

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}

/** Public: run the rule end-to-end over real inputs. Used by the referee, demos, and the keystone. */
export function runDbAccessRule(
  candidate: DbAccessRuleCandidate,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): { matchedEdgeIds: number[]; canonicalTargets: string[] } {
  const matches = runDetect(candidate, inputs, index, ormImportFiles(inputs, index, candidate.clientPackages))
  return {
    matchedEdgeIds: uniq(matches.map((m) => m.edgeId)),
    canonicalTargets: uniq(matches.map(canonical)),
  }
}

/** The minimal data a promoted db_access rule needs to fire in production (subset of DbAccessRuleCandidate). */
export interface DbAccessEmitRule {
  ormLabel: string
  clientPackages: string[]
  operationByMethod: Record<string, string>
  tableSource?: 'chain' | 'first_arg'
  /**
   * G2 reconcile #1: tighten detection to imperative-adapter precision. The file-import gate (ormImportFiles)
   * over-emits on non-ORM receivers in an ORM-importing file (an injected service `this.postService.find()`,
   * a query-result local var `toUser.save()`). When set, an UNVERIFIED emission is kept ONLY if the receiver
   * positively resolves to this ORM's db_client (traceReceiverIdentity) — so unverified non-ORM receivers are
   * dropped, while a verified model (mongoose @InjectModel) or a real db_client whose table just isn't
   * extracted yet (prisma + T5) is still kept. Built-in rules set this true; loop-promoted rules (unknown
   * packages, no imperative twin) leave it off and keep the file gate.
   */
  requireReceiverIdentity?: boolean
  /**
   * G3 (agent-authored graph-query): an OPTIONAL receiver→table traversal the agent wrote for a NON-standard
   * ORM whose model/table isn't reachable by the default RECEIVER_MODEL_QUERY (resolves_to → decorates/
   * type_ref → known model). E.g. a 3-hop field → type_ref(entity class) → decorates(@Entity) → table. The
   * engine interprets it via runGraphQuery; the referee validates it by running the rule (faithful). ≤3 hops.
   */
  modelQuery?: GraphQuery
}

/**
 * Production consumption: emit the db_access relations a promoted rule produces on a real repo. Uses the
 * SAME detection (ormImportFiles + extractModelName + cleanFirstArgTable + operationByMethod) the referee
 * grades with, so what build_relations emits is exactly what was promoted (faithful by construction).
 */
export function emitDbAccessRelationsForRule(
  rule: DbAccessEmitRule,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): ExtractedRelation[] {
  const files = ormImportFiles(inputs, index, rule.clientPackages)
  const out: ExtractedRelation[] = []
  for (const node of inputs.nodes) {
    if (!node.filePath || !files.has(node.filePath)) continue
    for (const call of index.callsBySource.get(node.id) ?? []) {
      const method = call.targetSymbol
      if (!method || typeof call.id !== 'number') continue
      const operation = rule.operationByMethod[method]
      if (!operation) continue
      const rawModel = rule.tableSource === 'first_arg'
        ? cleanFirstArgTable(call.firstArg)
        : extractModelName(call.chainPath ?? '', method)
      if (!rawModel) continue
      // resolveTable maps model→table, then def-use receiver-tracing for an unresolved chain receiver
      // (`userRepo` → resolves_to field → @InjectModel/Model<User> → User), else the unverified heuristic
      // at low confidence (so a wrong table can't masquerade as verified).
      const { table, verified } = resolveTable(rawModel, rule.tableSource, node.id, index, rule.modelQuery)
      // reconcile #1: drop an UNVERIFIED emission unless the receiver positively resolves to this ORM's
      // db_client — matches the imperative adapter's receiver-identity precision (no file-gate over-emit).
      if (rule.requireReceiverIdentity && !verified) {
        const identity = traceReceiverIdentity({ nodeId: node.id, chainPath: call.chainPath ?? '', index, maxHops: 5 })
        if (!(identity?.kind === 'db_client' && identity.orm === rule.ormLabel)) continue
      }
      out.push({
        sourceNodeId: node.id,
        kind: 'db_access',
        target: table,
        operation,
        canonicalTarget: `db:${table}:${operation}`,
        payload: { orm: rule.ormLabel, method, tableName: table, promotedRuleOrm: rule.ormLabel, tableVerified: verified },
        evidenceNodeIds: [`edge:${call.id}`],
        confidence: verified ? 'high' : 'low',
      })
    }
  }
  return out
}

export function evaluateDbAccessRuleForPromotion(input: DbAccessPromotionInput): DbAccessPromotionVerdict {
  const { candidate, anchorInputs, anchorIndex, foreignInputs } = input

  const clientPackagesNonEmpty = {
    pass: candidate.clientPackages.length > 0,
    detail: candidate.clientPackages.length > 0
      ? `gated on [${candidate.clientPackages.join(', ')}]`
      : 'clientPackages is empty — rule would fire in every repo',
  }

  const anchorFiles = ormImportFiles(anchorInputs, anchorIndex, candidate.clientPackages)
  const matches = runDetect(candidate, anchorInputs, anchorIndex, anchorFiles)
  const got = uniq(matches.map((m) => m.edgeId))
  const missing = candidate.anchorEvidenceEdgeIds.filter((id) => !got.includes(id))
  const anchorReproduction = {
    pass: candidate.anchorEvidenceEdgeIds.length > 0 && missing.length === 0,
    expected: candidate.anchorEvidenceEdgeIds,
    got,
    missing,
    detail:
      candidate.anchorEvidenceEdgeIds.length === 0
        ? 'no anchorEvidenceEdgeIds declared — cite the db call edges the rule catches'
        : missing.length === 0
          ? `reproduced all ${candidate.anchorEvidenceEdgeIds.length} anchor edge(s)`
          : `missed anchor edge(s): ${missing.join(', ')}`,
  }

  const withheld = runDetect(candidate, anchorInputs, anchorIndex, new Set())
  const evidenceGate = {
    pass: withheld.length === 0,
    candidatesWithEvidenceWithheld: withheld.length,
    detail: withheld.length === 0
      ? 'detects nothing once its ORM imports are withheld'
      : `still detects ${withheld.length} call(s) without its import evidence — not self-gating`,
  }

  const polluted: { fixture: string; count: number }[] = []
  for (const fg of foreignInputs) {
    const files = ormImportFiles(fg.inputs, fg.index, candidate.clientPackages)
    const m = runDetect(candidate, fg.inputs, fg.index, files)
    if (m.length > 0) polluted.push({ fixture: fg.fixture, count: m.length })
  }
  const crossOrmClean = {
    pass: polluted.length === 0,
    polluted,
    detail: polluted.length === 0
      ? `clean on ${foreignInputs.length} foreign repo(s)`
      : `pollutes ${polluted.length} foreign repo(s): ${polluted.map((p) => `${p.fixture}(${p.count})`).join(', ')}`,
  }

  let anchorResolutionPrecision: DbAccessPromotionVerdict['checks']['anchorResolutionPrecision']
  if (candidate.anchorExpectedCanonical) {
    const expected = new Set(candidate.anchorExpectedCanonical)
    const produced = uniq(matches.map(canonical))
    const overfired = produced.filter((c) => !expected.has(c))
    anchorResolutionPrecision = {
      pass: overfired.length === 0,
      overfired,
      detail: overfired.length === 0
        ? 'every resolved relation is in the anchor answer-key'
        : `resolved ${overfired.length} relation(s) outside the answer-key: ${overfired.join(', ')}`,
    }
  }

  const promote =
    clientPackagesNonEmpty.pass &&
    anchorReproduction.pass &&
    evidenceGate.pass &&
    crossOrmClean.pass &&
    (anchorResolutionPrecision?.pass ?? true)

  const failed = [
    !clientPackagesNonEmpty.pass && 'clientPackagesNonEmpty',
    !anchorReproduction.pass && 'anchorReproduction',
    !evidenceGate.pass && 'evidenceGate',
    !crossOrmClean.pass && 'crossOrmClean',
    anchorResolutionPrecision && !anchorResolutionPrecision.pass && 'anchorResolutionPrecision',
  ].filter(Boolean)

  return {
    promote,
    checks: { clientPackagesNonEmpty, anchorReproduction, evidenceGate, crossOrmClean, ...(anchorResolutionPrecision ? { anchorResolutionPrecision } : {}) },
    reason: promote
      ? `promote: db_access rule '${candidate.id}' passed all checks`
      : `reject: db_access rule '${candidate.id}' failed [${failed.join(', ')}]`,
  }
}
