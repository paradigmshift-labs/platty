// DB access candidate extractor
// SOT: specs/build_relations/architecture.md §5.1

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { BuildRelationsInputs, SemanticIndex, RelationCandidate, CodeEdgeLike, CodeNodeLike } from '../types.js'
import { relationCandidateAdapters } from '../adapters/registry.js'
import { isOpaqueRedisKey } from '../adapters/db/redis.js'
import { detectOrmFromPackage, isDbClientPackage } from '../adapters/db/packages.js'
import { detectStaticMemberDbClientOrm } from '../db_client_evidence.js'

// ORM 클래스/심볼 anchor
const ORM_CLASS_ANCHOR_RE = /PrismaClient|PrismaService|DataSource|EntityManager|Connection|Repository<|Model<|Sequelize|Drizzle|NodePgDatabase|Redis|IORedis/

// ORM DI 데코레이터
const ORM_DECORATOR_RE = /^(InjectRepository|InjectModel|Inject)$/

// DB 메서드 목록 (select/insert/update/delete/execute)
const DB_METHODS_SELECT = new Set([
  'findMany', 'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'count', 'aggregate', 'groupBy', 'find', 'findOne', 'findAll', 'findById',
  'findByPk', 'findAndCount', 'findAndCountAll', 'findOrCreate', 'countDocuments',
  'estimatedDocumentCount', 'select', 'query', 'get', 'mget', 'exists', 'ttl',
])
const DB_METHODS_INSERT = new Set([
  'create', 'createMany', 'bulkCreate', 'insert', 'insertMany', 'nativeInsert',
  'save', 'persist', 'persistAndFlush', 'set', 'setex', 'rpush', 'lpush', 'hset', 'zadd',
])
const DB_METHODS_UPDATE = new Set([
  'update', 'updateOne', 'updateMany', 'nativeUpdate', 'upsert', 'upsertMany', 'replaceOne',
  'findOneAndUpdate', 'findByIdAndUpdate', 'incr', 'decr', 'expire', 'patch', 'merge',
])
const DB_METHODS_DELETE = new Set([
  'delete', 'deleteOne', 'deleteMany', 'remove', 'removeMany', 'removeAndFlush',
  'nativeDelete', 'findOneAndDelete', 'findByIdAndDelete', 'destroy', 'del', 'hdel', 'zrem',
])
const DB_METHODS_EXECUTE = new Set(['execute', 'query', 'raw', '$queryRaw', '$executeRaw', 'queryRaw', 'transaction'])

// chain path에서 동적 접근 패턴 감지 (prisma[model])
const DYNAMIC_CHAIN_RE = /\[/

// transaction callback parameter name 패턴
const TX_ALIAS_RE = /^(tx|trx|em|t|transaction)$/

const EXECUTABLE_NODE_TYPES = new Set(['method', 'function', 'constructor', 'arrow_function', 'handler'])

export function extractDbAccessCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  const candidates: RelationCandidate[] = []

  for (const node of inputs.nodes) {
    const calls = index.callsBySource.get(node.id) ?? []

    for (const callEdge of calls) {
      const method = callEdge.targetSymbol
      if (!method) continue

      const adapterCandidate = matchDbAdapterCandidate(callEdge, node.id, inputs, index)
      if (adapterCandidate) {
        candidates.push(anchorDbCandidate(adapterCandidate, index))
        continue
      }

      if (!isDbMethod(method)) continue
      if (method === 'transaction' || method === '$transaction') continue

      const chainPath = callEdge.chainPath ?? ''
      if (!chainPath) continue

      // 동적 접근 → no candidate
      if (DYNAMIC_CHAIN_RE.test(chainPath)) continue
      if (isDynamicRepositoryFactory(chainPath)) continue
      if (isDynamicModelFactory(chainPath)) continue
      if (isKyselyBuilderTerminal(method, chainPath)) continue
      if (isRedisMethod(method) && isOpaqueRedisKey(callEdge.firstArg)) continue

      // anchor 검증: ORM anchor가 있어야 함
      const anchorKind = detectDbAnchor(node.id, chainPath, index)
      if (!anchorKind) continue

      const evidenceIds = [`edge:${callEdge.id}`]

      candidates.push(anchorDbCandidate({
        kind: 'db_access',
        sourceNodeId: node.id,
        evidenceNodeIds: evidenceIds,
        receiver: chainPath,
        targetSymbol: method,
        chainPath,
        firstArg: callEdge.firstArg,
        payload: {
          orm: anchorKind.orm,
          method,
          ...(anchorKind.modelName != null && { modelName: anchorKind.modelName }),
        },
      }, index))
    }

    candidates.push(...extractSourceStaticDbCandidates(inputs, node).map((candidate) =>
      anchorDbCandidate(candidate, index),
    ))
  }

  return candidates
}

