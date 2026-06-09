import type { CodeEdgeLike, SemanticIndex } from '../types.js'
import { detectOrmFromPackage, isDbClientPackage } from '../adapters/db/packages.js'
import { detectStaticMemberDbClientOrm } from '../db_client_evidence.js'
import type { ReceiverIdentity, ReceiverTraceInput, TraceEvidence } from './types.js'

const DEFAULT_MAX_HOPS = 5

export function traceReceiverIdentity(input: ReceiverTraceInput): ReceiverIdentity | null {
  const maxHops = input.maxHops ?? DEFAULT_MAX_HOPS
  const root = getReceiverRoot(input.chainPath)
  if (!root) return null

  const evidence: TraceEvidence[] = []

  const txIdentity = traceTransactionAlias(input.nodeId, root, input.index, maxHops, evidence)
  if (txIdentity) return txIdentity

  if (input.chainPath.startsWith('this.')) {
    const fieldIdentity = traceThisField(input.nodeId, root, input.index, maxHops, evidence)
    if (fieldIdentity) return fieldIdentity
  }

  const wrapperIdentity = traceWrapperFunction(root, input.index, maxHops, evidence)
  if (wrapperIdentity) return wrapperIdentity

  const importedIdentity = traceImportedReceiver(input.nodeId, root, input.index, maxHops, evidence)
  if (importedIdentity) return importedIdentity
  if (hasImportedReceiver(input.nodeId, root, input.index)) return null

  // G6 (def-use precision): follow the def-use `resolves_to` edge build_graph emits from the call site to THIS
  // receiver's declaration (`const <root> = …`), then read the DECLARATION's own db evidence — its `new
  // <DbClient>()` constructor call / db type_ref / db-package import. The identity is the LIBRARY CONSTRUCTOR on
  // the resolved declaration, NOT the variable name, so `const orm = new PrismaClient()` resolves identically to
  // `const prisma = new PrismaClient()`. This runs BEFORE the name crutch so precision wins; the crutch stays
  // only as a strictly-lower-priority fallback (receivers this walk can't reach: DI-field / method-return /
  // factory-init). See specs/refactor/g6-defuse-receiver-identity.md.
  const defUseIdentity = traceDefUseDeclaration(input.nodeId, root, input.index, maxHops, evidence)
  if (defUseIdentity) return defUseIdentity

  // LAST-RESORT heuristic (a DEMOTED name crutch, kept for COVERAGE the def-use walk above can't reach): when
  // the precise paths don't resolve the receiver but the FILE has db-client evidence AND the receiver NAME looks
  // db-like, attribute it. It IS a name guess (looksLikeDbReceiver), not generic resolution — load-bearing only
  // for DI-field / method-return / factory-init receivers (e.g. `this.prismaService.x()`, `const db =
  // getPrisma()`) that have no `new <DbClient>()` declaration to walk. Removing it drops those (verified:
  // nestjs/prisma-example-rest db_access 4→1). Recorded in docs/system_limitations.md.
  const sameFileIdentity = traceSameFileOrmEvidence(input.nodeId, input.index, evidence)
  if (sameFileIdentity && looksLikeDbReceiver(root)) return sameFileIdentity

  return null
}

