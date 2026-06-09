import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { fastify } from '@/pipeline_modules/build_route/adapters/fastify.js'
import { hono } from '@/pipeline_modules/build_route/adapters/hono.js'
import { koa } from '@/pipeline_modules/build_route/adapters/koa.js'
import { elysia } from '@/pipeline_modules/build_route/adapters/elysia.js'
import { TEST_REPO as REPO, e, loaded, n, resetEdgeId } from '../helpers/graph_builders.js'

function setup(filePath: string) {
  resetEdgeId()
  return n({ id: `r1:${filePath}:bootstrap`, type: 'function', filePath, name: 'bootstrap' })
}

// Emergent routing (now default) self-gates each http-call rule on the framework's import. Real repos
// have it; these unit graphs omitted it. httpGraph() prepends an import for the given package specifier.
function httpGraph(specifier: string, input: { nodes: ReturnType<typeof n>[]; edges: ReturnType<typeof e>[] }) {
  const file = n({ id: `r1:imp.${specifier}.ts`, type: 'file', filePath: `imp.${specifier}.ts`, name: 'imp.ts' })
  const imp = e({ sourceId: file.id, relation: 'imports', targetSpecifier: specifier, targetSymbol: 'default' })
  return createGraphIndex({ nodes: [file, ...input.nodes], edges: [imp, ...input.edges] })
}

describe('Backend HTTP call adapters — realistic JS/TS route coverage', () => {
  it('Fastify: server.get("/health") → GET /health', async () => {
    const node = setup('src/server.ts')
    const graph = httpGraph('fastify', {
      nodes: [node],
      edges: [e({ sourceId: node.id, relation: 'calls', targetSymbol: 'get', chainPath: 'server', firstArg: '/health' })],
    })
    const r = await runRuleEngine({ adapters: [loaded(fastify)], graph, repoId: REPO })
    expect(r.entryPoints).toMatchObject([{ framework: 'fastify', httpMethod: 'GET', fullPath: '/health' }])
  })

  it('Hono: route.post("/orders/:id") → POST /orders/:id', async () => {
    const node = setup('src/routes/orders.ts')
    const graph = httpGraph('hono', {
      nodes: [node],
      edges: [e({ sourceId: node.id, relation: 'calls', targetSymbol: 'post', chainPath: 'route', firstArg: '/orders/:id' })],
    })
    const r = await runRuleEngine({ adapters: [loaded(hono)], graph, repoId: REPO })
    expect(r.entryPoints).toMatchObject([{ framework: 'hono', httpMethod: 'POST', fullPath: '/orders/:id' }])
  })

  it('Koa Router: router.options("/oauth/callback") → OPTIONS /oauth/callback', async () => {
    const node = setup('src/router.ts')
    const graph = httpGraph('koa', {
      nodes: [node],
      edges: [e({ sourceId: node.id, relation: 'calls', targetSymbol: 'options', chainPath: 'router', firstArg: '/oauth/callback' })],
    })
    const r = await runRuleEngine({ adapters: [loaded(koa)], graph, repoId: REPO })
    expect(r.entryPoints).toMatchObject([{ framework: 'koa', httpMethod: 'OPTIONS', fullPath: '/oauth/callback' }])
  })

  it('Elysia: app.head("/status") → HEAD /status', async () => {
    const node = setup('src/index.ts')
    const graph = httpGraph('elysia', {
      nodes: [node],
      edges: [e({ sourceId: node.id, relation: 'calls', targetSymbol: 'head', chainPath: 'app', firstArg: '/status' })],
    })
    const r = await runRuleEngine({ adapters: [loaded(elysia)], graph, repoId: REPO })
    expect(r.entryPoints).toMatchObject([{ framework: 'elysia', httpMethod: 'HEAD', fullPath: '/status' }])
  })

  it('Hono: dynamic path argument is rejected for source fallback instead of false positive', async () => {
    const node = setup('src/routes/dynamic.ts')
    const graph = createGraphIndex({
      nodes: [node],
      edges: [e({ sourceId: node.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: null })],
    })
    const r = await runRuleEngine({ adapters: [loaded(hono)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})
