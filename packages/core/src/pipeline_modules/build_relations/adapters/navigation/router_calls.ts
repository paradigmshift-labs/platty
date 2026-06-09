import type { CallArgExpression, CodeEdgeLike, RelationCandidate } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { routerForNavigationPackage, routerSupportsMethod } from './packages.js'

const EXTERNAL_URL_RE = /^https?:\/\//

export const routerCallNavigationAdapter: RelationCandidateAdapter = {
  name: 'router_call',
  relationKind: 'navigation',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null

    const router = detectNavRouter(sourceNodeId, edge, context)
    if (!router) return null

    if (!routerSupportsMethod(router, method)) return null

    const rawTarget = resolveRouteTargetArg(edge)
    if (!rawTarget || EXTERNAL_URL_RE.test(rawTarget) || isExternalScheme(rawTarget)) return null

    const hasBottomNav = (context.index.rendersBySource.get(sourceNodeId) ?? [])
      .some((render) => render.targetSymbol === 'BottomNavigationBar')

    return {
      kind: 'navigation',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath: edge.chainPath,
      firstArg: rawTarget,
      rawTarget,
      payload: {
        method,
        router,
        adapter: 'router_call',
        surface: hasBottomNav ? 'bottom_nav' : null,
      },
    }
  },
}

export const routerCallExternalLinkAdapter: RelationCandidateAdapter = {
  name: 'router_call_external_link',
  relationKind: 'external_link',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null

    const router = detectNavRouter(sourceNodeId, edge, context)
    if (!router) return null

    if (!routerSupportsMethod(router, method)) return null

    const rawTarget = resolveRouteTargetArg(edge)
    if (!rawTarget || (!EXTERNAL_URL_RE.test(rawTarget) && !isExternalScheme(rawTarget))) return null

    return {
      kind: 'external_link',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath: edge.chainPath,
      firstArg: rawTarget,
      rawTarget,
      payload: {
        scheme: extractScheme(rawTarget),
        method,
        router,
        adapter: 'router_external_link',
      },
    }
  },
}

function resolveRouteTargetArg(edge: CodeEdgeLike): string | null {
  const expressionArg = firstRouteArgExpression(edge.argExpressions)
  if (expressionArg && shouldPreferExpressionArg(edge.firstArg, expressionArg)) return expressionArg
  return edge.firstArg ?? expressionArg
}

function shouldPreferExpressionArg(firstArg: string | null | undefined, expressionArg: string): boolean {
  if (!firstArg) return true
  if (expressionArg === firstArg) return false
  if (isMemberPath(expressionArg) && !isMemberPath(firstArg)) return true
  return false
}

function firstRouteArgExpression(argExpressions: unknown): string | null {
  if (!Array.isArray(argExpressions)) return null
  const expressions = argExpressions as CallArgExpression[]
  const first = expressions.find((arg) => arg.index === 0) ?? expressions[0]
  if (!first) return null

  if (first.kind === 'string' && first.value) return first.value
  if (first.kind === 'object') return routeTargetFromObjectArg(first)
  if ((first.kind === 'identifier' || first.kind === 'member') && first.raw) return first.raw.trim()
  if (first.resolved?.kind === 'string' && first.resolved.value) return first.resolved.value
  if (first.resolved?.kind === 'object') return routeTargetFromObjectArg(first.resolved)
  if ((first.resolved?.kind === 'identifier' || first.resolved?.kind === 'member') && first.resolved.raw) {
    return first.resolved.raw.trim()
  }
  return null
}

function routeTargetFromObjectArg(arg: CallArgExpression): string | null {
  const target = arg.properties?.to ?? arg.properties?.href ?? arg.properties?.path
  if (!target) return null
  if (target.kind === 'string' && target.value) return target.value
  if (target.resolved?.kind === 'string' && target.resolved.value) return target.resolved.value
  if ((target.kind === 'identifier' || target.kind === 'member') && target.raw) return target.raw.trim()
  if ((target.resolved?.kind === 'identifier' || target.resolved?.kind === 'member') && target.resolved.raw) {
    return target.resolved.raw.trim()
  }
  return null
}

function isMemberPath(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value)
}

export function detectNavRouter(
  nodeId: string,
  edge: CodeEdgeLike,
  context: RelationAdapterContext,
): string | null {
  const { index } = context
  for (const imp of (index.importsBySource.get(nodeId) ?? [])) {
    const router = routerForNavigationPackage(imp.targetSpecifier)
    if (router) return router
  }

  const node = index.nodesById.get(nodeId)
  if (node) {
    for (const fileNode of (index.nodesByFile.get(node.filePath) ?? [])) {
      for (const imp of (index.importsBySource.get(fileNode.id) ?? [])) {
        const router = routerForNavigationPackage(imp.targetSpecifier)
        if (router) return router
      }
    }
  }

  return detectRouterFromReceiver(edge) ?? detectRouterFromHookCalls(nodeId, context)
}

function detectRouterFromReceiver(edge: CodeEdgeLike): string | null {
  const chainPath = edge.chainPath ?? ''
  const method = edge.targetSymbol ?? ''
  if (chainPath === 'context' && ['go', 'push', 'replace', 'goNamed', 'pushNamed'].includes(method)) {
    return 'flutter_gorouter'
  }
  if (chainPath === 'NextResponse' && method === 'redirect') return 'nextjs'
  if ((chainPath === 'Navigator' || chainPath.startsWith('Navigator.of')) && ['pushNamed', 'popAndPushNamed', 'pushReplacementNamed'].includes(method)) {
    return 'flutter_navigator'
  }
  if (chainPath === 'Get') return 'flutter_getx'
  if (chainPath === 'context.router' || chainPath.startsWith('AutoRouter.')) return 'flutter_auto_route'
  if (chainPath.startsWith('Beamer.')) return 'flutter_beamer'
  return null
}

function detectRouterFromHookCalls(nodeId: string, context: RelationAdapterContext): string | null {
  const { index } = context
  const node = index.nodesById.get(nodeId)
  const ids = [nodeId, ...(node ? (index.nodesByFile.get(node.filePath) ?? []).map((fileNode) => fileNode.id) : [])]
  for (const id of ids) {
    for (const call of index.callsBySource.get(id) ?? []) {
      if (call.targetSymbol === 'useRouter') return 'nextjs'
      if (call.targetSymbol === 'useNavigate') return 'react_router'
      if (call.targetSymbol === 'useLocation') return 'wouter'
    }
  }
  return null
}

function extractScheme(url: string): string {
  const match = url.match(/^([a-z][a-z0-9+.-]*):/)
  return match?.[1] ?? 'unknown'
}

function isExternalScheme(url: string): boolean {
  return /^(tel|mailto|sms|intent|market|zxing):/.test(url)
}
