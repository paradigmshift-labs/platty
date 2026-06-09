import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'

const TYPEORM_METHODS = new Set([
  'find',
  'findOne',
  'findOneBy',
  'findAndCount',
  'count',
  'save',
  'insert',
  'update',
  'upsert',
  'delete',
  'remove',
  'softDelete',
  'restore',
  'query',
])

const QUERY_BUILDER_TERMINALS = new Set(['from', 'into', 'update', 'delete'])
const DYNAMIC_CHAIN_RE = /\[/
const TX_ALIAS_RE = /^(tx|trx|em|t|transaction)$/

export const typeormDbAdapter: RelationCandidateAdapter = {
  name: 'typeorm',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    if (!TYPEORM_METHODS.has(method) && !QUERY_BUILDER_TERMINALS.has(method)) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null
    if (isDynamicRepositoryFactory(chainPath)) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'typeorm')) return null

    const root = getReceiverRoot(chainPath)
    if (!identity && !hasTypeOrmEvidence(sourceNodeId, context.index)) return null
    if (root && TX_ALIAS_RE.test(root) && !hasTransactionCallEvidence(sourceNodeId, context.index)) return null

    const queryBuilder = isQueryBuilderCall(method, chainPath)
    const effectiveMethod = queryBuilder ? inferQueryBuilderMethod(method, chainPath) : method
    const modelName = inferModelName(edge, sourceNodeId, context.index, queryBuilder)
    if (!modelName) return null

    return {
      kind: 'db_access',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`, ...(identity?.evidence.map(formatEvidence) ?? [])],
      receiver: chainPath,
      targetSymbol: method,
      chainPath,
      firstArg: edge.firstArg,
      payload: {
        orm: 'typeorm',
        method: effectiveMethod,
        adapter: 'typeorm',
        modelName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: root,
        ...(queryBuilder && { queryBuilder: true }),
      },
    }
  },
}

function inferModelName(
  edge: CodeEdgeLike,
  sourceNodeId: string,
  index: SemanticIndex,
  queryBuilder: boolean,
): string | null {
  const chainPath = edge.chainPath ?? ''

  const factoryModel = extractFactoryModel(chainPath)
  if (factoryModel) return factoryModel

  if (queryBuilder) {
    return cleanStaticModelName(edge.firstArg)
  }

  const root = getReceiverRoot(chainPath)
  if (root && /^(manager|entityManager|em|tx|trx|t|transaction)$/.test(root)) {
    return cleanStaticModelName(edge.firstArg)
  }

  const injected = findInjectedRepositoryModel(sourceNodeId, index)
  if (injected) return injected

  const generic = findRepositoryGenericModel(sourceNodeId, index)
  if (generic) return generic

  return inferRepositoryModelFromReceiver(chainPath, index)
}

function extractFactoryModel(chainPath: string): string | null {
  const match = chainPath.match(/\bget(?:Tree|Mongo)?Repository\(([^)]+)\)/)
  return cleanStaticModelName(match?.[1])
}

function findInjectedRepositoryModel(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndParentIds(nodeId, index)) {
    const decorators = index.decoratorsBySource.get(id) ?? []
    const decorator = decorators.find((d) => d.targetSymbol === 'InjectRepository')
    const modelName = cleanStaticModelName(decorator?.firstArg)
    if (modelName) return modelName
  }
  return null
}

function findRepositoryGenericModel(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndParentIds(nodeId, index)) {
    for (const ref of index.typeRefsBySource.get(id) ?? []) {
      const match = ref.targetSymbol?.match(/\bRepository<\s*([A-Za-z_$][\w$]*)\s*>/)
      const modelName = cleanStaticModelName(match?.[1])
      if (modelName) return modelName
    }
  }
  return null
}

function inferRepositoryModelFromReceiver(chainPath: string, index: SemanticIndex): string | null {
  const field = chainPath.match(/(?:^|\.)([A-Za-z_$][\w$]*(?:Repository|Repo))$/)?.[1]
  if (!field) return null
  if (index.modelTablesByModelLower.has(field.toLowerCase())) return field
  const stem = field.replace(/(?:Repository|Repo)$/, '')
  if (!stem) return null
  const tableName = findKnownTableName(stem, index)
  if (tableName) return tableName
  const modelName = findKnownModelName(stem, index)
  if (modelName) return modelName
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

function findKnownTableName(stem: string, index: SemanticIndex): string | null {
  const normalized = stem.toLowerCase()
  for (const tableName of index.modelTablesByModelLower.values()) {
    if (tableName.toLowerCase() === normalized) return tableName
  }
  return null
}

function findKnownModelName(stem: string, index: SemanticIndex): string | null {
  const candidates = modelNameCandidates(stem).map((candidate) => candidate.toLowerCase())
  for (const candidate of candidates) {
    if (index.modelTablesByModelLower.has(candidate)) return candidate
  }
  return null
}

function modelNameCandidates(stem: string): string[] {
  const pascal = stem.charAt(0).toUpperCase() + stem.slice(1)
  const singular = singularizeIdentifier(stem)
  const singularPascal = singular.charAt(0).toUpperCase() + singular.slice(1)
  return [pascal, `${pascal}Entity`, singularPascal, `${singularPascal}Entity`]
}

function singularizeIdentifier(value: string): string {
  if (/ies$/i.test(value)) return value.slice(0, -3) + 'y'
  if (/ses$/i.test(value)) return value.slice(0, -2)
  if (/s$/i.test(value) && !/ss$/i.test(value)) return value.slice(0, -1)
  return value
}

function cleanStaticModelName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const propertyName = trimmed.match(/^([A-Za-z_$][\w$]*)\.name$/)?.[1]
  if (propertyName) return propertyName
  const identifier = trimmed.match(/^([A-Z][A-Za-z0-9_$]*)$/)?.[1]
  if (identifier) return identifier
  const quoted = trimmed.match(/^['"`]([A-Za-z_][\w]*)['"`]$/)?.[1]
  return quoted ?? null
}

