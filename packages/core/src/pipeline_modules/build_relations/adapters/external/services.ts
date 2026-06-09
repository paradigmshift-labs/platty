import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationCandidateExtractorAdapter } from '../types.js'
import { getReceiverRoot } from '../../graph_trace/receiver_identity.js'
import { createSourceFallback } from '../../source_fallback.js'
import { isExternalServiceMethod, serviceForPackage, type ExternalService } from './definitions.js'
import { EXTERNAL_SERVICE_FAMILY_EXTRACTIONS } from './families/extraction_index.js'
import type { ExternalServiceExtractionContext } from './families/extraction_types.js'

export const externalServiceAdapter: RelationCandidateExtractorAdapter = {
  name: 'external_service',
  relationKinds: ['external_service'],
  extractCandidates(inputs, index) {
    const candidates: RelationCandidate[] = []

    for (const node of inputs.nodes) {
      const calls = index.callsBySource.get(node.id) ?? []
      for (const call of calls) {
        for (const service of detectExternalServicesForCall(node.id, call, index, inputs)) {
          if (!isExternalServiceMethod(service, call.targetSymbol)) continue
          for (const targetArg of externalServiceTargetArgs(service, call, calls, inputs, node.id, index)) {
            candidates.push({
              kind: 'external_service',
              sourceNodeId: node.id,
              evidenceNodeIds: [`edge:${call.id}`],
              receiver: call.chainPath,
              targetSymbol: call.targetSymbol,
              chainPath: call.chainPath,
              firstArg: targetArg,
              payload: { service, adapter: 'external_service' },
            })
          }
        }
      }
    }

    for (const family of EXTERNAL_SERVICE_FAMILY_EXTRACTIONS) {
      candidates.push(...(family.extractCandidates?.(inputs, index, {
        sourceNodeIdForOffset: (fileNodeId, filePath, offset, source) =>
          sourceNodeIdForOffset(fileNodeId, filePath, offset, source, index),
      }) ?? []))
    }

    return candidates
  },
}

function sourceNodeIdForOffset(
  fallbackFileNodeId: string,
  filePath: string,
  offset: number,
  source: string,
  index: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[1],
): string {
  const line = source.slice(0, offset).split(/\r?\n/).length
  const nodes = index.nodesByFile.get(filePath) ?? []
  const owner = nodes
    .filter((node) => node.type !== 'file' && node.lineStart != null && node.lineEnd != null)
    .filter((node) => Number(node.lineStart) <= line && line <= Number(node.lineEnd))
    .sort((a, b) => (Number(a.lineEnd) - Number(a.lineStart)) - (Number(b.lineEnd) - Number(b.lineStart)))[0]
  return owner?.id ?? fallbackFileNodeId
}

function detectFileImportExternalServicesForCall(
  nodeId: string,
  call: CodeEdgeLike,
  index: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[1],
): ExternalService[] {
  const node = index.nodesById.get(nodeId)
  const fileNodes = node ? (index.nodesByFile.get(node.filePath) ?? []) : []
  const services: ExternalService[] = []
  const receiverRoot = getReceiverRoot(call.chainPath ?? '')
  const isReceiverCall = Boolean(receiverRoot && receiverRoot !== call.targetSymbol)

  for (const fileNode of fileNodes) {
    for (const imp of index.importsBySource.get(fileNode.id) ?? []) {
      const pkg = imp.targetSpecifier
      if (!pkg) continue
      const service = serviceForPackage(pkg)
      if (!service) continue
      const isDirectImportedCall = Boolean(
        call.targetSymbol
          && imp.targetSymbol === call.targetSymbol
          && (!receiverRoot || receiverRoot === call.targetSymbol),
      )
      const isImportedReceiverCall = Boolean(
        receiverRoot
          && imp.targetSymbol
          && normalizeIdentifier(receiverRoot) === normalizeIdentifier(imp.targetSymbol),
      )
      if (!isDirectImportedCall && !isImportedReceiverCall && !isReceiverCall) continue
      if (!services.includes(service)) services.push(service)
    }
  }

  return services
}

