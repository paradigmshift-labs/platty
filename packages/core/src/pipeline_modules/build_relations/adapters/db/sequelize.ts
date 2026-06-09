import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { isSequelizePackage } from './packages.js'

const SEQUELIZE_METHODS: Record<string, string> = {
  findAll: 'findAll',
  findOne: 'findOne',
  findByPk: 'findByPk',
  count: 'count',
  create: 'create',
  bulkCreate: 'bulkCreate',
  update: 'update',
  upsert: 'upsert',
  destroy: 'destroy',
}

const DYNAMIC_CHAIN_RE = /\[/

export const sequelizeDbAdapter: RelationCandidateAdapter = {
  name: 'sequelize',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    const effectiveMethod = SEQUELIZE_METHODS[method]
    if (!effectiveMethod) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'sequelize')) return null
    if (!identity && !hasSequelizeEvidence(sourceNodeId, context.index)) return null

    const modelName = inferModelName(chainPath, sourceNodeId, context.index)
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
        orm: 'sequelize',
        method: effectiveMethod,
        adapter: 'sequelize',
        modelName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: getReceiverRoot(chainPath),
      },
    }
  },
}

function inferModelName(chainPath: string, nodeId: string, index: SemanticIndex): string | null {
  const injected = findInjectedModel(nodeId, index)
  if (injected) return injected

  const generic = findGenericModel(nodeId, index)
  if (generic) return generic

  const root = getReceiverRoot(chainPath)
  if (!root) return null
  return inferModelFromReceiverName(root, index)
}

function findInjectedModel(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndParentIds(nodeId, index)) {
    const decorator = (index.decoratorsBySource.get(id) ?? []).find((d) => d.targetSymbol === 'InjectModel')
    const modelName = cleanModelName(decorator?.firstArg)
    if (modelName) return modelName
  }
  return null
}

function findGenericModel(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndParentIds(nodeId, index)) {
    for (const ref of index.typeRefsBySource.get(id) ?? []) {
      const match = ref.targetSymbol?.match(/\b(?:ModelCtor|typeof)\s*<\s*([A-Za-z_$][\w$]*)\s*>/)
        ?? ref.targetSymbol?.match(/\btypeof\s+([A-Z][A-Za-z0-9_$]*)\b/)
        ?? ref.targetSymbol?.match(/\bModel<\s*([A-Za-z_$][\w$]*)/)
      const modelName = cleanModelName(match?.[1])
      if (modelName) return modelName
    }
  }
  return null
}

function cleanModelName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const propertyName = trimmed.match(/^([A-Za-z_$][\w$]*)\.name$/)?.[1]
  if (propertyName) return propertyName
  const identifier = trimmed.match(/^([A-Z][A-Za-z0-9_$]*)$/)?.[1]
  return identifier ?? null
}

function inferModelFromReceiverName(root: string, index: SemanticIndex): string | null {
  if (index.modelTablesByModelLower.has(root.toLowerCase())) return root
  const stem = root.replace(/Model$/, '')
  if (!stem) return null
  const modelName = findKnownModelName(stem, index)
  if (modelName) return modelName
  if (/^[a-z]/.test(stem)) return null
  return stem
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
  return [stem, pascal, singular, singularPascal]
}

function singularizeIdentifier(value: string): string {
  if (/ies$/i.test(value)) return value.slice(0, -3) + 'y'
  if (/ses$/i.test(value)) return value.slice(0, -2)
  if (/s$/i.test(value) && !/ss$/i.test(value)) return value.slice(0, -1)
  return value
}

function hasSequelizeEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isSequelizePackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      isSequelizePackage(edge.targetSpecifier) || /Sequelize|ModelCtor|Model</.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isSequelizePackage(edge.targetSpecifier))) return true
  }
  return false
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