function isDynamicRepositoryFactory(chainPath: string): boolean {
  const match = chainPath.match(/\bget(?:Tree|Mongo)?Repository\(([^)]+)\)/)
  if (!match) return false
  return cleanStaticModelName(match[1]) == null
}

function isQueryBuilderCall(method: string, chainPath: string): boolean {
  return QUERY_BUILDER_TERMINALS.has(method) && /createQueryBuilder\(/.test(chainPath)
}

function inferQueryBuilderMethod(method: string, chainPath: string): string {
  if (/\.delete\(\)/.test(chainPath) || method === 'delete') return 'delete'
  if (/\.update\(\)/.test(chainPath) || method === 'update') return 'update'
  if (/\.insert\(\)/.test(chainPath) || method === 'into') return 'insert'
  return 'find'
}

function hasTypeOrmEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => edge.targetSpecifier?.includes('typeorm'))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      edge.targetSpecifier?.includes('typeorm') || /DataSource|EntityManager|Repository</.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => edge.targetSpecifier?.includes('typeorm'))) return true
  }
  return false
}

function hasTransactionCallEvidence(nodeId: string, index: SemanticIndex): boolean {
  return (index.callsBySource.get(nodeId) ?? []).some((call) => call.targetSymbol === 'transaction')
}

function nodeAndParentIds(nodeId: string, index: SemanticIndex): string[] {
  const ids = [nodeId]
  const parentId = index.containsParentByChild.get(nodeId)
  if (parentId) ids.push(parentId)
  return ids
}

function formatEvidence(evidence: { nodeId?: string; edgeId?: number; reason: string }): string {
  if (evidence.edgeId != null) return `edge:${evidence.edgeId}:${evidence.reason}`
  if (evidence.nodeId) return `node:${evidence.nodeId}:${evidence.reason}`
  return evidence.reason
}
