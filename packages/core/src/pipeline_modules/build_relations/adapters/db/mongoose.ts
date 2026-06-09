import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { getReceiverRoot, traceReceiverIdentity } from '../../graph_trace/receiver_identity.js'
import { isMongoosePackage } from './packages.js'

// Exported so the G2 built-in DATA rule (builtin_db_rules.ts) is provably DERIVED from this imperative source.
export const MONGOOSE_METHODS = new Set([
  'find',
  'findOne',
  'findById',
  'count',
  'countDocuments',
  'estimatedDocumentCount',
  'aggregate',
  'create',
  'insertMany',
  'save',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findByIdAndDelete',
  'remove',
])

const DYNAMIC_CHAIN_RE = /\[/
const UNKNOWN_INJECTED_MODEL = Symbol('UNKNOWN_INJECTED_MODEL')

export const mongooseDbAdapter: RelationCandidateAdapter = {
  name: 'mongoose',
  relationKind: 'db_access',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    const chainPath = edge.chainPath ?? ''
    if (!method || !chainPath) return null
    if (!MONGOOSE_METHODS.has(method)) return null
    if (DYNAMIC_CHAIN_RE.test(chainPath)) return null
    if (isDynamicModelFactory(chainPath)) return null

    const identity = traceReceiverIdentity({
      nodeId: sourceNodeId,
      chainPath,
      index: context.index,
      maxHops: context.maxTraceHops,
    })
    if (identity && (identity.kind !== 'db_client' || identity.orm !== 'mongoose')) return null
    if (!identity && !hasMongooseEvidence(sourceNodeId, context.index)) return null

    const modelName = inferModelName(edge, sourceNodeId, context.index)
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
        orm: 'mongoose',
        method,
        adapter: 'mongoose',
        modelName,
        traceHops: identity?.hops ?? 0,
        receiverRoot: getReceiverRoot(chainPath),
      },
    }
  },
}

function inferModelName(edge: CodeEdgeLike, nodeId: string, index: SemanticIndex): string | null {
  const chainPath = edge.chainPath ?? ''
  const factoryModel = extractModelFactoryName(chainPath)
  if (factoryModel) return factoryModel

  const injected = findInjectedModel(nodeId, index)
  if (injected === UNKNOWN_INJECTED_MODEL) return null
  if (injected) return injected

  const generic = findGenericModel(nodeId, index)
  if (generic) return generic

  return inferModelFromReceiver(chainPath, index)
}

function extractModelFactoryName(chainPath: string): string | null {
  const match = chainPath.match(/\bmodel\(([^)]+)\)/)
  return cleanModelName(match?.[1])
}

function findInjectedModel(nodeId: string, index: SemanticIndex): string | typeof UNKNOWN_INJECTED_MODEL | null {
  for (const id of nodeAndParentIds(nodeId, index)) {
    const decorator = (index.decoratorsBySource.get(id) ?? []).find((d) => d.targetSymbol === 'InjectModel')
    if (decorator && !decorator.firstArg) return UNKNOWN_INJECTED_MODEL
    const modelName = cleanModelName(decorator?.firstArg)
    if (modelName) return modelName
  }
  return null
}

function findGenericModel(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndParentIds(nodeId, index)) {
    for (const ref of index.typeRefsBySource.get(id) ?? []) {
      const match = ref.targetSymbol?.match(/\bModel<\s*([A-Za-z_$][\w$]*)/)
      const modelName = cleanModelName(match?.[1])
      if (modelName) return modelName
    }
  }
  return null
}

function inferModelFromReceiver(chainPath: string, index: SemanticIndex): string | null {
  const root = getReceiverRoot(chainPath)
  if (!root) return null
  if (index.modelTablesByModelLower.has(root.toLowerCase())) return root
  const modelStem = root.match(/^([A-Za-z_$][\w$]*?)Model$/)?.[1]
  if (modelStem) return modelStem
  return null
}

function cleanModelName(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const propertyName = trimmed.match(/^([A-Za-z_$][\w$]*)\.name$/)?.[1]
  if (propertyName) return stripDocumentSuffix(propertyName)
  const identifier = trimmed.match(/^([A-Z][A-Za-z0-9_$]*)$/)?.[1]
  if (identifier) return stripDocumentSuffix(identifier)
  const quoted = trimmed.match(/^['"`]([A-Za-z_][\w]*)['"`]$/)?.[1]
  return quoted ? stripDocumentSuffix(quoted) : null
}

function stripDocumentSuffix(value: string): string {
  return value.replace(/Document$/, '')
}

function isDynamicModelFactory(chainPath: string): boolean {
  const match = chainPath.match(/\bmodel\(([^)]+)\)/)
  if (!match) return false
  return cleanModelName(match[1]) == null
}

function hasMongooseEvidence(nodeId: string, index: SemanticIndex): boolean {
  for (const id of nodeAndParentIds(nodeId, index)) {
    if ((index.importsBySource.get(id) ?? []).some((edge) => isMongoosePackage(edge.targetSpecifier))) return true
    if ((index.typeRefsBySource.get(id) ?? []).some((edge) =>
      isMongoosePackage(edge.targetSpecifier) || /\bModel</.test(edge.targetSymbol ?? '')
    )) return true
  }

  const node = index.nodesById.get(nodeId)
  if (!node) return false
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if ((index.importsBySource.get(fileNode.id) ?? []).some((edge) => isMongoosePackage(edge.targetSpecifier))) return true
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
