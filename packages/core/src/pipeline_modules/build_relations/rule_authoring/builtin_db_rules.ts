// G2 — built-in DB-access DATA rules: the hardcoded imperative ORM adapters expressed as DbAccessEmitRule
// DATA, so the production engine can recognize a known ORM by interpreting data (run by the existing
// emitDbAccessRelationsForRule path) instead of bespoke matchCall code. First family = prisma (chain ORM).
//
// FAITHFUL BY DERIVATION: clientPackages, the method surface (PRISMA_METHODS), and operationByMethod
// (OPERATION_MAP) are all imported from the same sources the imperative adapter + resolver use — so the
// data rule cannot silently diverge on those. The remaining drift risk (detection breadth: ormImportFiles
// file-gate vs traceReceiverIdentity per-receiver gate) is what the dual-run measurement quantifies BEFORE
// any flip. Default-OFF: nothing consumes these until the data-mode flag is on (see specs/refactor/
// g2-relations-dataification.md, measure-then-flip).

import { PRISMA_DB_PACKAGES, MONGOOSE_DB_PACKAGES } from '../adapters/db/packages.js'
import { PRISMA_METHODS } from '../adapters/db/prisma.js'
import { MONGOOSE_METHODS } from '../adapters/db/mongoose.js'
import { OPERATION_MAP } from '../resolvers/db_access.js'
import type { DbAccessEmitRule } from './db_access_promote_gate.js'

/** operationByMethod for an ORM = its handled methods mapped through the shared OPERATION_MAP (no divergence). */
function operationByMethodFor(methods: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of methods) out[m] = OPERATION_MAP[m] ?? 'execute'
  return out
}

/** prisma as data: chain ORM (model from the chain, e.g. prisma.user.findMany → user). */
export const PRISMA_EMIT_RULE: DbAccessEmitRule = {
  ormLabel: 'prisma',
  clientPackages: [...PRISMA_DB_PACKAGES],
  operationByMethod: operationByMethodFor(PRISMA_METHODS),
  tableSource: 'chain',
  requireReceiverIdentity: true, // built-in rule: imperative-precision detection (reconcile #1)
}

/** mongoose as data: chain ORM (model from the @InjectModel-injected receiver, recovered via the G1 query). */
export const MONGOOSE_EMIT_RULE: DbAccessEmitRule = {
  ormLabel: 'mongoose',
  clientPackages: [...MONGOOSE_DB_PACKAGES],
  operationByMethod: operationByMethodFor(MONGOOSE_METHODS),
  tableSource: 'chain',
  requireReceiverIdentity: true, // built-in rule: imperative-precision detection (reconcile #1)
}

/** The built-in DB data rules migrated off imperative adapters so far (grows per family, measure-then-flip). */
export const BUILTIN_DB_ACCESS_RULES: DbAccessEmitRule[] = [PRISMA_EMIT_RULE, MONGOOSE_EMIT_RULE]