function anchorDbCandidate(candidate: RelationCandidate, index: SemanticIndex): RelationCandidate {
  const anchored = anchorDbSourceNodeId(candidate, index)
  if (!anchored.rawSourceNodeId) return candidate
  return withAnchoredDbSource(
    { ...candidate, sourceNodeId: anchored.sourceNodeId },
    anchored.rawSourceNodeId,
  )
}

function anchorDbSourceNodeId(candidate: RelationCandidate, index: SemanticIndex): {
  sourceNodeId: string
  rawSourceNodeId?: string
} {
  const sourceNodeId = candidate.sourceNodeId
  const sourceNode = index.nodesById.get(sourceNodeId)
  if (!sourceNode) return { sourceNodeId }
  if (EXECUTABLE_NODE_TYPES.has(sourceNode.type)) return { sourceNodeId }

  const executable = findNearestExecutableInSameFile(sourceNode, index, candidate)
  if (!executable) return { sourceNodeId }
  return { sourceNodeId: executable.id, rawSourceNodeId: sourceNodeId }
}

function findNearestExecutableInSameFile(
  sourceNode: CodeNodeLike,
  index: SemanticIndex,
  candidate: RelationCandidate,
): CodeNodeLike | null {
  if (!sourceNode.filePath || sourceNode.lineStart == null || sourceNode.lineEnd == null) return null

  const candidates = (index.nodesByFile.get(sourceNode.filePath) ?? []).filter((node) => {
    if (!EXECUTABLE_NODE_TYPES.has(node.type)) return false
    if (node.lineStart == null || node.lineEnd == null) return false
    return node.lineStart >= sourceNode.lineStart! && node.lineEnd <= sourceNode.lineEnd!
  })
  if (candidates.length === 1) return candidates[0]!

  const scored = candidates
    .map((node) => ({ node, score: dbExecutableMatchScore(node, candidate) }))
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score || spanSize(left.node) - spanSize(right.node) || left.node.id.localeCompare(right.node.id))
  const best = scored[0]
  const next = scored[1]
  if (best && (!next || best.score > next.score)) {
    return best.node
  }
  return null
}

function spanSize(node: CodeNodeLike): number {
  return Math.max(0, (node.lineEnd ?? node.lineStart ?? 0) - (node.lineStart ?? 0))
}

function dbExecutableMatchScore(node: CodeNodeLike, candidate: RelationCandidate): number {
  const name = node.name.toLowerCase()
  const modelName = dbModelHint(candidate)
  const method = candidate.targetSymbol?.toLowerCase() ?? ''
  let score = 0
  if (modelName && name.includes(modelName.toLowerCase())) score += 3
  if (method && name.includes(operationNameForMethod(method))) score += 2
  return score
}

function dbModelHint(candidate: RelationCandidate): string | null {
  const payload = candidate.payload as Record<string, unknown>
  const fromPayload = [payload.modelName, payload.tableName, payload.table]
    .find((value): value is string => typeof value === 'string' && value.length > 0)
  if (fromPayload) return fromPayload
  const chainParts = candidate.chainPath?.split('.').map((part) => part.trim()).filter(Boolean) ?? []
  if (chainParts.length >= 2) return chainParts[chainParts.length - 1] ?? null
  return null
}