export function getReceiverRoot(chainPath: string): string | null {
  if (!chainPath) return null
  const withoutThis = chainPath.startsWith('this.') ? chainPath.slice('this.'.length) : chainPath
  const callMatch = withoutThis.match(/^([A-Za-z_$][\w$]*)\s*\(/)
  if (callMatch) return callMatch[1] ?? null
  const root = withoutThis.split('.')[0]
  return root || null
}

export function detectOrmFromTypeName(typeName: string | null | undefined, pkg: string | null | undefined): string {
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

function traceTransactionAlias(
  nodeId: string,
  root: string,
  index: SemanticIndex,
  maxHops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  if (!/^(tx|trx|em|t|transaction)$/.test(root)) return null
  if (!hasTransactionCallEvidence(nodeId, index)) return null
  const identity = traceSameFileOrmEvidence(nodeId, index, evidence)
  if (!identity) return null
  return { ...identity, confidence: 'medium', hops: Math.min(identity.hops + 1, maxHops) }
}

function hasTransactionCallEvidence(nodeId: string, index: SemanticIndex): boolean {
  return (index.callsBySource.get(nodeId) ?? []).some((call) =>
    call.targetSymbol === '$transaction' || call.targetSymbol === 'transaction',
  )
}

function traceThisField(
  nodeId: string,
  fieldName: string,
  index: SemanticIndex,
  maxHops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  const parentId = index.containsParentByChild.get(nodeId)
  if (parentId) {
    const fields = index.classFieldOrigins.get(parentId)
    const origin = fields?.get(fieldName)
    if (origin) {
      evidence.push(...origin.evidenceNodeIds.map((id) => ({ reason: 'class_field_origin', nodeId: id })))
      const orm = detectOrmFromTypeName(origin.typeName, origin.packageName)
      if (orm !== 'unknown') {
        return {
          kind: 'db_client',
          packageName: origin.packageName ?? null,
          typeName: origin.typeName ?? null,
          orm,
          confidence: origin.originKind === 'unknown' ? 'low' : 'high',
          hops: 1,
          evidence,
        }
      }
      if (origin.typeName) {
        const target = traceTypeByName(origin.typeName, nodeId, index, maxHops, evidence)
        if (target) return { ...target, hops: Math.min(target.hops + 1, maxHops) }
      }
    }

    const staticMemberIdentity = traceThisFieldStaticMemberAlias(parentId, fieldName, index, evidence)
    if (staticMemberIdentity) return staticMemberIdentity
  }

  for (const ref of index.typeRefsBySource.get(nodeId) ?? []) {
    const orm = detectOrmFromTypeName(ref.targetSymbol, ref.targetSpecifier)
    if (orm !== 'unknown') {
      return identityFromEdge(ref, orm, 'method_type_ref', 1, evidence)
    }
    if (ref.targetSymbol) {
      const target = traceTypeByName(ref.targetSymbol, nodeId, index, maxHops, evidence)
      if (target) return { ...target, hops: Math.min(target.hops + 1, maxHops) }
    }
  }

  return traceSameFileOrmEvidence(nodeId, index, evidence)
}

function traceThisFieldStaticMemberAlias(
  parentClassId: string,
  fieldName: string,
  index: SemanticIndex,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  const parent = index.nodesById.get(parentClassId)
  if (!parent?.name) return null

  const property = [...index.nodesById.values()].find((node) =>
    node.name === `${parent.name}.${fieldName}` &&
    index.containsParentByChild.get(node.id) === parentClassId
  )
  if (!property) return null

  for (const ref of index.typeRefsBySource.get(property.id) ?? []) {
    if (!ref.targetSymbol) continue
    const orm = detectStaticMemberDbClientOrm(`${ref.targetSymbol}.${fieldName}`, index)
    if (!orm) continue
    evidence.push({ nodeId: property.id, reason: 'this_field_static_member_alias' })
    evidence.push({ edgeId: ref.id, reason: 'static_member_owner_ref' })
    return {
      kind: 'db_client',
      packageName: orm === 'kysely' ? 'kysely' : orm === 'prisma' ? '@prisma/client' : null,
      typeName: `${ref.targetSymbol}.${fieldName}`,
      orm,
      confidence: 'high',
      hops: 1,
      evidence,
    }
  }

  return null
}

function traceWrapperFunction(
  root: string,
  index: SemanticIndex,
  maxHops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  // crutch cleanup: no variable-NAME pre-gate — match by the wrapper's TYPE (kind === 'db_client') so ANY
  // receiver name resolves if its wrapper is a real db client (e.g. `const anyName = new PrismaClient()`).
  for (const [wrapperNodeId, wrapper] of index.wrapperFunctions) {
    const wrapperNode = index.nodesById.get(wrapperNodeId)
    if (wrapperNode?.name !== root || wrapper.kind !== 'db_client') continue
    const orm = detectOrmFromPackage(wrapper.targetPackage)
    if (orm !== 'unknown') {
      evidence.push({ nodeId: wrapperNodeId, reason: 'wrapper_function' })
      return {
        kind: 'db_client',
        packageName: wrapper.targetPackage ?? null,
        typeName: wrapperNode.name,
        orm,
        confidence: 'high',
        hops: 1,
        evidence,
      }
    }
    // 패키지로 orm을 못 정한 db_client wrapper (예: `const prismaClient: PrismaClient = new
    // PrismaClient()` — import edge가 파일 노드에 달려 targetPackage=null). wrapper 노드 자체의
    // typeRef/import/call 증거(`PrismaClient|@prisma/client`)로 더 깊이 추적한다. 못 찾으면
    // 'unknown'으로 단락하지 말고 계속 스캔 → import/same-file 증거로 fall through.
    const deepened = traceNodeDbEvidence(wrapperNodeId, index, maxHops - 1, evidence)
    if (deepened && deepened.orm !== 'unknown') {
      evidence.push({ nodeId: wrapperNodeId, reason: 'wrapper_function' })
      return { ...deepened, hops: Math.min(deepened.hops + 1, maxHops) }
    }
  }
  return null
}

function traceImportedReceiver(
  nodeId: string,
  root: string,
  index: SemanticIndex,
  maxHops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  const node = index.nodesById.get(nodeId)
  if (!node) return null
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    for (const imp of index.importsBySource.get(fileNode.id) ?? []) {
      if (imp.targetSymbol !== root) continue
      evidence.push({ edgeId: imp.id, reason: 'imported_receiver' })
      if (isDbClientPackage(imp.targetSpecifier)) {
        const orm = detectOrmFromPackage(imp.targetSpecifier)
        return identityFromEdge(imp, orm, 'db_package_import', 1, evidence)
      }
      if (imp.targetId) {
        const target = traceNodeDbEvidence(imp.targetId, index, maxHops - 1, evidence)
        if (target) return { ...target, hops: target.hops + 1 }
      }
    }
  }
  return null
}

function hasImportedReceiver(
  nodeId: string,
  root: string,
  index: SemanticIndex,
): boolean {
  const node = index.nodesById.get(nodeId)
  if (!node) return false
  return (index.nodesByFile.get(node.filePath) ?? []).some((fileNode) =>
    (index.importsBySource.get(fileNode.id) ?? []).some((imp) => imp.targetSymbol === root),
  )
}

/**
 * G6 def-use precision: follow the `resolves_to` edge (call site → the receiver's declaration node, matched by
 * targetSymbol === the receiver root token) that build_graph emits for a local/module-const receiver, then read
 * the DECLARATION node's direct db evidence via the shared traceNodeDirectDbEvidence reader — its `new
 * <DbClient>()` ctor `calls` edge (target_specifier='@prisma/client'), a db `type_ref`, or a db-package import.
 * The identity comes from the LIBRARY constructor on the resolved declaration (name-independent). Bounded: a
 * single resolves_to hop + the direct reader (no recursion). `resolves_to` is not bucketed in the SemanticIndex,
 * so read it generically off edgesBySource.
 */
function traceDefUseDeclaration(
  nodeId: string,
  root: string,
  index: SemanticIndex,
  maxHops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  for (const edge of index.edgesBySource.get(nodeId) ?? []) {
    if (edge.relation !== 'resolves_to' || edge.targetSymbol !== root || !edge.targetId) continue
    const identity = traceNodeDirectDbEvidence(edge.targetId, index, evidence)
    if (identity) {
      evidence.push({ edgeId: edge.id, reason: 'def_use_resolves_to' })
      return { ...identity, hops: Math.min(identity.hops + 1, maxHops) }
    }
  }
  return null
}

function traceSameFileOrmEvidence(
  nodeId: string,
  index: SemanticIndex,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  const node = index.nodesById.get(nodeId)
  if (!node) return null
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    const identity = traceNodeDirectDbEvidence(fileNode.id, index, evidence)
    if (identity) return identity
  }
  return null
}

