import type { Adapter } from '../types.js'
import { createHttpCallRouteAdapter } from './http_call_route_adapter.js'

export const elysia: Adapter = createHttpCallRouteAdapter({
  name: 'elysia',
  frameworkMatches: ['elysia'],
  importSpecifiers: ['elysia'],
  roots: ['app', 'server', 'elysia'],
})
