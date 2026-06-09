import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type { SuspectedNode } from '@/pipeline_modules/build_route/types.js'
import type { RouteRuleAuthor } from '@/pipeline_modules/build_route/rule_authoring/autonomous_loop.js'
import { findRouteGaps } from '@/pipeline_modules/build_route/rule_authoring/autonomous_loop.js'
import { runLiveRouteDiscovery } from '@/pipeline_modules/build_route/rule_authoring/live_runner.js'
import { loadPromotedRouteRules } from '@/pipeline_modules/build_route/rule_authoring/persistence.js'
import type { RouteAdapterRuleCandidate } from '@/pipeline_modules/build_route/rule_authoring/types.js'
import { n, e, resetEdgeId } from '../helpers/graph_builders.js'

// A graph for a NEW framework 'hapi' (import '@hapi/hapi', a route call) + its koa foreign for cross-clean.
function hapiAnchor() {
  resetEdgeId()
  const appFile = n({ id: 'r1:app.ts', type: 'file', filePath: 'app.ts', name: 'app.ts' })
  const setup = n({ id: 'r1:routes.ts:setup', type: 'function', filePath: 'routes.ts', name: 'setup' })
  const imp = e({ sourceId: appFile.id, relation: 'imports', targetSymbol: 'hapi', targetSpecifier: '@hapi/hapi' })
  const routeCall = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/users' })
  return { graph: createGraphIndex({ nodes: [appFile, setup], edges: [imp, routeCall] }), routeCallId: routeCall.id, setupId: setup.id }
}
function koaForeign() {
  const f = n({ id: 'r2:k.ts', type: 'file', filePath: 'k.ts', name: 'k.ts' })
  const s = n({ id: 'r2:k.ts:s', type: 'function', filePath: 'k.ts', name: 's' })
  const imp = e({ sourceId: f.id, relation: 'imports', targetSymbol: 'Koa', targetSpecifier: 'koa' })
  const route = e({ sourceId: s.id, relation: 'calls', targetSymbol: 'get', chainPath: 'router', firstArg: '/health' })
  return { fixture: 'test/koa', graph: createGraphIndex({ nodes: [f, s], edges: [imp, route] }) }
}
function hapiCandidate(routeCallId: number): RouteAdapterRuleCandidate {
  return {
    id: 'route.hapi.app-method', framework: 'hapi', kind: 'api',
    select: { relation: 'calls', callee: { chain_path_root_in: ['app', 'router'], method: ['get', 'post'] }, first_arg: { kind: 'string_literal' } } as RouteAdapterRuleCandidate['select'],
    extract: { http_method: '${callee.method → uppercase}', path: '${first_arg}', handler_node_id: '${self}' },
    requiresImport: ['@hapi/hapi'], anchorFixture: 'auto/hapi', anchorEdgeIds: [routeCallId],
    support: { matched: 1, examplePaths: ['/users'] },
  }
}

describe('build_route live_runner + loop', () => {
  let db: DB
  beforeEach(() => {
    db = createTestDb()
    db.insert(projects).values({ id: 'p', name: 'p' }).run()
    db.insert(repositories).values({ id: 'r1', projectId: 'p', name: 'r', repoPath: '/mock' }).run()
  })

  it('findRouteGaps maps suspected nodes to gaps with file paths', () => {
    const { graph, setupId } = hapiAnchor()
    const suspected: SuspectedNode[] = [{ nodeId: setupId, adapter: 'hapi', reason: 'unmatched_routing_file', contextHint: 'file' }]
    const gaps = findRouteGaps(suspected, graph)
    expect(gaps).toEqual([{ reason: 'unmatched_routing_file', nodeId: setupId, filePath: 'routes.ts', contextHint: 'file', adapter: 'hapi' }])
  })

  it('ACTIVATION: gap → stub author → referee → promote → persist', async () => {
    const { graph, routeCallId, setupId } = hapiAnchor()
    const suspected: SuspectedNode[] = [{ nodeId: setupId, adapter: 'hapi', reason: 'unmatched_routing_file' }]
    const author: RouteRuleAuthor = async () => hapiCandidate(routeCallId)
    const result = await runLiveRouteDiscovery({ db, repoId: 'r1', graph, suspected, author, foreignGraphs: [koaForeign()] })
    expect(result.promoted.map((r) => r.id)).toEqual(['route.hapi.app-method'])
    expect(loadPromotedRouteRules({ db, repoId: 'r1' })?.rules.map((r) => r.id)).toEqual(['route.hapi.app-method'])
  })
})
