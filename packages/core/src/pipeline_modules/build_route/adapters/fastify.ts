import type { Adapter } from '../types.js'
import { createHttpCallRouteAdapter } from './http_call_route_adapter.js'

export const fastify: Adapter = createHttpCallRouteAdapter({
  name: 'fastify',
  frameworkMatches: ['fastify'],
  importSpecifiers: ['fastify'],
  roots: ['app', 'server', 'fastify'],
})
