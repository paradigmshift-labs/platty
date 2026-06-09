import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuildRelationsInputs, CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationCandidateExtractorAdapter } from '../types.js'
import { flutterRouterForPackage, routerSupportsMethod } from './packages.js'

const ROUTE_DEFINITIONS = new Map<string, { router: string; targetKeys: string[] }>([
  ['GoRoute', { router: 'flutter_gorouter', targetKeys: ['path'] }],
  ['ShellRoute', { router: 'flutter_gorouter', targetKeys: ['path'] }],
  ['StatefulShellRoute', { router: 'flutter_gorouter', targetKeys: ['path'] }],
  ['GetPage', { router: 'flutter_getx', targetKeys: ['name', 'path'] }],
  ['AutoRoute', { router: 'flutter_auto_route', targetKeys: ['path'] }],
  ['CustomRoute', { router: 'flutter_auto_route', targetKeys: ['path'] }],
  ['BeamPage', { router: 'flutter_beamer', targetKeys: ['key', 'path'] }],
])

const INTERNAL_PATH_RE = /^\/[^/]/
const EXTERNAL_URL_RE = /^https?:\/\//

export const flutterRouteNavigationAdapter: RelationCandidateExtractorAdapter = {
  name: 'flutter_routes',
  relationKinds: ['navigation'],
  extractCandidates(inputs: BuildRelationsInputs, index: SemanticIndex): RelationCandidate[] {
    return [
      ...extractPersistedRouteDefinitions(inputs, index),
      ...extractRouteDefinitions(inputs, index),
      ...extractGoRouterRedirects(inputs, index),
      ...extractWrapperCalls(inputs, index),
    ]
  },
}

function extractPersistedRouteDefinitions(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  if (!isDartRepo(inputs)) return []

  const candidates: RelationCandidate[] = []
  for (const entry of inputs.entryPoints ?? []) {
    if (entry.kind !== 'page' || !entry.routePath || !INTERNAL_PATH_RE.test(entry.routePath)) continue

    const sourceNodeId = resolveEntrySourceNodeId(entry.nodeId, index)
    if (!sourceNodeId) continue

    candidates.push({
      kind: 'navigation',
      sourceNodeId,
      evidenceNodeIds: [`entry:${entry.id}`],
      firstArg: entry.routePath,
      rawTarget: entry.routePath,
      payload: {
        method: 'route_definition',
        router: 'flutter',
        adapter: 'flutter_persisted_route_definition',
        target_path: entry.routePath,
      },
    })
  }

  return candidates
}

