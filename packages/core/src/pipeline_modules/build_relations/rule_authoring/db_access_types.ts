// rule_authoring/db_access_types — agent-authored db_access (ORM) rules + verdict types (slice 2).
// See specs/build_relations/agent-db-access-rule-loop.md. Mirrors the external_service slice but resolves
// a (table, operation) tuple via the REUSED extractModelName + the rule's method→operation map.

import type { BuildRelationsInputs, SemanticIndex } from '../types.js'
import type { GraphQuery } from '@/pipeline_modules/graph_query/index.js'

export type DbOperation = 'select' | 'insert' | 'update' | 'delete' | 'execute'

/**
 * What an agent emits for an ORM/data-client (prisma/typeorm/mongoose/… or a NEW one). The detection +
 * table derivation are the engine's shared machinery; the rule supplies the per-ORM data that varies:
 * which packages signal the client, and how each method maps to a CRUD operation.
 */
export interface DbAccessRuleCandidate {
  id: string
  /** the ORM label (e.g. 'prisma') — LABEL only. */
  ormLabel: string
  /** ORM npm package specifier(s) — detection + NON-EMPTY evidence gate. */
  clientPackages: string[]
  /** method (call targetSymbol) → CRUD operation. Extends the engine's OPERATION_MAP for new methods. */
  operationByMethod: Record<string, DbOperation>
  /**
   * Where the table/model name lives. 'chain' (default): in the receiver chainPath (prisma.user.findMany,
   * User.find). 'first_arg': in the call's first argument (drizzle db.insert(users), kysely
   * db.insertInto('user')) — the query-builder ORMs whose receiver chain carries no model.
   */
  tableSource?: 'chain' | 'first_arg'
  /**
   * G3 (agent-authored graph-query): an OPTIONAL receiver→table traversal for a NON-standard ORM whose
   * model/table the default RECEIVER_MODEL_QUERY can't reach. The agent authors a bounded (≤3 hop) GraphQuery;
   * the engine interprets it (runGraphQuery) and the deterministic referee validates it by running the rule.
   */
  modelQuery?: GraphQuery
  anchorFixture: string
  /** the call-edge ids the rule CLAIMS to catch (evidence). */
  anchorEvidenceEdgeIds: number[]
  /** optional precision oracle: canonicalTargets, e.g. 'db:user:select'. */
  anchorExpectedCanonical?: string[]
  support: { matched: number; examples: string[] }
}

export interface CheckResult {
  pass: boolean
  detail: string
}

export interface DbAccessPromotionInput {
  candidate: DbAccessRuleCandidate
  anchorInputs: BuildRelationsInputs
  anchorIndex: SemanticIndex
  /** other repos that do NOT import the candidate's clientPackages — used to prove no pollution. */
  foreignInputs: { fixture: string; inputs: BuildRelationsInputs; index: SemanticIndex }[]
}

export interface DbAccessPromotionVerdict {
  promote: boolean
  checks: {
    clientPackagesNonEmpty: CheckResult
    anchorReproduction: CheckResult & { expected: number[]; got: number[]; missing: number[] }
    evidenceGate: CheckResult & { candidatesWithEvidenceWithheld: number }
    crossOrmClean: CheckResult & { polluted: { fixture: string; count: number }[] }
    anchorResolutionPrecision?: CheckResult & { overfired: string[] }
  }
  reason: string
}
