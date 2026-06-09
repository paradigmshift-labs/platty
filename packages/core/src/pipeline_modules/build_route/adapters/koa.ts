import type { Adapter } from '../types.js'
import { createHttpCallRouteAdapter } from './http_call_route_adapter.js'

export const koa: Adapter = createHttpCallRouteAdapter({
  name: 'koa',
  frameworkMatches: ['koa'],
  importSpecifiers: ['koa', '@koa/router', 'koa-router'],
  roots: ['router'],
})
