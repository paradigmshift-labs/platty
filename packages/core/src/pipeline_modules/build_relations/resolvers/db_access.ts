// DB access resolver
// SOT: specs/build_relations/architecture.md §5.1

import type { RelationCandidate, SemanticIndex, SourceFallback, ExtractedRelation } from '../types.js'

// Exported for the db_access rule-authoring referee (reuse the real method→operation classification).
export const OPERATION_MAP: Record<string, string> = {
  // select
  findMany: 'select', findUnique: 'select', findUniqueOrThrow: 'select',
  findFirst: 'select', findFirstOrThrow: 'select', count: 'select',
  aggregate: 'select', groupBy: 'select', find: 'select', findOne: 'select',
  findOneBy: 'select', findAll: 'select', findById: 'select', findByPk: 'select', findAndCount: 'select',
  findAndCountAll: 'select', countDocuments: 'select', estimatedDocumentCount: 'select',
  select: 'select', get: 'select', watch: 'select', getSingle: 'select', getSingleOrNull: 'select',
  mget: 'select', exists: 'select', ttl: 'select',
  findOrCreate: 'select',
  // insert
  create: 'insert', createMany: 'insert', bulkCreate: 'insert', insert: 'insert', insertMany: 'insert',
  insertOnConflictUpdate: 'insert', insertReturning: 'insert', insertReturningOrNull: 'insert',
  nativeInsert: 'insert', save: 'insert', persist: 'insert', persistAndFlush: 'insert',
  set: 'insert', setex: 'insert', rpush: 'insert', lpush: 'insert', hset: 'insert', zadd: 'insert',
  // update
  update: 'update', updateOne: 'update', updateMany: 'update', nativeUpdate: 'update',
  upsert: 'update', upsertMany: 'update', replaceOne: 'update',
  findOneAndUpdate: 'update', findByIdAndUpdate: 'update', incr: 'update', decr: 'update', expire: 'update',
  patch: 'update', merge: 'update', restore: 'update',
  // delete
  delete: 'delete', deleteOne: 'delete', deleteMany: 'delete', remove: 'delete', removeMany: 'delete',
  removeAndFlush: 'delete', nativeDelete: 'delete', findOneAndDelete: 'delete', findByIdAndDelete: 'delete', destroy: 'delete',
  softDelete: 'delete', del: 'delete', hdel: 'delete', zrem: 'delete',
  // execute
  execute: 'execute', raw: 'execute', $queryRaw: 'execute', $executeRaw: 'execute',
  queryRaw: 'execute', transaction: 'execute', query: 'execute',
}

export function resolveDbAccessCandidate(
  candidate: RelationCandidate,
  index: SemanticIndex,
  _sourceFallback: SourceFallback,
): ExtractedRelation | null {
  const method = candidate.payload.method as string | undefined
  if (!method) return null

  const orm = candidate.payload.orm as string | undefined
  if (!orm || orm === 'unknown') return null

  const operation = OPERATION_MAP[method] ?? 'execute'
  if (orm === 'redis') {
    const target = extractRedisTarget(candidate.firstArg, candidate.chainPath)
    return {
      sourceNodeId: candidate.sourceNodeId,
      kind: 'db_access',
      target,
      operation,
      canonicalTarget: `db:${target}:${operation}`,
      payload: { ...candidate.payload, orm },
      evidenceNodeIds: candidate.evidenceNodeIds,
      confidence: 'high',
    }
  }

  // tx alias (tx.insert(orders)) → firstArg에서 모델명 추출
  const chainPath = candidate.chainPath ?? ''
  const chainRoot = chainPath.split('.')[0]
  const TX_RE = /^(tx|trx|em|t|transaction)$/
  const firstArg = candidate.firstArg ?? null

  // DI 데코레이터에서 주입된 모델명 (e.g. @InjectModel(User.name) → 'User')
  const injectedModelName = candidate.payload.modelName as string | undefined

  let modelName: string | null
  // a query-builder / tx table LITERAL (tx.insert(orders)) is already the table name → verified like the
  // data path's tableSource:'first_arg'; a model name (chain / DI) needs the model→table map to verify.
  let tableIsLiteral = false
  if (TX_RE.test(chainRoot)) {
    if (!firstArg && orm !== 'prisma') return null
    if (firstArg) {
      modelName = firstArg
      tableIsLiteral = true
    } else {
      modelName = extractModelName(chainPath, method)
    }
  } else if (injectedModelName) {
    modelName = injectedModelName
  } else {
    // chainPath에서 모델명 추출: this.prisma.order.create → 'order'
    modelName = extractModelName(chainPath, method)
  }
  if (!modelName) return null

  // 모델명 → 테이블명 (SemanticIndex modelTablesByModelLower). reconcile #2: a table is VERIFIED only when
  // the model resolves through the model→table map; an unresolved raw model name is a heuristic guess →
  // LOW confidence (so the imperative path stops over-claiming HIGH on an unverified table — symmetric with
  // the data path's resolveTable, the bug the G fix only patched on the data side). See specs/refactor/
  // g2-relations-dataification.md (reconcile #2).
  const normalizedModelName = cleanModelName(modelName)
  const directTable = index.modelTablesByModelLower.get(normalizedModelName.toLowerCase())
  const tableName = directTable ?? normalizedModelName
  const verified = tableIsLiteral || Boolean(directTable)

  return {
    sourceNodeId: candidate.sourceNodeId,
    kind: 'db_access',
    target: tableName,
    operation,
    canonicalTarget: `db:${tableName}:${operation}`,
    payload: { ...candidate.payload, orm, modelName: normalizedModelName, tableName, tableVerified: verified },
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence: verified ? 'high' : 'low',
  }
}

