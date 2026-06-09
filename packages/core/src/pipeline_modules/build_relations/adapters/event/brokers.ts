import type { RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationCandidateExtractorAdapter } from '../types.js'
import { eventBrokerForPackage } from './families/brokers.js'
import { detectBrowserWebSocketBroker, extractEventBrokerFamilyCandidates } from './families/extraction.js'
import { extractFlutterRealtimeCandidates } from './families/flutter_realtime.js'
import { detectRealtimeBroker } from './families/realtime.js'

export const eventBrokerAdapter: RelationCandidateExtractorAdapter = {
  name: 'event_broker',
  relationKinds: ['event'],
  extractCandidates(inputs, index) {
    const candidates: RelationCandidate[] = []

    for (const node of inputs.nodes) {
      candidates.push(...extractFlutterRealtimeCandidates(node, inputs.repoPath))

      const broker = detectBroker(node.id, index)
        ?? detectRealtimeBroker(node.id, index)
        ?? detectBrowserWebSocketBroker(node.id, index)
      if (!broker) continue
      candidates.push(...extractEventBrokerFamilyCandidates({ inputs, index, node, broker }))
    }

    return candidates
  },
}

function detectBroker(nodeId: string, index: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[1]): string | null {
  const node = index.nodesById.get(nodeId)
  const fileNodes = node ? (index.nodesByFile.get(node.filePath) ?? []) : []

  for (const fileNode of fileNodes) {
    for (const imp of index.importsBySource.get(fileNode.id) ?? []) {
      const broker = eventBrokerForPackage(imp.targetSpecifier)
      if (broker) return broker
    }
  }

  return null
}
