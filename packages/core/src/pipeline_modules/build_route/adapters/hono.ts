import type { Adapter } from '../types.js'
import { createHttpCallRouteAdapter } from './http_call_route_adapter.js'

export const hono: Adapter = createHttpCallRouteAdapter({
  name: 'hono',
  frameworkMatches: ['hono'],
  importSpecifiers: ['hono'],
  roots: ['app', 'route', 'router'],
})
