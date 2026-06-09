import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import { isFirebaseFirestorePackage } from './realtime_packages.js'
import type { RealtimeBroker, RealtimeEventFamily } from './realtime_types.js'
import { readStringArg } from './realtime_utils.js'

export const firebaseFirestoreRealtimeFamily: RealtimeEventFamily = {
  broker: 'firebase_firestore',
  detectBroker: detectFirebaseFirestoreBroker,
  extractCandidate: firebaseFirestoreRealtimeCandidate,
}

function detectFirebaseFirestoreBroker(nodeId: string, index: SemanticIndex): RealtimeBroker | null {
  const calls = index.callsBySource.get(nodeId) ?? []
  const hasSnapshot = calls.some((call) => call.targetSymbol === 'onSnapshot' && isFirebaseFirestorePackage(call.targetSpecifier))
  if (!hasSnapshot) return null
  return calls.some((call) => call.targetSymbol === 'collection' && isFirebaseFirestorePackage(call.targetSpecifier))
    ? 'firebase_firestore'
    : null
}

function firebaseFirestoreRealtimeCandidate(
  sourceNodeId: string,
  call: CodeEdgeLike,
  index: SemanticIndex,
): RelationCandidate | null {
  if (call.targetSymbol !== 'onSnapshot') return null
  const target = extractFirebaseSnapshotTarget(sourceNodeId, index)
  if (!target) return null
  return {
    kind: 'event',
    sourceNodeId,
    evidenceNodeIds: [`edge:${call.id}`, ...target.evidenceNodeIds],
    targetSymbol: call.targetSymbol,
    chainPath: call.chainPath,
    firstArg: target.collectionPath,
    payload: {
      broker: 'firebase_firestore',
      direction: 'listen',
      adapter: 'firebase_firestore',
      collection: target.collectionPath,
    },
  }
}

function extractFirebaseSnapshotTarget(
  nodeId: string,
  index: SemanticIndex,
): { collectionPath: string; evidenceNodeIds: string[] } | null {
  const collections = (index.callsBySource.get(nodeId) ?? [])
    .filter((call) => call.targetSymbol === 'collection' && isFirebaseFirestorePackage(call.targetSpecifier))
    .map((call) => ({ call, collectionPath: readStringArg(call, 1) }))
    .filter((item): item is { call: CodeEdgeLike; collectionPath: string } =>
      item.collectionPath != null && isStaticFirestoreCollectionPath(item.collectionPath),
    )

  const unique = [...new Map(collections.map((item) => [item.collectionPath, item])).values()]
  if (unique.length !== 1) return null

  const [target] = unique
  return {
    collectionPath: target.collectionPath,
    evidenceNodeIds: [`edge:${target.call.id}`],
  }
}

function isStaticFirestoreCollectionPath(value: string): boolean {
  return /^[A-Za-z_][\w-]*(?:\/[A-Za-z_][\w-]*)*$/.test(value)
}
