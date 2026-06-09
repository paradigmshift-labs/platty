// Endpoint-authorization rulebook registry. Mirrors the route-adapter registry pattern:
// add a framework by creating auth_rulebooks/{fw}.ts + registering here — no f3 core change.
import type { EntryPointDraft } from '../types.js'
import type { AuthGraph, AuthRulebook } from './types.js'
import { springAuthRulebook } from './spring.js'
import { nestjsAuthRulebook } from './nestjs.js'

export type { AuthRulebook, RouteAuth, AuthGraph } from './types.js'

const AUTH_RULEBOOKS = new Map<string, AuthRulebook>([
  [springAuthRulebook.framework, springAuthRulebook],
  [nestjsAuthRulebook.framework, nestjsAuthRulebook],
  // Express/Koa/Fastify auth = structural middleware (not decorates) → deferred.
])

/**
 * Fill entryPoint.metadata.auth from the framework's auth annotations (if any).
 * No-op when the framework has no rulebook, the handler node is missing, or no auth signal exists
 * (we never guess — absent metadata.auth means "no static auth signal", not "public").
 */
export function enrichAuthMetadata(entryPoint: EntryPointDraft, graph: AuthGraph): void {
  const rulebook = AUTH_RULEBOOKS.get(entryPoint.framework)
  if (!rulebook) return
  const handler = graph.getNode(entryPoint.handlerNodeId)
  if (!handler) return
  const auth = rulebook.readAuth(handler, graph)
  if (auth) entryPoint.metadata.auth = auth
}