export function extractModelName(chainPath: string, method: string): string | null {
  // this.prisma.order.create → 'order'
  // this.prisma.user.findMany → 'user'
  // this.userModel.find → 'userModel' (Mongoose)
  // tx.insert(orders) → 'orders' (extract from call arg — not available here, use chainPath)
  // getPrismaDB(tx).order.create → 'order'

  if (!chainPath) return null

  // Remove leading receiver (this.xxx or wrapperFn(...))
  // Strip 'this.' prefix
  let path = chainPath
  if (path.startsWith('this.')) {
    path = path.slice(5) // remove 'this.'
  }

  // Remove wrapper function call: getPrismaDB(tx). → ''
  path = path.replace(/^[A-Za-z_][\w]*\([^)]*\)\./, '')

  // Static-member db-client singletons: <AnyClass>.<clientMember>.user.findMany → user. Generic (any owner
  // class name, NOT a repo-specific `SGlobal` hardcoding) — keyed on the known db-client member names.
  path = path.replace(/^[A-Za-z_$][\w$]*\.(prisma(?:Primary|Replica)?|prismaClient|prismaService|db|knex|kysely|sequelize|drizzle|dataSource|em|orm|client|redis|supabase)\./i, '')

  // Strip common ORM receiver names: prisma, db, knex, sequelize, drizzle, userRepo, userModel
  const ORM_RECEIVERS = /^(prisma|prismaClient|prismaService|db|knex|sequelize|drizzle|dataSource|em|orm|client|redis|supabase)\./i
  if (ORM_RECEIVERS.test(path)) {
    path = path.replace(ORM_RECEIVERS, '')
  }

  // tx.user.findMany → 'user'; tx.insert(orders) is handled from firstArg.
  const TX_RE = /^(tx|trx|em|t|transaction)$/
  if (TX_RE.test(path.split('.')[0])) {
    path = path.split('.').slice(1).join('.')
  }

  // What remains is the model name (possibly with chained methods)
  // 'order.create' → 'order', 'user.findMany' → 'user', 'userModel' → 'userModel'
  const modelPart = path.split('.')[0]
  if (!modelPart || modelPart === method) return null
  if (/^(prisma|prismaClient|prismaService|db|knex|sequelize|drizzle|dataSource|em|orm|client|redis|supabase)$/i.test(modelPart)) {
    return null
  }

  return modelPart
}

function cleanModelName(modelName: string): string {
  return modelName
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .split(/\s+as\s+/i)[0]!
    .trim()
}

function extractRedisTarget(firstArg: string | null | undefined, _chainPath: string | null | undefined): string {
  // Redis: key prefix used as target
  // 'user:123' → 'user'
  if (firstArg) {
    const prefix = firstArg.split(':')[0]
    if (prefix && prefix !== firstArg) return prefix
    return firstArg
  }
  return 'cache'
}
