import type { RelationCandidate } from '../../../types.js'
import { isFirebaseMessagingPackage } from '../packages.js'
import type { ExternalServiceExtractionFamily } from './extraction_types.js'
import { readFileNodeSource } from './extraction_utils.js'

const FIREBASE_MESSAGING_STREAMS = new Set([
  'onMessage',
  'onMessageOpenedApp',
  'onBackgroundMessage',
])

export const PLATFORM_SERVICE_EXTRACTION: ExternalServiceExtractionFamily = {
  services: ['firebase'],
  extractCandidates(inputs, index, helpers) {
    if (!inputs.repoPath) return []

    const candidates: RelationCandidate[] = []
    for (const fileNode of inputs.nodes.filter((node) => node.type === 'file' && node.filePath.endsWith('.dart'))) {
      const importsFirebaseMessaging = (index.importsBySource.get(fileNode.id) ?? [])
        .some((imp) => isFirebaseMessagingPackage(imp.targetSpecifier))
      if (!importsFirebaseMessaging) continue

      const source = readFileNodeSource(inputs, fileNode.filePath)
      if (!source) continue

      for (const match of source.matchAll(/\bFirebaseMessaging\s*\.\s*(onMessage|onMessageOpenedApp|onBackgroundMessage)\s*(?:\.|\()/g)) {
        const targetSymbol = match[1]
        if (!targetSymbol || !FIREBASE_MESSAGING_STREAMS.has(targetSymbol)) continue

        const sourceNodeId = helpers.sourceNodeIdForOffset(fileNode.id, fileNode.filePath, match.index ?? 0, source)
        candidates.push({
          kind: 'external_service',
          sourceNodeId,
          evidenceNodeIds: [sourceNodeId],
          receiver: 'FirebaseMessaging',
          targetSymbol,
          chainPath: `FirebaseMessaging.${targetSymbol}`,
          firstArg: null,
          payload: { service: 'firebase', adapter: 'firebase_messaging_stream' },
        })
      }
    }

    return candidates
  },
}
