import { describe, it, expect } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { evaluateRouteRuleForPromotion } from '@/pipeline_modules/build_route/rule_authoring/promote_gate.js'
import type { RouteAdapterRuleCandidate } from '@/pipeline_modules/build_route/rule_authoring/types.js'
import { n, e, resetEdgeId } from '../helpers/graph_builders.js'

// The deterministic promote referee for agent-authored route rules.
// Each test pins a single check by constructing the exact graph shape that should pass/fail it.
// See specs/build_route/agent-route-rule-loop.md §2.

const EXPRESS_EXTRACT = {
  http_method: '${callee.method → uppercase}',
  path: '${first_arg}',
  handler_node_id: '${self}',
}

// A well-formed express route rule: app/router.<httpMethod>(stringLiteral), gated on `express`.
function expressCandidate(over: Partial<RouteAdapterRuleCandidate> = {}): RouteAdapterRuleCandidate {
  return {
    id: 'route.express.app-method',
    framework: 'express',
    kind: 'api',
    select: {
      relation: 'calls',
      callee: { chain_path_root_in: ['app', 'router'], method: ['get', 'post', 'put', 'delete', 'patch'] },
      first_arg: { kind: 'string_literal' },
    },
    extract: EXPRESS_EXTRACT,
    requiresImport: ['express'],
    anchorFixture: 'test/express-anchor',
    anchorEdgeIds: [],
    support: { matched: 1, examplePaths: ['/users'] },
    ...over,
  }
}

// anchor graph: file A imports express, setup fn registers app.get('/users', handler).
function expressAnchor() {
  resetEdgeId()
  const appFile = n({ id: 'r1:app.ts', type: 'file', filePath: 'app.ts', name: 'app.ts' })
  const setup = n({ id: 'r1:routes.ts:setup', type: 'function', filePath: 'routes.ts', name: 'setup' })
  const imp = e({ sourceId: appFile.id, relation: 'imports', targetSymbol: 'express', targetSpecifier: 'express' })
  const routeCall = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/users' })
  const graph = createGraphIndex({ nodes: [appFile, setup], edges: [imp, routeCall] })
  return { graph, routeCallId: routeCall.id, setup, appFile }
}

// foreign koa repo (no express import) — structurally has router.get but must NOT trip an express rule.
function koaForeign() {
  const f = n({ id: 'r2:k.ts', type: 'file', filePath: 'k.ts', name: 'k.ts' })
  const s = n({ id: 'r2:k.ts:s', type: 'function', filePath: 'k.ts', name: 's' })
  const imp = e({ sourceId: f.id, relation: 'imports', targetSymbol: 'Koa', targetSpecifier: 'koa' })
  const route = e({ sourceId: s.id, relation: 'calls', targetSymbol: 'get', chainPath: 'router', firstArg: '/health' })
  return { fixture: 'test/koa', graph: createGraphIndex({ nodes: [f, s], edges: [imp, route] }) }
}