function traceTypeByName(
  typeName: string,
  nodeId: string,
  index: SemanticIndex,
  maxHops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  if (maxHops <= 0) return null
  const node = index.nodesById.get(nodeId)
  const fileNodes = node ? (index.nodesByFile.get(node.filePath) ?? []) : index.nodesById.values()
  for (const candidate of fileNodes) {
    if (candidate.name !== typeName) continue
    const traced = traceNodeDbEvidence(candidate.id, index, maxHops - 1, evidence)
    if (traced) return { ...traced, hops: traced.hops + 1 }
  }
  for (const candidate of index.nodesById.values()) {
    if (candidate.name !== typeName) continue
    const traced = traceNodeDbEvidence(candidate.id, index, maxHops - 1, evidence)
    if (traced) return { ...traced, hops: traced.hops + 1 }
  }
  return null
}

function traceNodeDbEvidence(
  nodeId: string,
  index: SemanticIndex,
  maxHops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  if (maxHops < 0) return null
  const direct = traceNodeDirectDbEvidence(nodeId, index, evidence)
  if (direct) return direct

  for (const ext of index.extendsBySource.get(nodeId) ?? []) {
    const orm = detectOrmFromTypeName(ext.targetSymbol, ext.targetSpecifier)
    if (orm !== 'unknown') return identityFromEdge(ext, orm, 'extends_db_client', 1, evidence)
  }

  const node = index.nodesById.get(nodeId)
  if (node) {
    for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
      if (fileNode.id === nodeId) continue
      const fileDirect = traceNodeDirectDbEvidence(fileNode.id, index, evidence)
      if (fileDirect) return { ...fileDirect, hops: fileDirect.hops + 1 }
    }
  }

  return null
}

