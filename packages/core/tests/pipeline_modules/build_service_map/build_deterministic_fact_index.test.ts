import { describe, expect, it } from 'vitest'

import { buildDeterministicFactIndex } from '@/pipeline_modules/build_service_map/f3_build_deterministic_fact_index.js'
import type { ServiceMapInputIndex } from '@/pipeline_modules/build_service_map/types.js'

describe('build_service_map F3 deterministic fact anchoring', () => {
  it('anchors relation facts from service nodes reachable from an entrypoint handler', () => {
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-post-orders',
          repoId: 'repo-1',
          framework: 'nextjs',
          kind: 'api',
          httpMethod: 'POST',
          path: '/api/orders',
          fullPath: '/api/orders',
          handlerNodeId: 'node-route-post',
          metadata: null,
          confidence: 'high',
          filePath: 'app/api/orders/route.ts',
          name: 'POST',
        },
      ],
      graphNodes: [
        { id: 'node-route-post', type: 'function', filePath: 'app/api/orders/route.ts', name: 'POST', lineStart: 10, lineEnd: 14 },
        { id: 'node-create-order', type: 'function', filePath: 'app/lib/orders.ts', name: 'createOrder', lineStart: 3, lineEnd: 9 },
      ],
      graphEdges: [
        { sourceId: 'node-route-post', targetId: 'node-create-order', relation: 'calls', targetSymbol: 'createOrder', targetSpecifier: null },
      ],
      codeRelations: [
        {
          id: 'rel-db-insert',
          repoId: 'repo-1',
          sourceNodeId: 'node-create-order',
          kind: 'db_access',
          target: 'orders',
          operation: 'insert',
          canonicalTarget: 'db:orders:insert',
          payload: {},
          evidenceNodeIds: ['node-create-order'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    expect(result.orphanFacts).toHaveLength(0)
    expect(result.anchoredFacts).toEqual([
      expect.objectContaining({
        sourceEntryPointId: 'ep-post-orders',
        relationId: 'rel-db-insert',
        kind: 'db_access',
        canonicalTarget: 'db:orders:insert',
      }),
    ])
  })

  it('anchors a relation reached from the handler through a renders edge (page→component→repo)', () => {
    // A page entrypoint renders a screen component which calls a repository; the
    // repository holds the api_call relation. Reachability must follow `renders`
    // (first hop) or the whole screen→API chain is orphaned. build_route's bundle
    // already includes the rendered chain — the anchor walk must agree.
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-orders-page',
          repoId: 'repo-1',
          framework: 'nextjs',
          kind: 'page',
          httpMethod: null,
          path: '/orders',
          fullPath: '/orders',
          handlerNodeId: 'node-orders-page',
          metadata: null,
          confidence: 'high',
          filePath: 'app/orders/page.tsx',
          name: 'OrdersPage',
        },
      ],
      graphNodes: [
        { id: 'node-orders-page', type: 'function', filePath: 'app/orders/page.tsx', name: 'OrdersPage', lineStart: 1, lineEnd: 3 },
        { id: 'node-orders-screen', type: 'function', filePath: 'app/orders/OrdersScreen.tsx', name: 'OrdersScreen', lineStart: 1, lineEnd: 5 },
        { id: 'node-load-orders', type: 'function', filePath: 'app/orders/repo.ts', name: 'loadOrders', lineStart: 1, lineEnd: 4 },
      ],
      graphEdges: [
        { sourceId: 'node-orders-page', targetId: 'node-orders-screen', relation: 'renders', targetSymbol: 'OrdersScreen', targetSpecifier: null },
        { sourceId: 'node-orders-screen', targetId: 'node-load-orders', relation: 'calls', targetSymbol: 'loadOrders', targetSpecifier: null },
      ],
      codeBundles: [
        { entryPointId: 'ep-orders-page', nodeId: 'node-orders-page', depth: 0 },
        { entryPointId: 'ep-orders-page', nodeId: 'node-orders-screen', depth: 1 },
        { entryPointId: 'ep-orders-page', nodeId: 'node-load-orders', depth: 2 },
      ],
      codeRelations: [
        {
          id: 'rel-api-orders',
          repoId: 'repo-1',
          sourceNodeId: 'node-load-orders',
          kind: 'api_call',
          target: '/api/orders',
          operation: 'POST',
          canonicalTarget: 'POST /api/orders',
          payload: {},
          evidenceNodeIds: ['node-load-orders'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    const anchored = result.anchoredFacts.map((f) => `${f.sourceEntryPointId}:${f.canonicalTarget}`)
    expect(anchored).toContain('ep-orders-page:POST /api/orders')
    expect(result.orphanFacts).toHaveLength(0)
  })

  it('anchors a relation reached via a resolves_to (DI receiver) edge — same definition as build_route', () => {
    // service_map의 anchor 도달성은 build_route 번들과 동일한 정의여야 한다(drift 방지).
    // build_route는 resolves_to(호출지점→수신자 선언)를 따라가므로 service_map도 따라가야 한다.
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-create', repoId: 'repo-1', framework: 'nestjs', kind: 'api',
          httpMethod: 'POST', path: '/orders', fullPath: '/orders', handlerNodeId: 'node-handler',
          metadata: null, confidence: 'high', filePath: 'ctrl.ts', name: 'create',
        },
      ],
      graphNodes: [
        { id: 'node-handler', type: 'method', filePath: 'ctrl.ts', name: 'OrderController.create', lineStart: 1, lineEnd: 3 },
        { id: 'node-svc', type: 'method', filePath: 'svc.ts', name: 'OrderService.save', lineStart: 1, lineEnd: 4 },
      ],
      graphEdges: [
        { sourceId: 'node-handler', targetId: 'node-svc', relation: 'resolves_to', targetSymbol: 'save', targetSpecifier: null },
      ],
      codeBundles: [
        { entryPointId: 'ep-create', nodeId: 'node-handler', depth: 0 },
        { entryPointId: 'ep-create', nodeId: 'node-svc', depth: 1 },
      ],
      codeRelations: [
        {
          id: 'rel-db', repoId: 'repo-1', sourceNodeId: 'node-svc', kind: 'db_access',
          target: 'orders', operation: 'insert', canonicalTarget: 'db:orders:insert',
          payload: {}, evidenceNodeIds: ['node-svc'], confidence: 'high', unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    const anchored = result.anchoredFacts.map((f) => `${f.sourceEntryPointId}:${f.canonicalTarget}`)
    expect(anchored).toContain('ep-create:db:orders:insert')
    expect(result.orphanFacts).toHaveLength(0)
  })

  it('anchors a deep bundle relation (beyond the old re-walk hop limit) by trusting build_route bundle membership', () => {
    // build_route 번들은 deep(예: 5홉)까지 모으지만, service_map의 옛 재추적은 hop 3으로 잘라서
    // 깊은 관계를 누락했다. 번들을 직접 신뢰하면(재추적 폐기) 번들에 든 노드는 깊이 무관하게 anchor 된다.
    const chain = ['h', 'a', 'b', 'c', 'd', 'e'] // h=handler(0) … e=depth5
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-deep', repoId: 'repo-1', framework: 'express', kind: 'api',
          httpMethod: 'GET', path: '/deep', fullPath: '/deep', handlerNodeId: 'h',
          metadata: null, confidence: 'high', filePath: 'r.ts', name: 'GET',
        },
      ],
      graphNodes: chain.map((id) => ({ id, type: 'method', filePath: 'r.ts', name: id, lineStart: 1, lineEnd: 2 })),
      graphEdges: chain.slice(0, -1).map((id, i) => ({ sourceId: id, targetId: chain[i + 1], relation: 'calls', targetSymbol: chain[i + 1], targetSpecifier: null })),
      codeBundles: chain.map((id, i) => ({ entryPointId: 'ep-deep', nodeId: id, depth: i })),
      codeRelations: [
        {
          id: 'rel-deep', repoId: 'repo-1', sourceNodeId: 'e', kind: 'db_access',
          target: 'logs', operation: 'insert', canonicalTarget: 'db:logs:insert',
          payload: {}, evidenceNodeIds: ['e'], confidence: 'high', unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    const anchored = result.anchoredFacts.map((f) => `${f.sourceEntryPointId}:${f.canonicalTarget}`)
    expect(anchored).toContain('ep-deep:db:logs:insert')
    expect(result.orphanFacts).toHaveLength(0)
  })

  it('resolves unresolved call symbols through imports without attaching sibling handlers', () => {
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-get-orders',
          repoId: 'repo-1',
          framework: 'nextjs',
          kind: 'api',
          httpMethod: 'GET',
          path: '/api/orders',
          fullPath: '/api/orders',
          handlerNodeId: 'node-route-get',
          metadata: null,
          confidence: 'high',
          filePath: 'app/api/orders/route.ts',
          name: 'GET',
        },
        {
          id: 'ep-post-orders',
          repoId: 'repo-1',
          framework: 'nextjs',
          kind: 'api',
          httpMethod: 'POST',
          path: '/api/orders',
          fullPath: '/api/orders',
          handlerNodeId: 'node-route-post',
          metadata: null,
          confidence: 'high',
          filePath: 'app/api/orders/route.ts',
          name: 'POST',
        },
      ],
      graphNodes: [
        { id: 'node-route-file', type: 'file', filePath: 'app/api/orders/route.ts', name: 'route.ts', lineStart: null, lineEnd: null },
        { id: 'node-orders-file', type: 'file', filePath: 'app/lib/orders.ts', name: 'orders.ts', lineStart: null, lineEnd: null },
        { id: 'node-route-get', type: 'function', filePath: 'app/api/orders/route.ts', name: 'GET', lineStart: 4, lineEnd: 6 },
        { id: 'node-route-post', type: 'function', filePath: 'app/api/orders/route.ts', name: 'POST', lineStart: 8, lineEnd: 12 },
        { id: 'node-list-orders', type: 'function', filePath: 'app/lib/orders.ts', name: 'listOrders', lineStart: 3, lineEnd: 5 },
        { id: 'node-create-order', type: 'function', filePath: 'app/lib/orders.ts', name: 'createOrder', lineStart: 7, lineEnd: 10 },
      ],
      graphEdges: [
        { sourceId: 'node-route-file', targetId: 'node-route-get', relation: 'contains', targetSymbol: 'GET', targetSpecifier: null },
        { sourceId: 'node-route-file', targetId: 'node-route-post', relation: 'contains', targetSymbol: 'POST', targetSpecifier: null },
        { sourceId: 'node-orders-file', targetId: 'node-list-orders', relation: 'contains', targetSymbol: 'listOrders', targetSpecifier: null },
        { sourceId: 'node-orders-file', targetId: 'node-create-order', relation: 'contains', targetSymbol: 'createOrder', targetSpecifier: null },
        { sourceId: 'node-route-file', targetId: 'node-orders-file', relation: 'imports', targetSymbol: null, targetSpecifier: '@/lib/orders' },
        { sourceId: 'node-route-get', targetId: null, relation: 'calls', targetSymbol: 'listOrders', targetSpecifier: '../../lib/orders' },
        { sourceId: 'node-route-post', targetId: null, relation: 'calls', targetSymbol: 'createOrder', targetSpecifier: '../../lib/orders' },
      ],
      codeRelations: [
        {
          id: 'rel-db-select',
          repoId: 'repo-1',
          sourceNodeId: 'node-list-orders',
          kind: 'db_access',
          target: 'orders',
          operation: 'select',
          canonicalTarget: 'db:orders:select',
          payload: {},
          evidenceNodeIds: ['node-list-orders'],
          confidence: 'high',
          unresolvedReason: null,
        },
        {
          id: 'rel-db-insert',
          repoId: 'repo-1',
          sourceNodeId: 'node-create-order',
          kind: 'db_access',
          target: 'orders',
          operation: 'insert',
          canonicalTarget: 'db:orders:insert',
          payload: {},
          evidenceNodeIds: ['node-create-order'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)
    const anchored = result.anchoredFacts.map((fact) => `${fact.sourceEntryPointId}:${fact.relationId}`)

    expect(anchored).toEqual(expect.arrayContaining([
      'ep-get-orders:rel-db-select',
      'ep-post-orders:rel-db-insert',
    ]))
    expect(anchored).not.toContain('ep-get-orders:rel-db-insert')
    expect(anchored).not.toContain('ep-post-orders:rel-db-select')
  })

  // [migrated] The "does not promote polluted bundle relations" keystone test was REMOVED.
  // build_service_map now trusts build_route bundle membership directly (no re-walk gate), so the
  // "don't let an over-included bundle member pollute another entrypoint" responsibility moved UP:
  //   - build_route must not over-include (no execution path → not in bundle):
  //     tests/pipeline_modules/build_route/f5_resolve_reachability.test.ts
  //     "does not over-include an unconnected same-file sibling"
  //   - build_relations must not mis-attribute a class-level call onto a sibling (companion test,
  //     unchanged). The hand-built "lying bundle" the old test simulated cannot arise from a correct
  //     build_route, so asserting service_map filters it is no longer service_map's job.

  it('anchors same-file component facts to file-handler route entrypoints', () => {
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-accounts',
          repoId: 'repo-1',
          framework: 'react_router_v6',
          kind: 'page',
          httpMethod: null,
          path: '/accounts',
          fullPath: '/accounts',
          handlerNodeId: 'node-app-file',
          metadata: null,
          confidence: 'medium',
          filePath: 'src/App.tsx',
          name: 'src/App.tsx',
        },
      ],
      graphNodes: [
        { id: 'node-app-file', type: 'file', filePath: 'src/App.tsx', name: 'src/App.tsx', lineStart: null, lineEnd: null },
        { id: 'node-home-page', type: 'function', filePath: 'src/App.tsx', name: 'HomePage', lineStart: 4, lineEnd: 12 },
      ],
      graphEdges: [],
      codeRelations: [
        {
          id: 'rel-nav-accounts',
          repoId: 'repo-1',
          sourceNodeId: 'node-home-page',
          kind: 'navigation',
          target: '/accounts',
          operation: 'link',
          canonicalTarget: 'screen:/accounts',
          payload: {},
          evidenceNodeIds: ['node-home-page'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    expect(result.orphanFacts).toHaveLength(0)
    expect(result.anchoredFacts).toEqual([
      expect.objectContaining({
        sourceEntryPointId: 'ep-accounts',
        relationId: 'rel-nav-accounts',
        kind: 'navigation',
        canonicalTarget: 'screen:/accounts',
      }),
    ])
  })

  it('anchors frontend callback relation facts through executable ownership', () => {
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-profile',
          repoId: 'repo-1',
          framework: 'nextjs',
          kind: 'page',
          httpMethod: null,
          path: '/profile',
          fullPath: '/profile',
          handlerNodeId: 'node-profile-page',
          metadata: null,
          confidence: 'high',
          filePath: 'app/profile/page.tsx',
          name: 'ProfilePage',
        },
      ],
      graphNodes: [
        graphNode({ id: 'node-profile-page', type: 'function', filePath: 'app/profile/page.tsx', name: 'ProfilePage', lineStart: 1, lineEnd: 80 }),
        graphNode({ id: 'node-use-profile', type: 'function', filePath: 'app/profile/page.tsx', name: 'useProfile', parentNodeId: 'node-profile-page', originKind: 'function' }),
        graphNode({ id: 'node-query-fn', type: 'function', filePath: 'app/profile/page.tsx', name: 'useProfile.$queryFn_12_14', parentNodeId: 'node-use-profile', originKind: 'callback', role: 'queryFn' }),
        graphNode({ id: 'node-get-profile', type: 'method', filePath: 'app/profile/profileRepository.ts', name: 'getMyProfile' }),
      ],
      graphEdges: [
        { sourceId: 'node-profile-page', targetId: 'node-use-profile', relation: 'contains', targetSymbol: 'useProfile', targetSpecifier: null, chainPath: null },
        { sourceId: 'node-use-profile', targetId: 'node-query-fn', relation: 'contains', targetSymbol: 'queryFn', targetSpecifier: null, chainPath: null },
        { sourceId: 'node-query-fn', targetId: 'node-get-profile', relation: 'calls', targetSymbol: 'getMyProfile', targetSpecifier: null, chainPath: 'repository.getMyProfile' },
      ],
      codeRelations: [
        {
          id: 'rel-api-profile',
          repoId: 'repo-1',
          sourceNodeId: 'node-get-profile',
          kind: 'api_call',
          target: '/api/me',
          operation: 'GET',
          canonicalTarget: 'api:GET:/api/me',
          payload: {},
          evidenceNodeIds: ['node-query-fn', 'node-get-profile'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    expect(result.orphanFacts).toHaveLength(0)
    expect(result.anchoredFacts).toEqual([
      expect.objectContaining({
        sourceEntryPointId: 'ep-profile',
        relationId: 'rel-api-profile',
        kind: 'api_call',
        canonicalTarget: 'api:GET:/api/me',
        evidenceNodeIds: ['node-query-fn', 'node-get-profile'],
      }),
    ])
  })

  it('anchors backend transaction callback DB facts through executable ownership', () => {
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-delete-orders',
          repoId: 'repo-1',
          framework: 'nextjs',
          kind: 'api',
          httpMethod: 'DELETE',
          path: '/api/orders',
          fullPath: '/api/orders',
          handlerNodeId: 'node-delete-orders',
          metadata: null,
          confidence: 'high',
          filePath: 'app/api/orders/route.ts',
          name: 'DELETE',
        },
      ],
      graphNodes: [
        graphNode({ id: 'node-delete-orders', type: 'function', filePath: 'app/api/orders/route.ts', name: 'DELETE', lineStart: 5, lineEnd: 30 }),
        graphNode({ id: 'node-transaction-callback', type: 'function', filePath: 'app/api/orders/route.ts', name: 'DELETE.$transaction_12_20', parentNodeId: 'node-delete-orders', originKind: 'callback', role: 'transactionCallback' }),
        graphNode({ id: 'node-tx-order-delete-many', type: 'method', filePath: 'app/api/orders/route.ts', name: 'tx.order.deleteMany' }),
      ],
      graphEdges: [
        { sourceId: 'node-delete-orders', targetId: 'node-transaction-callback', relation: 'contains', targetSymbol: 'transactionCallback', targetSpecifier: null, chainPath: null },
        { sourceId: 'node-transaction-callback', targetId: 'node-tx-order-delete-many', relation: 'calls', targetSymbol: 'deleteMany', targetSpecifier: null, chainPath: 'tx.order.deleteMany' },
      ],
      codeRelations: [
        {
          id: 'rel-db-delete-orders',
          repoId: 'repo-1',
          sourceNodeId: 'node-tx-order-delete-many',
          kind: 'db_access',
          target: 'orders',
          operation: 'deleteMany',
          canonicalTarget: 'db:orders:deleteMany',
          payload: {},
          evidenceNodeIds: ['node-transaction-callback', 'node-tx-order-delete-many'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    expect(result.orphanFacts).toHaveLength(0)
    expect(result.anchoredFacts).toEqual([
      expect.objectContaining({
        sourceEntryPointId: 'ep-delete-orders',
        relationId: 'rel-db-delete-orders',
        kind: 'db_access',
        canonicalTarget: 'db:orders:deleteMany',
        evidenceNodeIds: ['node-transaction-callback', 'node-tx-order-delete-many'],
      }),
    ])
  })

  it('anchors Flutter callback facts through executable ownership', () => {
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-checkout',
          repoId: 'repo-1',
          framework: 'flutter',
          kind: 'page',
          httpMethod: null,
          path: '/checkout',
          fullPath: '/checkout',
          handlerNodeId: 'node-build',
          metadata: null,
          confidence: 'high',
          filePath: 'lib/checkout_screen.dart',
          name: 'build',
        },
      ],
      graphNodes: [
        graphNode({ id: 'node-build', type: 'method', filePath: 'lib/checkout_screen.dart', name: 'build', lineStart: 20, lineEnd: 80 }),
        graphNode({ id: 'node-on-pressed', type: 'function', filePath: 'lib/checkout_screen.dart', name: 'build.$onPressed_42_21', parentNodeId: 'node-build', originKind: 'callback', role: 'onPressed' }),
        graphNode({ id: 'node-submit', type: 'method', filePath: 'lib/checkout_controller.dart', name: 'submit' }),
      ],
      graphEdges: [
        { sourceId: 'node-build', targetId: 'node-on-pressed', relation: 'contains', targetSymbol: 'onPressed', targetSpecifier: null, chainPath: null },
        { sourceId: 'node-on-pressed', targetId: 'node-submit', relation: 'calls', targetSymbol: 'submit', targetSpecifier: null, chainPath: 'controller.submit' },
      ],
      codeRelations: [
        {
          id: 'rel-api-submit',
          repoId: 'repo-1',
          sourceNodeId: 'node-submit',
          kind: 'api_call',
          target: '/api/checkout',
          operation: 'POST',
          canonicalTarget: 'api:POST:/api/checkout',
          payload: {},
          evidenceNodeIds: ['node-on-pressed', 'node-submit'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    expect(result.orphanFacts).toHaveLength(0)
    expect(result.anchoredFacts.map((fact) => `${fact.sourceEntryPointId}:${fact.relationId}`)).toEqual([
      'ep-checkout:rel-api-submit',
    ])
  })

  it('explains orphan facts when callback graph evidence is missing from reachable anchors', () => {
    const input = minimalInput({
      entryPoints: [
        {
          id: 'ep-profile',
          repoId: 'repo-1',
          framework: 'nextjs',
          kind: 'page',
          httpMethod: null,
          path: '/profile',
          fullPath: '/profile',
          handlerNodeId: 'node-profile-page',
          metadata: null,
          confidence: 'high',
          filePath: 'app/profile/page.tsx',
          name: 'ProfilePage',
        },
      ],
      codeBundles: [{ entryPointId: 'ep-profile', nodeId: 'node-profile-page', depth: 0 }],
      graphNodes: [
        graphNode({ id: 'node-profile-page', type: 'function', filePath: 'app/profile/page.tsx', name: 'ProfilePage' }),
        graphNode({ id: 'node-use-profile', type: 'function', filePath: 'app/profile/page.tsx', name: 'useMyProfile', parentNodeId: 'node-profile-page', originKind: 'function' }),
        graphNode({ id: 'node-query-fn', type: 'function', filePath: 'app/profile/page.tsx', name: 'useMyProfile.$queryFn_12_14', parentNodeId: 'node-use-profile', originKind: 'callback', role: 'queryFn' }),
      ],
      graphEdges: [
        { sourceId: 'node-profile-page', targetId: 'node-use-profile', relation: 'contains', targetSymbol: 'useMyProfile', targetSpecifier: null, chainPath: null },
      ],
      codeRelations: [
        {
          id: 'rel-api-profile',
          repoId: 'repo-1',
          sourceNodeId: 'node-query-fn',
          kind: 'api_call',
          target: '/api/me',
          operation: 'GET',
          canonicalTarget: 'api:GET:/api/me',
          payload: {},
          evidenceNodeIds: ['node-query-fn'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    expect(result.orphanFacts).toEqual([
      expect.objectContaining({
        relationId: 'rel-api-profile',
        reason: 'source_node_not_in_any_bundle',
        metadata: expect.objectContaining({
          sourceNodeOriginKind: 'callback',
          sourceNodeRole: 'queryFn',
          parentNodeId: 'node-use-profile',
          anchorFailureReason: 'callback_not_connected_to_parent',
        }),
      }),
    ])
  })

  it('explains orphan facts when the relation source node is absent from the graph', () => {
    const input = minimalInput({
      graphNodes: [
        graphNode({ id: 'node-query-fn', type: 'function', filePath: 'app/profile/page.tsx', name: 'useMyProfile.$queryFn_12_14', parentNodeId: 'node-use-profile', originKind: 'callback', role: 'queryFn' }),
      ],
      codeRelations: [
        {
          id: 'rel-missing-source',
          repoId: 'repo-1',
          sourceNodeId: 'node-get-profile',
          kind: 'api_call',
          target: '/api/me',
          operation: 'GET',
          canonicalTarget: 'api:GET:/api/me',
          payload: {},
          evidenceNodeIds: ['node-query-fn'],
          confidence: 'high',
          unresolvedReason: 'call_target_unresolved',
        },
      ],
    })

    const result = buildDeterministicFactIndex(input)

    expect(result.orphanFacts).toEqual([
      expect.objectContaining({
        relationId: 'rel-missing-source',
        metadata: expect.objectContaining({
          sourceNodeOriginKind: 'callback',
          sourceNodeRole: 'queryFn',
          parentNodeId: 'node-use-profile',
          anchorFailureReason: 'source_node_not_found',
        }),
      }),
    ])
  })
})

function minimalInput(overrides: Partial<ServiceMapInputIndex>): ServiceMapInputIndex {
  return {
    repoId: null,
    projectId: 'project-1',
    repoIds: ['repo-1'],
    entryPoints: [],
    codeBundles: [],
    graphNodes: [],
    graphEdges: [],
    codeRelations: [],
    documents: [],
    docDeps: [],
    ...overrides,
  }
}

function graphNode(
  node: ServiceMapInputIndex['graphNodes'][number] & {
    parentNodeId?: string | null
    originKind?: string | null
    role?: string | null
  },
): ServiceMapInputIndex['graphNodes'][number] {
  return node
}
