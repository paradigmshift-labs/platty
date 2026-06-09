// Spring Security authorization rulebook: @PreAuthorize / @Secured / @RolesAllowed / @PermitAll.
// Reads `decorates` edges build_graph already emits (method-level first, then enclosing class).
import type { CodeEdge } from '@/db/schema/code_graph.js'
import type { AuthGraph, AuthRulebook, RouteAuth } from './types.js'

const SPRING_AUTH_DECORATORS = new Set(['PreAuthorize', 'Secured', 'RolesAllowed', 'PermitAll'])

/** Strip one layer of surrounding quotes (JVM arg parser is inconsistent: keeps quotes for SpEL). */
function stripQuotes(s: unknown): string {
  return typeof s === 'string' ? s.replace(/^['"]|['"]$/g, '').trim() : ''
}

/** JVM decorator literalArgs shape: {"positional":[...],"named":{...}}. Return cleaned positional strings. */
function jvmPositional(literalArgs: string | null): string[] {
  if (!literalArgs) return []
  try {
    const parsed = JSON.parse(literalArgs) as { positional?: unknown }
    if (Array.isArray(parsed.positional)) return parsed.positional.map(stripQuotes).filter(Boolean)
  } catch {
    /* malformed → no args */
  }
  return []
}

/** Extract role names from a Spring SpEL expression: hasRole('X'), hasAnyRole('X','Y'), hasAuthority('X'). */
function rolesFromSpel(expr: string): string[] {
  const roles: string[] = []
  const re = /has(?:Any)?(?:Role|Authority|Authorities)\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(expr)) !== null) {
    for (const part of m[1]!.split(',')) {
      const r = stripQuotes(part)
      if (r) roles.push(r)
    }
  }
  return roles
}

function buildAuth(edges: CodeEdge[], scope: 'method' | 'class'): RouteAuth {
  const decorators = edges.map((e) => e.targetSymbol).filter((s): s is string => Boolean(s))
  const evidenceEdgeIds = edges.map((e) => e.id)

  // Pure @PermitAll = explicitly public.
  if (decorators.length > 0 && decorators.every((d) => d === 'PermitAll')) {
    return { required: false, scope, decorators, evidenceEdgeIds }
  }

  const roles: string[] = []
  let expression: string | undefined
  for (const e of edges) {
    if (e.targetSymbol === 'PermitAll') continue
    if (e.targetSymbol === 'PreAuthorize') {
      const expr = jvmPositional(e.literalArgs)[0]
      if (expr) {
        expression = expr
        roles.push(...rolesFromSpel(expr))
      }
    } else {
      // @Secured / @RolesAllowed — positional role strings.
      roles.push(...jvmPositional(e.literalArgs))
    }
  }
  const uniqueRoles = [...new Set(roles)]
  return {
    required: true,
    scope,
    decorators,
    evidenceEdgeIds,
    ...(uniqueRoles.length ? { roles: uniqueRoles } : {}),
    ...(expression ? { expression } : {}),
  }
}

function authDecorates(graph: AuthGraph, nodeId: string): CodeEdge[] {
  return graph
    .outgoingEdges(nodeId)
    .filter((e) => e.relation === 'decorates' && SPRING_AUTH_DECORATORS.has(e.targetSymbol ?? ''))
}

export const springAuthRulebook: AuthRulebook = {
  framework: 'spring',
  readAuth(handler, graph) {
    const methodEdges = authDecorates(graph, handler.id)
    if (methodEdges.length) return buildAuth(methodEdges, 'method')

    // Class-level @Secured/@RolesAllowed inherited by all handlers in the class.
    const containsEdge = graph.incomingEdges(handler.id).find((e) => e.relation === 'contains')
    if (containsEdge?.sourceId) {
      const classEdges = authDecorates(graph, containsEdge.sourceId)
      if (classEdges.length) return buildAuth(classEdges, 'class')
    }
    return null
  },
}
