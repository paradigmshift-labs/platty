// rule_authoring/promoted_rules — the growing RULEBOOK of agent-authored route rules that passed the
// deterministic promote referee. Appending an entry here is how a discovered rule joins the engine; the
// keystone test (tests/.../rule_authoring/promoted_rules.test.ts) re-runs the referee on every entry, so
// each rule arrives "tested by construction" and stays promotable (a regression guard for the rulebook).
//
// These four were authored by parallel Claude sub-agents from real corpus build_graph and promoted by
// evaluateRouteRuleForPromotion. See specs/build_route/agent-route-rule-loop-RESULTS.md.

import type { RouteAdapterRuleCandidate } from './types.js'

export const PROMOTED_ROUTE_RULES: RouteAdapterRuleCandidate[] = [
  {
    id: 'route.fastify.server-method',
    framework: 'fastify',
    kind: 'api',
    select: {
      relation: 'calls',
      callee: { chain_path_root_in: ['server', 'app', 'fastify', 'router'], method: ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] },
      first_arg: { kind: 'string_literal' },
    },
    extract: { http_method: '${callee.method → uppercase}', path: '${first_arg}', handler_node_id: '${self}' },
    requiresImport: ['fastify'],
    anchorFixture: 'pipeline/fastify/basic-routes',
    anchorEdgeIds: [2, 3, 4],
    support: { matched: 3, examplePaths: ['/health', '/oauth/callback', '/orders/:id'] },
  },
  {
    id: 'route.nestjs.controller-method-decorator',
    framework: 'nestjs',
    kind: 'api',
    select: { enclosing_class_decorated_by: 'Controller', decorated_by: ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head'] },
    extract: { http_method: '${decorator_name → uppercase}', path: '${first_arg}', handler_node_id: '${self}' },
    requiresImport: ['@nestjs/common'],
    anchorFixture: 'pipeline/nestjs/cats-app',
    anchorEdgeIds: [29, 34, 39],
    support: { matched: 3, examplePaths: ['/cats', '/cats', '/cats/:id'] },
  },
  {
    id: 'route.react.router-v6-renders',
    framework: 'react',
    kind: 'page',
    select: { relation: 'renders', callee: { symbol: ['Route'] } },
    extract: { path: '${jsx_attr.path}', handler_node_id: '${self}' },
    requiresImport: ['react-router-dom'],
    anchorFixture: 'pipeline/react-router-v6/sidebar1',
    anchorEdgeIds: [41, 42, 43, 44, 45, 46, 47, 48, 49],
    support: { matched: 9, examplePaths: ['/', '/angular', '/react'] },
  },
  {
    id: 'route.flutter.gorouter-constructor',
    framework: 'flutter',
    kind: 'page',
    select: { relation: 'calls', callee: { symbol: ['GoRoute'] }, first_arg: { kind: 'string_literal' } },
    extract: { path: '${first_arg}', handler_node_id: '${self}' },
    requiresImport: ['package:go_router/go_router.dart'],
    anchorFixture: 'pipeline/flutter-gorouter/redirection',
    anchorEdgeIds: [11, 12],
    support: { matched: 2, examplePaths: ['/', '/login'] },
  },
]

/**
 * The test obligation a promoted rule carries: it must still reproduce its anchor edges (fire), and emit
 * nothing once its evidence is withheld (gate). The keystone test exercises both via the referee.
 */
export interface RuleTestSpec {
  ruleId: string
  anchorFixture: string
  fires: number[] // anchorEdgeIds the rule must reproduce
  evidenceWithheld: string[] // removing these import specifiers must yield 0 entries
}

export function generateRuleTestSpec(candidate: RouteAdapterRuleCandidate): RuleTestSpec {
  return {
    ruleId: candidate.id,
    anchorFixture: candidate.anchorFixture,
    fires: candidate.anchorEdgeIds,
    evidenceWithheld: candidate.requiresImport,
  }
}
