// rule_authoring/promoted_db_access_rules — the growing rulebook of db_access (ORM) rules that passed the
// deterministic referee. Each is the declarative form of an ORM's package list + method→operation map.
// The keystone test re-runs the referee on every entry (each promotes on its example anchor + stays clean
// on the other ORMs), so a rule arrives tested-by-construction. See agent-db-access-rule-loop.md.

import type { DbOperation } from './db_access_types.js'

/** A db_access rule's core data + one representative call so the keystone can build + verify an anchor. */
export interface DbOrmRuleSpec {
  id: string
  ormLabel: string
  clientPackages: string[]
  operationByMethod: Record<string, DbOperation>
  /** a representative call (chainPath gives the model via extractModelName) for the keystone. */
  example: { chainPath: string; method: string; expectedCanonical: string }
}

export const PROMOTED_DB_ACCESS_RULES: DbOrmRuleSpec[] = [
  {
    id: 'rel.db_access.prisma',
    ormLabel: 'prisma',
    clientPackages: ['@prisma/client'],
    operationByMethod: {
      findMany: 'select', findUnique: 'select', findFirst: 'select', count: 'select', aggregate: 'select', groupBy: 'select',
      create: 'insert', createMany: 'insert',
      update: 'update', updateMany: 'update', upsert: 'update',
      delete: 'delete', deleteMany: 'delete',
    },
    example: { chainPath: 'prisma.order', method: 'create', expectedCanonical: 'db:order:insert' },
  },
  {
    id: 'rel.db_access.mongoose',
    ormLabel: 'mongoose',
    clientPackages: ['mongoose'],
    operationByMethod: {
      find: 'select', findOne: 'select', findById: 'select', countDocuments: 'select',
      create: 'insert', insertMany: 'insert',
      updateOne: 'update', updateMany: 'update', findOneAndUpdate: 'update',
      deleteOne: 'delete', deleteMany: 'delete', findOneAndDelete: 'delete',
    },
    // Model.find() → the model is the receiver root
    example: { chainPath: 'User', method: 'find', expectedCanonical: 'db:User:select' },
  },
  {
    id: 'rel.db_access.sequelize',
    ormLabel: 'sequelize',
    clientPackages: ['sequelize'],
    operationByMethod: {
      findAll: 'select', findOne: 'select', findByPk: 'select', findAndCountAll: 'select', count: 'select',
      create: 'insert', bulkCreate: 'insert',
      update: 'update', upsert: 'update',
      destroy: 'delete',
    },
    example: { chainPath: 'Account', method: 'findAll', expectedCanonical: 'db:Account:select' },
  },
]
