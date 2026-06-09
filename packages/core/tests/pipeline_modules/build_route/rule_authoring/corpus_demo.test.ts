import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { graphFromBuildGraph } from '@/pipeline_modules/build_route/rule_authoring/load_build_graph.js'
import { evaluateRouteRuleForPromotion } from '@/pipeline_modules/build_route/rule_authoring/promote_gate.js'
import type { RouteAdapterRuleCandidate } from '@/pipeline_modules/build_route/rule_authoring/types.js'

// End-to-end on REAL corpus build_graph output (not hand-built graphs): proves the referee admits a
// well-formed rule and rejects an ungrounded one against actual graph shape + edge ids.
const FIX = 'tests/fixtures/build_route/rule_authoring'
const loadGraph = (name: string) =>
  graphFromBuildGraph(JSON.parse(readFileSync(`${FIX}/${name}.build_graph.json`, 'utf-8')))

const EXTRACT = { http_method: '${callee.method → uppercase}', path: '${first_arg}', handler_node_id: '${self}' }

describe('promote referee on real corpus build_graph', () => {
  it('fastify server.METHOD(path) rule reproduces its anchor, self-gates, stays clean → PROMOTE', async () => {
    const fastify: RouteAdapterRuleCandidate = {
      id: 'route.fastify.server-method',
      framework: 'fastify',
      kind: 'api',
      select: {
        relation: 'calls',
        callee: { chain_path_root_in: ['server', 'app', 'fastify', 'router'], method: ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] },
        first_arg: { kind: 'string_literal' },
      },
      extract: EXTRACT,
      requiresImport: ['fastify'],
      anchorFixture: 'pipeline/fastify/basic-routes',
      anchorEdgeIds: [2, 3, 4], // server.get('/health'), server.options('/oauth/callback'), server.post('/orders/:id')
      support: { matched: 3, examplePaths: ['/health', '/oauth/callback', '/orders/:id'] },
    }
    const v = await evaluateRouteRuleForPromotion({
      candidate: fastify,
      anchorGraph: loadGraph('fastify'),
      foreignGraphs: [
        { fixture: 'express', graph: loadGraph('express') },
        { fixture: 'nestjs', graph: loadGraph('nestjs') },
      ],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.anchorReproduction.got).toEqual(expect.arrayContaining([2, 3, 4]))
    expect(v.checks.crossFrameworkClean.pass).toBe(true)
  })

  it('express rule gated on "express" cannot reproduce its anchor when the repo imports express RELATIVELY → REJECT', async () => {
    // pipeline/express/error is from expressjs/express own examples: `require('../../')`, so there is no
    // imports edge with targetSpecifier 'express'. The referee correctly refuses to admit the rule — this
    // is the loop's "revise the gate / pick another anchor" signal, not a referee bug.
    const express: RouteAdapterRuleCandidate = {
      id: 'route.express.app-method',
      framework: 'express',
      kind: 'api',
      select: {
        relation: 'calls',
        callee: { chain_path_root_in: ['app', 'router'], method: ['get', 'post', 'put', 'delete', 'patch'] },
        first_arg: { kind: 'string_literal' },
      },
      extract: EXTRACT,
      requiresImport: ['express'],
      anchorFixture: 'pipeline/express/error',
      anchorEdgeIds: [1, 2], // app.get('/'), app.get('/next')
      support: { matched: 2, examplePaths: ['/', '/next'] },
    }
    const v = await evaluateRouteRuleForPromotion({
      candidate: express,
      anchorGraph: loadGraph('express'),
      foreignGraphs: [],
    })
    expect(v.promote).toBe(false)
    expect(v.checks.anchorReproduction.pass).toBe(false) // gate never fires → 0 entries → anchor not reproduced
  })

  it('nestjs @Controller+@Get decorator rule self-gates on @nestjs/common → PROMOTE', async () => {
    const nestjs: RouteAdapterRuleCandidate = {
      id: 'route.nestjs.controller-method-decorator',
      framework: 'nestjs',
      kind: 'api',
      select: { enclosing_class_decorated_by: 'Controller', decorated_by: ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head'] },
      extract: { http_method: '${decorator_name → uppercase}', path: '${first_arg}', handler_node_id: '${self}' },
      requiresImport: ['@nestjs/common'],
      anchorFixture: 'pipeline/nestjs/cats-app',
      anchorEdgeIds: [29, 34, 39],
      support: { matched: 3, examplePaths: ['/cats', '/cats', '/cats/:id'] },
    }
    const v = await evaluateRouteRuleForPromotion({
      candidate: nestjs,
      anchorGraph: loadGraph('nestjs'),
      foreignGraphs: [{ fixture: 'fastify', graph: loadGraph('fastify') }, { fixture: 'react', graph: loadGraph('react') }],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.evidenceGate.pass).toBe(true) // the gate now covers the enclosing_class path
  })

  it('react-router <Route path> rule extracts ${jsx_attr.path} → PROMOTE', async () => {
    const react: RouteAdapterRuleCandidate = {
      id: 'route.react.router-v6-renders',
      framework: 'react',
      kind: 'page',
      select: { relation: 'renders', callee: { symbol: ['Route'] } },
      extract: { path: '${jsx_attr.path}', handler_node_id: '${self}' },
      requiresImport: ['react-router-dom'],
      anchorFixture: 'pipeline/react-router-v6/sidebar1',
      anchorEdgeIds: [41, 42, 43, 44, 45, 46, 47, 48, 49],
      support: { matched: 9, examplePaths: ['/', '/angular', '/react'] },
    }
    const v = await evaluateRouteRuleForPromotion({
      candidate: react,
      anchorGraph: loadGraph('react'),
      foreignGraphs: [{ fixture: 'fastify', graph: loadGraph('fastify') }, { fixture: 'nestjs', graph: loadGraph('nestjs') }],
    })
    expect(v.promote).toBe(true)
    expect(v.checks.anchorReproduction.got).toEqual(expect.arrayContaining([41, 49]))
  })

  it('flutter go_router GoRoute(path) rule → PROMOTE', async () => {
    const flutter: RouteAdapterRuleCandidate = {
      id: 'route.flutter.gorouter-constructor',
      framework: 'flutter',
      kind: 'page',
      select: { relation: 'calls', callee: { symbol: ['GoRoute'] }, first_arg: { kind: 'string_literal' } },
      extract: { path: '${first_arg}', handler_node_id: '${self}' },
      requiresImport: ['package:go_router/go_router.dart'],
      anchorFixture: 'pipeline/flutter-gorouter/redirection',
      anchorEdgeIds: [11, 12],
      support: { matched: 2, examplePaths: ['/', '/login'] },
    }
    const v = await evaluateRouteRuleForPromotion({
      candidate: flutter,
      anchorGraph: loadGraph('flutter'),
      foreignGraphs: [{ fixture: 'express', graph: loadGraph('express') }, { fixture: 'react', graph: loadGraph('react') }],
    })
    expect(v.promote).toBe(true)
  })
})
