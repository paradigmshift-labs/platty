// build_route — endpoint authorization rulebook contract.
//
// build_graph already emits auth annotations (@PreAuthorize / @UseGuards / @Roles / @Public / …)
// as `decorates` edges. A per-framework AuthRulebook reads those edges off the handler node (and
// its enclosing class) and produces a RouteAuth, stored at entryPoint.metadata.auth. NO new graph
// contract, NO route schema change (metadata is the existing opaque extension field).
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'

/** Endpoint authorization, stored at entryPoint.metadata.auth. Absent when no auth signal is found. */
export interface RouteAuth {
  /** false = explicitly public (@PermitAll / @Public); true = guarded by an auth annotation. */
  required: boolean
  /** Roles extracted best-effort (@Roles / @RolesAllowed / @Secured args, or hasRole() in SpEL). */
  roles?: string[]
  /** Raw auth expression preserved verbatim (Spring @PreAuthorize SpEL). */
  expression?: string
  /** Guard class names (NestJS @UseGuards) — best-effort; often empty (identifier args uncaptured). */
  guards?: string[]
  /** Where the annotation was found. method overrides class. */
  scope: 'method' | 'class'
  /** Matched auth decorator symbols (audit). */
  decorators: string[]
  /** Evidence edge ids (audit). */
  evidenceEdgeIds: number[]
}

/** Minimal graph surface an AuthRulebook reads (subset of build_route GraphIndex). */
export interface AuthGraph {
  getNode(id: string): CodeNode | undefined
  outgoingEdges(nodeId: string): CodeEdge[]
  incomingEdges(nodeId: string): CodeEdge[]
}

export interface AuthRulebook {
  /** Framework key matching EntryPointDraft.framework (e.g. 'spring', 'nestjs'). */
  framework: string
  /** Read auth off a handler node; null when no auth signal (caller leaves metadata.auth unset). */
  readAuth(handler: CodeNode, graph: AuthGraph): RouteAuth | null
}