function externalServiceTargetArgs(
  service: ExternalService,
  call: CodeEdgeLike,
  callsInNode: CodeEdgeLike[],
  inputs: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[0],
  sourceNodeId: string,
  index: SemanticIndex,
): Array<string | null> {
  const context = makeExtractionContext(inputs, index, sourceNodeId, call, callsInNode)
  for (const family of EXTERNAL_SERVICE_FAMILY_EXTRACTIONS) {
    if (family.services && !family.services.includes(service)) continue
    const targetArgs = family.targetArgs?.(service, context)
    if (targetArgs) return targetArgs
  }

  return [call.firstArg]
}

function resolveExternalServiceStaticArg(
  value: string,
  inputs: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[0],
  sourceNodeId: string,
  index: SemanticIndex,
): string | null {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(value)) return value
  if (!inputs.repoPath) return value

  const node = index.nodesById.get(sourceNodeId)
  if (!node?.filePath) return value

  return createSourceFallback(inputs.repoPath).resolveConstant({
    identifier: value,
    nodeId: sourceNodeId,
    filePath: node.filePath,
    allowedScopes: ['event'],
  }) ?? value
}

function detectExternalServicesForCall(
  nodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
  inputs: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[0],
): ExternalService[] {
  const services = detectFileImportExternalServicesForCall(nodeId, call, index)

  for (const importedService of detectImportedReceiverExternalServices(nodeId, call, index)) {
    if (!services.includes(importedService)) services.push(importedService)
  }
  const callsInNode = index.callsBySource.get(nodeId) ?? []
  const context = makeExtractionContext(inputs, index, nodeId, call, callsInNode)
  for (const family of EXTERNAL_SERVICE_FAMILY_EXTRACTIONS) {
    for (const detectedService of family.detectServicesForCall?.(context) ?? []) {
      const service = detectedService as ExternalService
      if (!services.includes(service)) services.push(service)
    }
  }

  return services
}

function normalizeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_$]/g, '').toLowerCase()
}

function makeExtractionContext(
  inputs: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[0],
  index: SemanticIndex,
  sourceNodeId: string,
  call: CodeEdgeLike,
  callsInNode: CodeEdgeLike[],
): ExternalServiceExtractionContext {
  return {
    inputs,
    index,
    sourceNodeId,
    call,
    callsInNode,
    resolveStaticArg: (value) => resolveExternalServiceStaticArg(value, inputs, sourceNodeId, index),
    sourceNodeIdForOffset: (fileNodeId, filePath, offset, source) =>
      sourceNodeIdForOffset(fileNodeId, filePath, offset, source, index),
    detectImportedReceiverServicesByRoot: (root) => detectImportedReceiverExternalServicesByRoot(sourceNodeId, root, index),
  }
}

function detectImportedReceiverExternalServices(
  nodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
): ExternalService[] {
  const root = getReceiverRoot(call.chainPath ?? '')
  return detectImportedReceiverExternalServicesByRoot(nodeId, root, index)
}

function detectImportedReceiverExternalServicesByRoot(
  nodeId: string,
  root: string | null,
  index: SemanticIndex,
): ExternalService[] {
  const node = index.nodesById.get(nodeId)
  if (!root || !node) return []

  const services: ExternalService[] = []
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    for (const imp of index.importsBySource.get(fileNode.id) ?? []) {
      if (imp.targetSymbol !== root) continue
      const directService = serviceForPackage(imp.targetSpecifier)
      if (directService && !services.includes(directService)) services.push(directService)
      if (!imp.targetId) continue
      const targetService = detectExternalServiceForNode(imp.targetId, index)
      if (targetService && !services.includes(targetService)) services.push(targetService)
    }
  }
  return services
}

function detectExternalServiceForNode(
  nodeId: string,
  index: SemanticIndex,
): ExternalService | null {
  const node = index.nodesById.get(nodeId)
  if (!node) return null
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    for (const imp of index.importsBySource.get(fileNode.id) ?? []) {
      const service = serviceForPackage(imp.targetSpecifier)
      if (service) return service
    }
  }
  return null
}
