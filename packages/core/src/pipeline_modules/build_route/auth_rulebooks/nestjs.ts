// NestJS authorization rulebook: @UseGuards / @Roles / @Public.
// Reads `decorates` edges build_graph emits (method-level first, then enclosing class).
// Note: @UseGuards(GuardClass) args are identifiers — build_graph does NOT capture guard names
// (literalArgs = [null]); we record required:true from presence, guard names best-effort.
import type { CodeEdge } from '@/db/schema/code_graph.js'
import type { AuthGraph, AuthRulebook, RouteAuth } from './types.js'

const NEST_AUTH_DECORATORS = new Set(['UseGuards', 'Roles', 'Public'])

/** TS decorator literalArgs shape: JSON array [...]. Keep only non-empty string literals. */
function tsArray(literalArgs: string | null): string[] {
  if (!literalArgs) return []
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    /* malformed → no args */
  }
  return []
}

function authDecorates(graph: AuthGraph, nodeId: string): CodeEdge[] {
  return graph
    .outgoingEdges(nodeId)
    .filter((e) => e.relation === 'decorates' && NEST_AUTH_DECORATORS.has(e.targetSymbol ?? ''))
}

function buildAuth(edges: CodeEdge[], scope: 'method' | 'class'): RouteAuth {
  const decorators = edges.map((e) => e.targetSymbol).filter((s): s is string => Boolean(s))
  const evidenceEdgeIds = edges.map((e) => e.id)

  // @Public() = explicitly public (overrides guards on the same node).
  if (edges.some((e) => e.targetSymbol === 'Public')) {
    return { required: false, scope, decorators, evidenceEdgeIds }
  }

  const roles = edges.filter((e) => e.targetSymbol === 'Roles').flatMap((e) => tsArray(e.literalArgs))
  const guards = edges.filter((e) => e.targetSymbol === 'UseGuards').flatMap((e) => tsArray(e.literalArgs))
  return {
    required: true,
    scope,
    decorators,
    evidenceEdgeIds,
    ...(roles.length ? { roles: [...new Set(roles)] } : {}),
    ...(guards.length ? { guards: [...new Set(guards)] } : {}),
  }
}

export const nestjsAuthRulebook: AuthRulebook = {
  framework: 'nestjs',
  readAuth(handler, graph) {
    const methodEdges = authDecorates(graph, handler.id)
    if (methodEdges.length) return buildAuth(methodEdges, 'method')

    // Class-level @UseGuards / @Public applies to all handlers in the controller.
    const containsEdge = graph.incomingEdges(handler.id).find((e) => e.relation === 'contains')
    if (containsEdge?.sourceId) {
      const classEdges = authDecorates(graph, containsEdge.sourceId)
      if (classEdges.length) return buildAuth(classEdges, 'class')
    }
    return null
  },
}