function operationNameForMethod(method: string): string {
  if (DB_METHODS_SELECT.has(method)) return method === 'count' ? 'count' : 'get'
  if (DB_METHODS_INSERT.has(method)) return 'create'
  if (DB_METHODS_UPDATE.has(method)) return 'update'
  if (DB_METHODS_DELETE.has(method)) return 'delete'
  return method
}

function withAnchoredDbSource(candidate: RelationCandidate, rawSourceNodeId: string): RelationCandidate {
  if (rawSourceNodeId === candidate.sourceNodeId) return candidate
  return {
    ...candidate,
    payload: {
      ...candidate.payload,
      sourceAnchoring: {
        rawSourceNodeId,
        anchoredSourceNodeId: candidate.sourceNodeId,
        strategy: 'nearest_executable_ancestor',
      },
    },
  }
}

function extractSourceStaticDbCandidates(
  inputs: BuildRelationsInputs,
  node: CodeNodeLike,
): RelationCandidate[] {
  const source = readNodeSource(inputs, node)
  if (!source) return []

  // (The hardcoded `SGlobal.prisma` source-text regex was REMOVED — it was a repo-specific crutch. The
  // static-member singleton `SGlobal.prisma.<model>.<method>()` is now recognized GENERICALLY: build_graph
  // emits the call edge (chainPath='SGlobal.prisma.<model>') + the static `prisma` property + its
  // `new PrismaClient()` import, so detectStaticMemberDbClientOrm resolves it by the property's TYPE — no
  // class-name hardcoding. See specs/refactor/g2-relations-dataification.md (crutch cleanup).)
  const candidates: RelationCandidate[] = []

  const fileSource = readFileSource(inputs, node)
  if (!hasSourceKyselyEvidence(source) && !(fileSource && hasSourceKyselyEvidence(fileSource))) return candidates
  for (const match of source.matchAll(/\.\s*(selectFrom|insertInto|updateTable|deleteFrom)\s*\(\s*(['"`])([^'"`]+)\2/g)) {
    const method = match[1]!
    const firstArg = match[3]!
    candidates.push({
      kind: 'db_access',
      sourceNodeId: node.id,
      evidenceNodeIds: [`node:${node.id}:source_static_db_call`],
      receiver: null,
      targetSymbol: method,
      chainPath: 'trx',
      firstArg,
      payload: {
        orm: 'kysely',
        method: KYSELY_SOURCE_METHODS[method] ?? 'execute',
        adapter: 'source_static_db_call',
      },
    })
  }

  return candidates
}

const KYSELY_SOURCE_METHODS: Record<string, string> = {
  selectFrom: 'select',
  insertInto: 'insert',
  updateTable: 'update',
  deleteFrom: 'delete',
}

function hasSourceKyselyEvidence(source: string): boolean {
  // generic only: the kysely package import or a Kysely `Transaction<…>` type. (The repo-specific
  // `SGlobal.kysely` evidence was removed — same family as the SGlobal.prisma cleanup; the static-member
  // `<Class>.kysely.selectFrom(...)` is recognized via the graph + the generic source import.)
  return /\bfrom\s+['"]kysely['"]/.test(source) || /\bTransaction\s*</.test(source)
}

function isKyselyBuilderTerminal(method: string, chainPath: string): boolean {
  if (!/^(execute|executeTakeFirst|executeTakeFirstOrThrow)$/.test(method)) return false
  return /\.(?:selectFrom|insertInto|updateTable|deleteFrom)\s*\(/.test(chainPath)
}

function readNodeSource(inputs: BuildRelationsInputs, node: CodeNodeLike): string | null {
  if (!inputs.repoPath || !node.filePath || node.lineStart == null) return null

  const root = resolve(inputs.repoPath)
  const fullPath = isAbsolute(node.filePath) ? resolve(node.filePath) : resolve(root, node.filePath)
  const rel = relative(root, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(fullPath)) return null

  try {
    const lines = readFileSync(fullPath, 'utf8').split(/\r?\n/)
    const start = Math.max(0, node.lineStart - 1)
    const end = Math.min(lines.length, Math.max(node.lineEnd ?? lines.length, start + 1))
    return lines.slice(start, end).join('\n')
  } catch {
    return null
  }
}

function readFileSource(inputs: BuildRelationsInputs, node: CodeNodeLike): string | null {
  if (!inputs.repoPath || !node.filePath) return null

  const root = resolve(inputs.repoPath)
  const fullPath = isAbsolute(node.filePath) ? resolve(node.filePath) : resolve(root, node.filePath)
  const rel = relative(root, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(fullPath)) return null

  try {
    return readFileSync(fullPath, 'utf8')
  } catch {
    return null
  }
}

function isRedisMethod(method: string): boolean {
  return /^(get|mget|exists|ttl|set|setex|hset|zadd|rpush|lpush|incr|decr|expire|del|hdel|zrem)$/.test(method)
}

function matchDbAdapterCandidate(
  callEdge: CodeEdgeLike,
  sourceNodeId: string,
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate | null {
  for (const adapter of relationCandidateAdapters) {
    if (adapter.relationKind !== 'db_access') continue
    const candidate = adapter.matchCall(callEdge, sourceNodeId, { inputs, index, maxTraceHops: 5 })
    if (candidate) return candidate
  }
  return null
}

function isDbMethod(method: string): boolean {
  return DB_METHODS_SELECT.has(method) ||
    DB_METHODS_INSERT.has(method) ||
    DB_METHODS_UPDATE.has(method) ||
    DB_METHODS_DELETE.has(method) ||
    DB_METHODS_EXECUTE.has(method)
}

function isDynamicRepositoryFactory(chainPath: string): boolean {
  const match = chainPath.match(/\bget(?:Tree|Mongo)?Repository\(([^)]+)\)/)
  if (!match) return false
  const arg = match[1]?.trim()
  if (!arg) return true
  return !/^([A-Z][A-Za-z0-9_$]*|['"`][A-Za-z_][\w]*['"`])$/.test(arg)
}

function isDynamicModelFactory(chainPath: string): boolean {
  const match = chainPath.match(/\bmodel\(([^)]+)\)/)
  if (!match) return false
  const arg = match[1]?.trim()
  if (!arg) return true
  return !/^([A-Z][A-Za-z0-9_$]*(?:\.name)?|['"`][A-Za-z_][\w]*['"`])$/.test(arg)
}

interface AnchorResult {
  orm: string
  modelName?: string | null  // DI 데코레이터에서 추출된 모델명 (e.g. @InjectModel(User.name))
}

function detectDbAnchor(
  nodeId: string,
  chainPath: string,
  index: SemanticIndex,
): AnchorResult | null {
  const staticMemberOrm = detectStaticMemberDbClientOrm(chainPath, index)
  if (staticMemberOrm) {
    return { orm: staticMemberOrm }
  }

  // 1. transaction alias: tx.insert(...) / trx.user.findMany(...)
  const chainRoot = chainPath.split('.')[0]
  if (chainRoot && TX_ALIAS_RE.test(chainRoot)) {
    if (!hasTransactionCallEvidence(nodeId, index)) return null
    const transactionOrm = findOrmFromTransactionCall(nodeId, index)
    if (transactionOrm) return { orm: transactionOrm }
    // tx 사용: 상위 scope에서 ORM anchor가 있는지 확인
    // 보수적으로: tx alias가 있으면 drizzle/knex/typeorm 가능성 인정
    const ormFromImport = findOrmFromImports(nodeId, index)
    if (ormFromImport) return { orm: ormFromImport }
    // 부모 클래스의 imports 확인
    const parentId = index.containsParentByChild.get(nodeId)
    if (parentId) {
      const parentOrm = findOrmFromImports(parentId, index)
      if (parentOrm) return { orm: parentOrm }
    }
    return null
  }

  // 2. this.xxx 패턴 → class field origin 확인
  if (chainPath.startsWith('this.')) {
    const fieldName = extractFieldName(chainPath)
    if (!fieldName) return null
    // class field origin에서 ORM 확인
    const parentId = index.containsParentByChild.get(nodeId)
    if (parentId) {
      const fields = index.classFieldOrigins.get(parentId)
      const origin = fields?.get(fieldName)
      if (origin && (origin.originKind === 'di' || origin.originKind === 'constructor')) {
        const orm = detectOrmFromTypeName(origin.typeName, origin.packageName)
        if (orm) return { orm }
      }
    }

    // DI decorator 직접 확인
    const decorators = index.decoratorsBySource.get(nodeId) ?? []
    const injectDecorator = decorators.find((d) => d.targetSymbol && ORM_DECORATOR_RE.test(d.targetSymbol))
    if (injectDecorator) {
      const modelName = injectDecorator.firstArg ?? null
      const ormFromImport = findOrmFromImports(nodeId, index)
      if (ormFromImport) return { orm: ormFromImport, modelName }
      // 부모 class의 imports
      const parentClassId = index.containsParentByChild.get(nodeId)
      if (parentClassId) {
        const parentOrm = findOrmFromImports(parentClassId, index)
        if (parentOrm) return { orm: parentOrm, modelName }
      }
      // 같은 파일의 import에서 ORM 확인 (modelName 보존)
      const fileOrm = findOrmFromImportsByFile(nodeId, index)
      if (fileOrm) return { orm: fileOrm, modelName }
    }

    // type_ref / uses_type로 ORM 타입 참조 확인
    const typeRefs = index.typeRefsBySource.get(nodeId) ?? []
    for (const ref of typeRefs) {
      if (ref.targetSymbol && ORM_CLASS_ANCHOR_RE.test(ref.targetSymbol)) {
        const orm = detectOrmFromTypeName(ref.targetSymbol, ref.targetSpecifier)
        if (orm) return { orm }
      }
    }

    // 직접 import anchor 확인 (node 자체 또는 file 노드)
    const fileOrm = findOrmFromImportsByFile(nodeId, index)
    if (fileOrm) return { orm: fileOrm }

    return null
  }

  // 3. wrapper function: getPrismaDB(tx).order.create(...)
  // chainPath가 functionCall().model 패턴
  const wrapperMatch = chainPath.match(/^([A-Za-z_][\w]*)[\.(]/)
  if (wrapperMatch) {
    const wrapperName = wrapperMatch[1]
    // Identity comes from the wrapper's db_client marking (import / extends / type_ref / depends_on
    // evidence in buildWrapperFunctions), NOT from the wrapper's NAME — so generically-named
    // wrappers (conn, txClient, getConnection) resolve too. Safety: only functions actually marked
    // kind:'db_client' match, and the trigger is a `wrapper().model.method` chain (so a function
    // that merely uses but doesn't return a db client never mints a relation).
    for (const [wrapperNodeId, wrapper] of index.wrapperFunctions) {
      const wrapperNode = index.nodesById.get(wrapperNodeId)
      if (wrapperNode?.name === wrapperName && wrapper.kind === 'db_client') {
        return { orm: detectOrmFromPackage(wrapper.targetPackage) }
      }
    }
  }

  // 4. 직접 prisma/orm variable (not this.xxx)
  // e.g. prisma.user.findMany() where `prisma` is imported from a local DB client.
  const directOrm = detectDirectOrmReceiver(nodeId, chainRoot, index)
  if (directOrm) return { orm: directOrm }

  // local variable with no DB-client evidence → no-emit
  return null
}

function hasTransactionCallEvidence(nodeId: string, index: SemanticIndex): boolean {
  return (index.callsBySource.get(nodeId) ?? []).some((call) =>
    call.targetSymbol === '$transaction' || call.targetSymbol === 'transaction',
  )
}

function findOrmFromTransactionCall(nodeId: string, index: SemanticIndex): string | null {
  for (const call of index.callsBySource.get(nodeId) ?? []) {
    if (call.targetSymbol !== '$transaction' && call.targetSymbol !== 'transaction') continue
    const staticMemberOrm = detectStaticMemberDbClientOrm(call.chainPath ?? '', index)
    if (staticMemberOrm) return staticMemberOrm
    const receiverOrm = detectOrmFromReceiverName(call.chainPath ?? '')
    if (receiverOrm) return receiverOrm
  }
  return null
}

function detectOrmFromReceiverName(receiver: string): string | null {
  if (/\bprisma\b/i.test(receiver)) return 'prisma'
  if (/\bkysely\b/i.test(receiver)) return 'kysely'
  if (/\bknex\b/i.test(receiver)) return 'knex'
  if (/\bdrizzle\b/i.test(receiver)) return 'drizzle'
  if (/\bsequelize\b/i.test(receiver)) return 'sequelize'
  return null
}

function extractFieldName(chainPath: string): string | null {
  // this.prisma.user.findMany → prisma
  // this.userRepo.find → userRepo
  // this.redis.set → redis
  const match = chainPath.match(/^this\.([A-Za-z_][\w]*)/)
  return match?.[1] ?? null
}

function findOrmFromImports(nodeId: string, index: SemanticIndex): string | null {
  const imports = index.importsBySource.get(nodeId) ?? []
  for (const imp of imports) {
    const pkg = imp.targetSpecifier
    if (isDbClientPackage(pkg)) {
      return detectOrmFromPackage(pkg)
    }
  }
  return null
}

function findOrmFromImportsByFile(nodeId: string, index: SemanticIndex): string | null {
  const node = index.nodesById.get(nodeId)
  if (!node) return null
  // 같은 파일의 모든 노드에서 import 확인
  const fileNodes = index.nodesByFile.get(node.filePath) ?? []
  for (const fileNode of fileNodes) {
    const orm = findOrmFromImports(fileNode.id, index)
    if (orm) return orm
  }
  return null
}

function detectDirectOrmReceiver(
  nodeId: string,
  receiver: string,
  index: SemanticIndex,
): string | null {
  /* v8 ignore next -- caller skips empty chainPath before deriving the receiver root. */
  if (!receiver) return null

  // Common exported singleton names. Keep this conservative: these names must
  // appear as the call receiver root, so generic `db` is still checked by import
  // evidence below instead of accepted blindly.
  const node = index.nodesById.get(nodeId)
  if (!node) return null
  const fileNodes = index.nodesByFile.get(node.filePath) ?? []

  for (const fileNode of fileNodes) {
    const imports = index.importsBySource.get(fileNode.id) ?? []
    const imported = imports.find((imp) => imp.targetSymbol === receiver && imp.targetId)
    if (!imported?.targetId) continue

    const importedNode = index.nodesById.get(imported.targetId)
    const importedName = importedNode?.name ?? receiver
    /* v8 ignore next -- missing imported nodes are covered as no-emit; V8 keeps the fallback branch separate. */
    const importedFileNodes = importedNode ? (index.nodesByFile.get(importedNode.filePath) ?? []) : []

    const byName = detectOrmFromTypeName(importedName, null)
    if (byName !== 'unknown') return byName

    for (const importedFileNode of importedFileNodes) {
      const importOrm = findOrmFromImports(importedFileNode.id, index)
      if (importOrm) return importOrm

      for (const ref of index.typeRefsBySource.get(importedFileNode.id) ?? []) {
        const refOrm = detectOrmFromTypeName(ref.targetSymbol, ref.targetSpecifier)
        if (refOrm !== 'unknown') return refOrm
      }

      for (const call of index.callsBySource.get(importedFileNode.id) ?? []) {
        const callOrm = detectOrmFromTypeName(call.targetSymbol, call.targetSpecifier)
        if (callOrm !== 'unknown') return callOrm
      }
    }
  }

  return null
}

function detectOrmFromTypeName(typeName: string | null | undefined, pkg: string | null | undefined): string {
  if (pkg) return detectOrmFromPackage(pkg)
  if (!typeName) return 'unknown'
  if (/Prisma/.test(typeName)) return 'prisma'
  if (/TypeOrm|EntityManager|DataSource|Repository</.test(typeName)) return 'typeorm'
  if (/Mongoose|Model/.test(typeName)) return 'mongoose'
  if (/Sequelize/.test(typeName)) return 'sequelize'
  if (/Drizzle|NodePgDatabase/.test(typeName)) return 'drizzle'
  if (/Redis|IORedis/.test(typeName)) return 'redis'
  return 'unknown'
}

export { isDbMethod, detectOrmFromPackage }
export type { AnchorResult }
