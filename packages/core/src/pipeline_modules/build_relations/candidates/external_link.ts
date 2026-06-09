// External link candidate extractor (url_launcher, etc.)
// SOT: specs/build_relations/architecture.md §5.4

import type { BuildRelationsInputs, SemanticIndex, RelationCandidate } from '../types.js'
import { isUrlLauncherPackage } from '../adapters/external/packages.js'

// URL launcher 메서드
const LAUNCH_METHODS = new Set(['launchUrl', 'launch', 'openUrl', 'canLaunchUrl', 'canLaunch'])

export function extractExternalLinkCandidates(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  const candidates: RelationCandidate[] = []

  for (const node of inputs.nodes) {
    // url_launcher anchor 확인
    const hasLaunchAnchor = hasLaunchPackageAnchor(node.id, index)
    if (!hasLaunchAnchor) continue

    for (const callEdge of (index.callsBySource.get(node.id) ?? [])) {
      const method = callEdge.targetSymbol
      if (!method || !LAUNCH_METHODS.has(method)) continue

      const url = callEdge.firstArg
      if (!url) continue

      const scheme = extractScheme(url)

      candidates.push({
        kind: 'external_link',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${callEdge.id}`],
        firstArg: url,
        rawTarget: url,
        payload: { scheme, method },
      })
    }
  }

  return candidates
}

function hasLaunchPackageAnchor(nodeId: string, index: SemanticIndex): boolean {
  for (const imp of (index.importsBySource.get(nodeId) ?? [])) {
    if (isUrlLauncherPackage(imp.targetSpecifier)) return true
  }

  const node = index.nodesById.get(nodeId)
  if (node) {
    for (const fileNode of (index.nodesByFile.get(node.filePath) ?? [])) {
      for (const imp of (index.importsBySource.get(fileNode.id) ?? [])) {
        if (isUrlLauncherPackage(imp.targetSpecifier)) return true
      }
    }
  }

  return false
}

function extractScheme(url: string): string {
  const match = url.match(/^([a-z][a-z0-9+.-]*):/)
  return match?.[1] ?? 'unknown'
}