function extractRouteDefinitions(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  const candidates: RelationCandidate[] = []

  for (const node of inputs.nodes) {
    const importedRouter = detectImportedFlutterRouter(node.id, index)

    for (const call of index.callsBySource.get(node.id) ?? []) {
      if (!call.targetSymbol) continue

      const definition = ROUTE_DEFINITIONS.get(call.targetSymbol)
      if (!definition) continue
      if (importedRouter && importedRouter !== definition.router) continue

      const rawTarget = extractRouteTarget(call, definition.targetKeys)
      if (!rawTarget || EXTERNAL_URL_RE.test(rawTarget)) continue

      candidates.push({
        kind: 'navigation',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${call.id}`],
        firstArg: rawTarget,
        rawTarget,
        payload: {
          method: 'route_definition',
          router: definition.router,
          adapter: 'flutter_route_definition',
          component: call.targetSymbol,
        },
      })
    }
  }

  return candidates
}

function extractGoRouterRedirects(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  if (!isDartRepo(inputs) || !inputs.repoPath) return []

  const candidates: RelationCandidate[] = []
  const routeEntries = inputs.entryPoints?.filter((entry) => entry.kind === 'page') ?? []
  for (const fileNode of inputs.nodes.filter((node) => node.type === 'file' && node.filePath.endsWith('.dart'))) {
    const sourcePath = join(inputs.repoPath, fileNode.filePath)
    if (!existsSync(sourcePath)) continue
    const source = readFileSync(sourcePath, 'utf-8')
    if (!source.includes('GoRoute') || !source.includes('redirect')) continue

    for (const redirect of extractGoRouteRedirectTargets(source)) {
      const entry = routeEntries.find((candidate) => normalizePathForCompare(candidate.routePath) === normalizePathForCompare(redirect.routePath))
      const sourceNodeId = entry?.nodeId ?? fileNode.id
      if (!sourceNodeId) continue

      candidates.push({
        kind: 'navigation',
        sourceNodeId,
        evidenceNodeIds: [fileNode.id, ...(entry ? [`entry:${entry.id}`] : [])],
        firstArg: redirect.target,
        rawTarget: redirect.target,
        payload: {
          method: 'redirect',
          router: 'flutter_gorouter',
          adapter: 'flutter_gorouter_redirect',
          route_path: redirect.routePath,
        },
      })
    }
  }

  return candidates
}

function extractGoRouteRedirectTargets(source: string): Array<{ routePath: string; target: string }> {
  const out: Array<{ routePath: string; target: string }> = []
  const goRouteRe = /\bGoRoute\s*\(/g
  let match: RegExpExecArray | null
  while ((match = goRouteRe.exec(source)) !== null) {
    const openParen = source.indexOf('(', match.index)
    const closeParen = findMatchingParen(source, openParen)
    if (closeParen < 0) continue
    const body = source.slice(openParen + 1, closeParen)
    const routePath = extractNamedStringArg(body, 'path')
    if (!routePath) continue
    const redirectExpr = extractNamedArgExpression(body, 'redirect')
    if (!redirectExpr) continue
    for (const target of extractInternalStringLiterals(redirectExpr)) {
      out.push({ routePath, target })
    }
  }
  return out
}

function extractNamedStringArg(source: string, name: string): string | null {
  return new RegExp(`\\b${name}\\s*:\\s*(['"])(.*?)\\1`).exec(source)?.[2] ?? null
}

function extractNamedArgExpression(source: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*:`).exec(source)
  if (!match) return null
  let index = match.index + match[0].length
  while (index < source.length && /\s/.test(source[index]!)) index += 1

  let depth = 0
  let quote: string | null = null
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const char = source[cursor]!
    const prev = source[cursor - 1]
    if (quote) {
      if (char === quote && prev !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    if (char === ')' || char === ']' || char === '}') depth -= 1
    if (char === ',' && depth <= 0) return source.slice(index, cursor)
  }
  return source.slice(index)
}

function extractInternalStringLiterals(source: string): string[] {
  const out = new Set<string>()
  for (const match of source.matchAll(/(['"])(\/[^'"]*)\1/g)) {
    out.add(match[2])
  }
  return [...out]
}

function findMatchingParen(source: string, openIndex: number): number {
  if (openIndex < 0) return -1
  let depth = 0
  let quote: string | null = null
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]!
    const prev = source[index - 1]
    if (quote) {
      if (char === quote && prev !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function normalizePathForCompare(path: string | null | undefined): string {
  if (!path) return ''
  return (path.replace(/\?.*$/, '').replace(/\/+$/, '') || '/').toLowerCase()
}

function extractWrapperCalls(
  inputs: BuildRelationsInputs,
  index: SemanticIndex,
): RelationCandidate[] {
  const candidates: RelationCandidate[] = []

  for (const node of inputs.nodes) {
    for (const call of index.callsBySource.get(node.id) ?? []) {
      if (!call.targetId || call.targetId === node.id) continue

      const wrapperNav = findDirectFlutterNavigation(call.targetId, index)
      if (!wrapperNav) continue

      candidates.push({
        kind: 'navigation',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${call.id}`, `edge:${wrapperNav.edge.id}`],
        chainPath: wrapperNav.edge.chainPath,
        firstArg: wrapperNav.edge.firstArg,
        rawTarget: wrapperNav.edge.firstArg,
        payload: {
          method: 'wrapper_call',
          router: wrapperNav.router,
          adapter: 'flutter_navigation_wrapper',
          wrapper: call.targetSymbol,
          wrapped_method: wrapperNav.edge.targetSymbol,
        },
      })
    }
  }

  return candidates
}

function findDirectFlutterNavigation(
  nodeId: string,
  index: SemanticIndex,
): { edge: CodeEdgeLike; router: string } | null {
  for (const call of index.callsBySource.get(nodeId) ?? []) {
    if (!call.targetSymbol || !call.firstArg || EXTERNAL_URL_RE.test(call.firstArg)) continue

    const router = detectFlutterRouter(nodeId, call, index)
    if (!router) continue

    if (!routerSupportsMethod(router, call.targetSymbol)) continue

    return { edge: call, router }
  }

  return null
}

function detectFlutterRouter(nodeId: string, edge: CodeEdgeLike, index: SemanticIndex): string | null {
  return detectImportedFlutterRouter(nodeId, index) ?? detectRouterFromReceiver(edge)
}

function detectImportedFlutterRouter(nodeId: string, index: SemanticIndex): string | null {
  for (const id of nodeAndFileNodeIds(nodeId, index)) {
    for (const imp of index.importsBySource.get(id) ?? []) {
      const router = flutterRouterForPackage(imp.targetSpecifier)
      if (router) return router
    }
  }
  return null
}

function detectRouterFromReceiver(edge: CodeEdgeLike): string | null {
  const chainPath = edge.chainPath ?? ''
  const method = edge.targetSymbol ?? ''
  if (chainPath === 'context' && ['go', 'push', 'replace', 'goNamed', 'pushNamed'].includes(method)) {
    return 'flutter_gorouter'
  }
  if (chainPath === 'Navigator' && ['pushNamed', 'popAndPushNamed', 'pushReplacementNamed'].includes(method)) {
    return 'flutter_navigator'
  }
  if (chainPath === 'Get') return 'flutter_getx'
  if (chainPath === 'context.router' || chainPath.startsWith('AutoRouter.')) return 'flutter_auto_route'
  if (chainPath.startsWith('Beamer.')) return 'flutter_beamer'
  return null
}

function extractRouteTarget(edge: CodeEdgeLike, targetKeys: string[]): string | null {
  if (edge.firstArg && INTERNAL_PATH_RE.test(edge.firstArg)) return edge.firstArg

  const args = parseLiteralArgs(edge.literalArgs)
  for (const arg of args) {
    if (typeof arg === 'string' && INTERNAL_PATH_RE.test(arg)) return arg
    if (!isRecord(arg)) continue

    for (const key of targetKeys) {
      const value = arg[key]
      if (typeof value === 'string' && INTERNAL_PATH_RE.test(value)) return value
    }
  }

  return null
}

function parseLiteralArgs(literalArgs: string | null | undefined): unknown[] {
  if (!literalArgs) return []
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function isDartRepo(inputs: BuildRelationsInputs): boolean {
  return inputs.nodes.some((node) => node.filePath.endsWith('.dart'))
}

function resolveEntrySourceNodeId(nodeId: string | null, index: SemanticIndex): string | null {
  if (!nodeId) return null
  if (index.nodesById.has(nodeId)) return nodeId
  return null
}
