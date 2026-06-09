// Express — Type B (call-based mounting + sub-router)
// architecture.md §4.4

import type { Adapter } from '../types.js'
import { createHttpCallRouteAdapter } from './http_call_route_adapter.js'

export const express: Adapter = createHttpCallRouteAdapter({
  name: 'express',
  frameworkMatches: ['express'],
  importSpecifiers: ['express'],
  roots: ['app', 'router'],
})
