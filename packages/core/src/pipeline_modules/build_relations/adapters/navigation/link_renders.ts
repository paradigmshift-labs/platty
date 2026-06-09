import type { BuildRelationsInputs, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationCandidateExtractorAdapter } from '../types.js'
import { routerForLinkRenderPackage } from './packages.js'

const NAV_COMPONENTS = new Map<string, string>([
  ['Link', 'link'],
  ['RouterLink', 'link'],
  ['NavLink', 'link'],
  ['Navigate', 'redirect'],
  ['Redirect', 'redirect'],
])

const EXTERNAL_URL_RE = /^https?:\/\//
const STATIC_TARGET_RE = /^(?:\/[^/]|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/

export const linkRenderNavigationAdapter: RelationCandidateExtractorAdapter = {
  name: 'link_render',
  relationKinds: ['navigation'],
  extractCandidates(inputs: BuildRelationsInputs, index: SemanticIndex): RelationCandidate[] {
    const candidates: RelationCandidate[] = []

    for (const node of inputs.nodes) {
      const router = detectRouter(node.id, index)
      if (!router) continue

      for (const renderEdge of index.rendersBySource.get(node.id) ?? []) {
        const component = renderEdge.targetSymbol
        if (!component) continue
        const method = navigationMethodForComponent(component)
        if (!method) continue

        const rawTarget = renderEdge.firstArg
        if (!rawTarget || EXTERNAL_URL_RE.test(rawTarget) || isExternalScheme(rawTarget)) continue
        if (!STATIC_TARGET_RE.test(rawTarget)) continue

        candidates.push({
          kind: 'navigation',
          sourceNodeId: node.id,
          evidenceNodeIds: [`edge:${renderEdge.id}`],
          firstArg: rawTarget,
          rawTarget,
          payload: {
            method,
            router,
            adapter: 'link_render',
          },
        })
      }
    }

    return candidates
  },
}

function navigationMethodForComponent(component: string): string | null {
  return NAV_COMPONENTS.get(component) ?? (/Link$/.test(component) ? 'link' : null)
}

function detectRouter(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      const router = routerForLinkRenderPackage(imp.targetSpecifier)
      if (router) return router
    }
  }
  return null
}

function nodeAndFileNodeIds(nodeId: string, index: SemanticIndex): string[] {
  const ids = [nodeId]
  const node = index.nodesById.get(nodeId)
  if (!node) return ids
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if (fileNode.id !== nodeId) ids.push(fileNode.id)
  }
  return ids
}

function isExternalScheme(url: string): boolean {
  return /^(tel|mailto|sms|intent|market|zxing):/.test(url)
}
