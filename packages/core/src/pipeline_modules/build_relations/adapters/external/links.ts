import type { RelationCandidate } from '../../types.js'
import type { RelationCandidateExtractorAdapter } from '../types.js'
import { resolveFirstArgsFromSource } from '../../source_call_args.js'
import { isUrlLauncherPackage } from './packages.js'
const LAUNCH_METHODS = new Set(['launchUrl', 'launch', 'openUrl', 'canLaunchUrl', 'canLaunch'])

const EXTERNAL_LINK_COMPONENTS = new Set(['a', 'area', 'Link', 'NavLink'])
const BROWSER_OPEN_METHODS = new Set(['open', 'assign', 'replace'])

export const urlLauncherExternalLinkAdapter: RelationCandidateExtractorAdapter = {
  name: 'url_launcher',
  relationKinds: ['external_link'],
  extractCandidates(inputs, index) {
    const candidates: RelationCandidate[] = []

    for (const node of inputs.nodes) {
      if (!hasLaunchPackageAnchor(node.id, index)) continue

      for (const callEdge of (index.callsBySource.get(node.id) ?? [])) {
        const method = callEdge.targetSymbol
        if (!method || !LAUNCH_METHODS.has(method)) continue

        for (const url of resolveFirstArgsFromSource(inputs, node, callEdge)) {
          candidates.push({
            kind: 'external_link',
            sourceNodeId: node.id,
            evidenceNodeIds: [`edge:${callEdge.id}`],
            firstArg: url,
            rawTarget: url,
            payload: { scheme: extractScheme(url), method, adapter: 'url_launcher' },
          })
        }
      }
    }

    for (const node of inputs.nodes) {
      for (const renderEdge of (index.rendersBySource.get(node.id) ?? [])) {
        const component = renderEdge.targetSymbol
        if (!component || !EXTERNAL_LINK_COMPONENTS.has(component)) continue

        const url = renderEdge.firstArg
        if (!url) continue
        const staticishUrl = isExternalUrl(url) || isStaticIdentifier(url)
        if (!staticishUrl) continue

        candidates.push({
          kind: 'external_link',
          sourceNodeId: node.id,
          evidenceNodeIds: [`edge:${renderEdge.id}`],
          firstArg: url,
          rawTarget: url,
          payload: {
            scheme: extractScheme(url),
            method: 'link',
            adapter: component === 'a' || component === 'area' ? 'html_external_link' : 'react_external_link',
            component,
          },
        })
      }
    }

    for (const node of inputs.nodes) {
      for (const callEdge of (index.callsBySource.get(node.id) ?? [])) {
        if (!callEdge.targetSymbol || !BROWSER_OPEN_METHODS.has(callEdge.targetSymbol)) continue

        for (const url of resolveFirstArgsFromSource(inputs, node, callEdge)) {
          const staticishUrl = isExternalUrl(url) || isStaticIdentifier(url)
          if (!staticishUrl) continue

          const chainPath = callEdge.chainPath ?? ''
          const isWindowOpen = chainPath === 'window' && callEdge.targetSymbol === 'open'
          const isLocationCall = ['window.location', 'location'].includes(chainPath)
          if (!isWindowOpen && !isLocationCall) continue

          candidates.push({
            kind: 'external_link',
            sourceNodeId: node.id,
            evidenceNodeIds: [`edge:${callEdge.id}`],
            firstArg: url,
            rawTarget: url,
            payload: {
              scheme: extractScheme(url),
              method: callEdge.targetSymbol,
              adapter: 'browser_external_link',
              receiver: chainPath,
            },
          })
        }
      }
    }

    return candidates
  },
}

function hasLaunchPackageAnchor(nodeId: string, index: Parameters<RelationCandidateExtractorAdapter['extractCandidates']>[1]): boolean {
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

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//.test(url) || isExternalScheme(url)
}

function isExternalScheme(url: string): boolean {
  const scheme = extractScheme(url)
  if (scheme === 'unknown') return false
  if (/^(mailto|tel|sms|intent|market|zxing)$/.test(scheme)) return true
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !['javascript', 'data', 'file'].includes(scheme)
}

function isStaticIdentifier(url: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(url)
}