describe('evaluateRouteRuleForPromotion', () => {
  it('happy path: well-formed gated rule that reproduces its anchor + stays clean → promote', async () => {
    const { graph, routeCallId } = expressAnchor()
    const v = await evaluateRouteRuleForPromotion({
      candidate: expressCandidate({ anchorEdgeIds: [routeCallId] }),
      anchorGraph: graph,
      foreignGraphs: [koaForeign()],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.requiresImportNonEmpty.pass).toBe(true)
    expect(v.checks.anchorReproduction.pass).toBe(true)
    expect(v.checks.evidenceGate.pass).toBe(true)
    expect(v.checks.evidenceGate.entriesWithEvidenceWithheld).toBe(0)
    expect(v.checks.crossFrameworkClean.pass).toBe(true)
  })

  it('empty requiresImport → rejected (no self-gate): requiresImportNonEmpty AND evidenceGate fail', async () => {
    const { graph, routeCallId } = expressAnchor()
    const v = await evaluateRouteRuleForPromotion({
      candidate: expressCandidate({ requiresImport: [], anchorEdgeIds: [routeCallId] }),
      anchorGraph: graph,
      foreignGraphs: [koaForeign()],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.requiresImportNonEmpty.pass).toBe(false)
    // with no gate the rule fires even when imports are withheld, and pollutes the koa foreign repo
    expect(v.checks.evidenceGate.pass).toBe(false)
    expect(v.checks.crossFrameworkClean.pass).toBe(false)
  })

  it('anchor edge not caught → rejected (anchorReproduction)', async () => {
    const { graph } = expressAnchor()
    const v = await evaluateRouteRuleForPromotion({
      candidate: expressCandidate({ anchorEdgeIds: [99999] }), // an edge the rule cannot match
      anchorGraph: graph,
      foreignGraphs: [koaForeign()],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorReproduction.pass).toBe(false)
    expect(v.checks.anchorReproduction.missing).toContain(99999)
  })

  it('no anchorEdgeIds declared → rejected (agent must cite what it catches)', async () => {
    const { graph } = expressAnchor()
    const v = await evaluateRouteRuleForPromotion({
      candidate: expressCandidate({ anchorEdgeIds: [] }),
      anchorGraph: graph,
      foreignGraphs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorReproduction.pass).toBe(false)
  })

  it('over-broad rule (no chain root) fires on a foreign repo → rejected (crossFrameworkClean)', async () => {
    const { graph, routeCallId } = expressAnchor()
    // foreign express-importing repo with a NON-route getter `cache.get('key')`
    const cf = n({ id: 'r3:c.ts', type: 'file', filePath: 'c.ts', name: 'c.ts' })
    const cfn = n({ id: 'r3:c.ts:f', type: 'function', filePath: 'c.ts', name: 'f' })
    const cimp = e({ sourceId: cf.id, relation: 'imports', targetSymbol: 'express', targetSpecifier: 'express' })
    const cget = e({ sourceId: cfn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'cache', firstArg: 'user:1' })
    const foreign = { fixture: 'test/cache-getter', graph: createGraphIndex({ nodes: [cf, cfn], edges: [cimp, cget] }) }

    const broad = expressCandidate({
      id: 'route.express.too-broad',
      anchorEdgeIds: [routeCallId],
      // BUG: no chain_path_root_in → matches any `.get('literal')`
      select: { relation: 'calls', callee: { method: ['get'] }, first_arg: { kind: 'string_literal' } },
    })
    const v = await evaluateRouteRuleForPromotion({ candidate: broad, anchorGraph: graph, foreignGraphs: [foreign] })
    expect(v.promote).toBe(false)
    expect(v.checks.crossFrameworkClean.pass).toBe(false)
    expect(v.checks.crossFrameworkClean.polluted[0].fixture).toBe('test/cache-getter')
  })

  it('anchorPrecision: rule that emits a settings-getter phantom over the answer-key → rejected', async () => {
    // anchor has a real route app.get('/users') AND a settings getter app.get('env')
    resetEdgeId()
    const appFile = n({ id: 'r1:app.ts', type: 'file', filePath: 'app.ts', name: 'app.ts' })
    const setup = n({ id: 'r1:app.ts:setup', type: 'function', filePath: 'app.ts', name: 'setup' })
    const imp = e({ sourceId: appFile.id, relation: 'imports', targetSymbol: 'express', targetSpecifier: 'express' })
    const route = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/users' })
    const getter = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: 'env' })
    const graph = createGraphIndex({ nodes: [appFile, setup], edges: [imp, route, getter] })

    const v = await evaluateRouteRuleForPromotion({
      candidate: expressCandidate({ anchorEdgeIds: [route.id] }),
      anchorGraph: graph,
      foreignGraphs: [],
      anchorExpectedRouteKeys: ['get /users'], // the real route only
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorPrecision?.pass).toBe(false)
    expect(v.checks.anchorPrecision?.overfired).toContain('get /env')
  })

  it('anchorPrecision passes when the rule matches exactly the answer-key', async () => {
    const { graph, routeCallId } = expressAnchor()
    const v = await evaluateRouteRuleForPromotion({
      candidate: expressCandidate({ anchorEdgeIds: [routeCallId] }),
      anchorGraph: graph,
      foreignGraphs: [koaForeign()],
      anchorExpectedRouteKeys: ['get /users'],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.anchorPrecision?.pass).toBe(true)
  })
})