function traceNodeDirectDbEvidence(
  nodeId: string,
  index: SemanticIndex,
  evidence: TraceEvidence[],
): ReceiverIdentity | null {
  for (const imp of index.importsBySource.get(nodeId) ?? []) {
    if (isDbClientPackage(imp.targetSpecifier)) {
      const orm = detectOrmFromPackage(imp.targetSpecifier)
      return identityFromEdge(imp, orm, 'db_package_import', 1, evidence)
    }
  }

  for (const ref of index.typeRefsBySource.get(nodeId) ?? []) {
    const orm = detectOrmFromTypeName(ref.targetSymbol, ref.targetSpecifier)
    if (orm !== 'unknown') return identityFromEdge(ref, orm, 'db_type_ref', 1, evidence)
  }

  for (const call of index.callsBySource.get(nodeId) ?? []) {
    const orm = detectOrmFromTypeName(call.targetSymbol, call.targetSpecifier)
    if (orm !== 'unknown') return identityFromEdge(call, orm, 'db_constructor_call', 1, evidence)
  }

  return null
}

function identityFromEdge(
  edge: CodeEdgeLike,
  orm: string,
  reason: string,
  hops: number,
  evidence: TraceEvidence[],
): ReceiverIdentity {
  evidence.push({ edgeId: edge.id, reason })
  return {
    kind: 'db_client',
    packageName: edge.targetSpecifier ?? null,
    typeName: edge.targetSymbol ?? null,
    orm,
    confidence: orm === 'unknown' ? 'low' : 'high',
    hops,
    evidence,
  }
}

function looksLikeDbReceiver(root: string): boolean {
  return /(prisma|db|knex|kysely|sequelize|drizzle|client|dataSource|repo|repository)/i.test(root)
}
