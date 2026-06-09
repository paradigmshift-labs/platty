import { describe, it, expect } from 'vitest'
import { composeRoutePromotedAdapters } from '@/pipeline_modules/build_route/rule_authoring/consumption.js'
import type { RouteAdapterRuleCandidate } from '@/pipeline_modules/build_route/rule_authoring/types.js'

// The un-orphaning proof: a promoted route rule for a NEW framework becomes a live engine adapter. Production
// only consumes DB-persisted promotions (default empty = no-op); the import-coverage strip is the safety net
// that drops a rule whose import the hard-coded registry already declares.

const newFrameworkRule: RouteAdapterRuleCandidate = {
  id: 'route.hapi.server-route', framework: 'hapi', kind: 'api',
  select: { node_type: 'call', requires_import: [] } as RouteAdapterRuleCandidate['select'],
  extract: { http_method: '${first_arg}', path: '${first_arg}', handler_node_id: '${self}' },
  requiresImport: ['@hapi/hapi'],
  anchorFixture: 'hapi/server', anchorEdgeIds: [], support: { matched: 0, examplePaths: [] },
}

describe('build_route promoted-rule consumption', () => {
  it('safety net: a rule whose import the hard-coded registry declares (fastify) is stripped', () => {
    const adapters = composeRoutePromotedAdapters({ promoted: [{ ...newFrameworkRule, framework: 'fastify', requiresImport: ['fastify'] }] })
    expect(adapters).toEqual([])
  })

  it('a NEW framework rule (novel import) becomes a live engine adapter', () => {
    const adapters = composeRoutePromotedAdapters({ promoted: [newFrameworkRule] })
    expect(adapters).toHaveLength(1)
    expect(adapters[0].name).toBe('hapi')
    // wrapped as a single self-gated rule (requiresImport → select.requires_import)
    expect(adapters[0].entrypointRules[0].id).toBe('route.hapi.server-route')
    expect(adapters[0].entrypointRules[0].select.requires_import).toEqual(['@hapi/hapi'])
  })

  it('a rule with empty requiresImport is dropped (would fire everywhere)', () => {
    expect(composeRoutePromotedAdapters({ promoted: [{ ...newFrameworkRule, requiresImport: [] }] })).toEqual([])
  })

  it('empty input → empty (default no-op)', () => {
    expect(composeRoutePromotedAdapters()).toEqual([])
  })
})
