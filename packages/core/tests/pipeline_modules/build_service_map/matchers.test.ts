import { describe, it, expect } from 'vitest'
import {
  matchApiCanonicalTarget,
  matchScreenCanonicalTarget,
  matchBySuffix,
  deriveEdgeKind,
  deriveTargetNodeType,
  deriveTargetNodeId,
  entryPointKindToNodeType,
} from '@/pipeline_modules/build_service_map/matchers.js'
import type { EntryPointForServiceMap } from '@/pipeline_modules/build_service_map/types.js'

function makeEP(overrides: Partial<EntryPointForServiceMap>): EntryPointForServiceMap {
  return {
    id: 'ep-1',
    repoId: 'repo-1',
    framework: 'nestjs',
    kind: 'api',
    httpMethod: 'GET',
    path: '/test',
    fullPath: '/test',
    handlerNodeId: 'node-1',
    metadata: null,
    confidence: 'high',
    filePath: 'src/test.ts',
    name: 'test',
    ...overrides,
  }
}

const postOrders = makeEP({ id: 'ep-orders', httpMethod: 'POST', path: '/api/orders', fullPath: '/api/orders' })
const getUsers = makeEP({ id: 'ep-users', httpMethod: 'GET', path: '/api/users', fullPath: '/api/users' })
const getUsersId = makeEP({ id: 'ep-users-id', httpMethod: 'GET', path: '/api/users/:id', fullPath: '/api/users/:id' })
const checkoutPage = makeEP({ id: 'ep-checkout', kind: 'page', httpMethod: null, path: '/checkout', fullPath: '/checkout', filePath: 'apps/admin/pages/checkout.tsx' })
const profileAdminPage = makeEP({ id: 'ep-profile-admin', kind: 'page', httpMethod: null, path: '/profile', fullPath: '/profile', filePath: 'apps/admin/pages/profile.tsx' })
const profileUserPage = makeEP({ id: 'ep-profile-user', kind: 'page', httpMethod: null, path: '/profile', fullPath: '/profile', filePath: 'apps/user/pages/profile.tsx' })

describe('matchApiCanonicalTarget', () => {
  it('exact match — MAP-01', () => {
    const result = matchApiCanonicalTarget('POST /api/orders', [postOrders, getUsers])
    expect(result?.entryPoint.id).toBe('ep-orders')
    expect(result?.confidence).toBe('high')
  })

  it('path param normalization — MAP-21 A: ${userId}', () => {
    const result = matchApiCanonicalTarget('GET /api/users/${userId}', [getUsersId])
    expect(result?.entryPoint.id).toBe('ep-users-id')
  })

  it('path param normalization — MAP-21 B: [userId]', () => {
    const result = matchApiCanonicalTarget('GET /api/users/[userId]', [getUsersId])
    expect(result?.entryPoint.id).toBe('ep-users-id')
  })

  it('path param normalization — MAP-21 C: uppercase + trailing slash', () => {
    const result = matchApiCanonicalTarget('GET /Api/Users/:id/', [getUsersId])
    expect(result?.entryPoint.id).toBe('ep-users-id')
  })

  it('path param normalization — MAP-21 D: query string', () => {
    const result = matchApiCanonicalTarget('GET /api/users/{userId}?format=json', [getUsersId])
    expect(result?.entryPoint.id).toBe('ep-users-id')
  })

  it('base API prefix alias: /v2 client call matches /api/v2 backend route', () => {
    const apiV2Users = makeEP({ id: 'ep-api-v2-users', httpMethod: 'GET', path: '/api/v2/users', fullPath: '/api/v2/users' })
    const result = matchApiCanonicalTarget('GET /v2/users', [apiV2Users])

    expect(result?.entryPoint.id).toBe('ep-api-v2-users')
    expect(result?.confidence).toBe('medium')
  })

  it('exact match wins over base API prefix alias', () => {
    const v2Users = makeEP({ id: 'ep-v2-users', httpMethod: 'GET', path: '/v2/users', fullPath: '/v2/users' })
    const apiV2Users = makeEP({ id: 'ep-api-v2-users', httpMethod: 'GET', path: '/api/v2/users', fullPath: '/api/v2/users' })
    const result = matchApiCanonicalTarget('GET /v2/users', [apiV2Users, v2Users])

    expect(result?.entryPoint.id).toBe('ep-v2-users')
    expect(result?.confidence).toBe('high')
  })

  it('no match returns null', () => {
    const result = matchApiCanonicalTarget('DELETE /api/orders', [postOrders, getUsers])
    expect(result).toBeNull()
  })

  it('duplicate exact API owners return null instead of picking an arbitrary entrypoint', () => {
    const ordersA = makeEP({ id: 'ep-orders-a', repoId: 'orders-api', httpMethod: 'POST', path: '/api/orders', fullPath: '/api/orders' })
    const ordersB = makeEP({ id: 'ep-orders-b', repoId: 'billing-api', httpMethod: 'POST', path: '/api/orders', fullPath: '/api/orders' })
    const result = matchApiCanonicalTarget('POST /api/orders', [ordersA, ordersB])
    expect(result).toBeNull()
  })

  it('UNKNOWN method → path-only match, confidence=medium — MAP-22', () => {
    const result = matchApiCanonicalTarget('UNKNOWN /api/orders', [postOrders])
    expect(result?.entryPoint.id).toBe('ep-orders')
    expect(result?.confidence).toBe('medium')
  })

  it('UNKNOWN method with multiple candidates → null — MAP-N02', () => {
    const get = makeEP({ id: 'ep-get', httpMethod: 'GET', path: '/api/orders', fullPath: '/api/orders' })
    const result = matchApiCanonicalTarget('UNKNOWN /api/orders', [postOrders, get])
    expect(result).toBeNull()
  })
})

describe('matchScreenCanonicalTarget', () => {
  it('exact match screen:/checkout — MAP-08', () => {
    const result = matchScreenCanonicalTarget('screen:/checkout', [checkoutPage, profileAdminPage])
    expect(result?.entryPoint.id).toBe('ep-checkout')
  })

  it('proximity win — MAP-N03', () => {
    const result = matchScreenCanonicalTarget(
      'screen:/profile',
      [profileAdminPage, profileUserPage],
      'apps/admin/pages/checkout.tsx',
    )
    expect(result?.entryPoint.id).toBe('ep-profile-admin')
  })

  it('proximity tie → null — MAP-N02 analog', () => {
    const result = matchScreenCanonicalTarget(
      'screen:/profile',
      [profileAdminPage, profileUserPage],
      'other/page.tsx',
    )
    expect(result).toBeNull()
  })

  it('no match returns null', () => {
    const result = matchScreenCanonicalTarget('screen:/unknown', [checkoutPage])
    expect(result).toBeNull()
  })
})

describe('matchBySuffix', () => {
  it('single candidate, known method → medium — MAP-N01', () => {
    const result = matchBySuffix('/api/orders', 'POST', [postOrders])
    expect(result?.entryPoint.id).toBe('ep-orders')
    expect(result?.confidence).toBe('medium')
  })

  it('single candidate, UNKNOWN method → low — MAP-22', () => {
    const result = matchBySuffix('/api/orders', 'UNKNOWN', [postOrders])
    expect(result?.entryPoint.id).toBe('ep-orders')
    expect(result?.confidence).toBe('low')
  })

  it('no matching suffix → null', () => {
    const result = matchBySuffix('/api/unknown-route', 'POST', [postOrders])
    expect(result).toBeNull()
  })

  it('known method mismatch → null', () => {
    const getOrders = makeEP({ id: 'ep-get-orders', httpMethod: 'GET', path: '/api/orders', fullPath: '/api/orders' })
    const result = matchBySuffix('/orders', 'POST', [getOrders])
    expect(result).toBeNull()
  })

  it('multiple candidates with clear proximity winner → low — MAP-N03', () => {
    const ep1 = makeEP({ id: 'ep-a', httpMethod: 'POST', path: '/api/orders', fullPath: '/api/orders', filePath: 'apps/admin/routes/orders.ts' })
    const ep2 = makeEP({ id: 'ep-b', httpMethod: 'POST', path: '/api/orders', fullPath: '/api/orders', filePath: 'apps/user/routes/orders.ts' })
    const result = matchBySuffix('/api/orders', 'POST', [ep1, ep2], 'apps/admin/pages/checkout.tsx')
    expect(result?.entryPoint.id).toBe('ep-a')
    expect(result?.confidence).toBe('low')
  })
})

describe('deriveTargetNodeType', () => {
  it('db: → db', () => expect(deriveTargetNodeType('db:orders:insert')).toBe('db'))
  it('external_service: → external_service', () => expect(deriveTargetNodeType('external_service:stripe:v1/customers')).toBe('external_service'))
  it('external: → external_link', () => expect(deriveTargetNodeType('external:https://docs.example.com')).toBe('external_link'))
  it('screen: → screen', () => expect(deriveTargetNodeType('screen:/profile')).toBe('screen'))
  it('node_event: → event', () => expect(deriveTargetNodeType('node_event:order.created')).toBe('event'))
  it('kafka: → event', () => expect(deriveTargetNodeType('kafka:order.created')).toBe('event'))
  it('bull: → event', () => expect(deriveTargetNodeType('bull:settlement/process')).toBe('event'))
  it('METHOD /path → api', () => expect(deriveTargetNodeType('POST /api/orders')).toBe('api'))
  it('graphql: → external_service (no entrypoint)', () => expect(deriveTargetNodeType('graphql:GetUser')).toBe('external_service'))
  it('trpc: → external_service — MAP-34', () => expect(deriveTargetNodeType('trpc:user.list')).toBe('external_service'))
})

describe('deriveTargetNodeId', () => {
  it('db:orders:insert → db:orders', () => {
    expect(deriveTargetNodeId('db:orders:insert', 'db')).toBe('db:orders')
  })
  it('external_service stays same', () => {
    expect(deriveTargetNodeId('external_service:stripe:v1/customers', 'external_service')).toBe('external_service:stripe:v1/customers')
  })
  it('event stays same', () => {
    expect(deriveTargetNodeId('node_event:order.created', 'event')).toBe('node_event:order.created')
  })
})

describe('deriveEdgeKind', () => {
  it('navigation + screen → navigates', () => expect(deriveEdgeKind('navigation', 'screen')).toBe('navigates'))
  it('navigation + external_link → opens_external_link', () => expect(deriveEdgeKind('navigation', 'external_link')).toBe('opens_external_link'))
  it('api_call + api → calls_api', () => expect(deriveEdgeKind('api_call', 'api')).toBe('calls_api'))
  it('api_call + external_service → uses_external_service', () => expect(deriveEdgeKind('api_call', 'external_service')).toBe('uses_external_service'))
  it('db_access → accesses_db', () => expect(deriveEdgeKind('db_access', 'db')).toBe('accesses_db'))
  it('event_publish → publishes_event', () => expect(deriveEdgeKind('event_publish', 'event')).toBe('publishes_event'))
  it('event_listen → triggers', () => expect(deriveEdgeKind('event_listen', 'event')).toBe('triggers'))
  it('external_service → uses_external_service', () => expect(deriveEdgeKind('external_service', 'external_service')).toBe('uses_external_service'))
})

describe('entryPointKindToNodeType', () => {
  it('page → screen', () => expect(entryPointKindToNodeType('page')).toBe('screen'))
  it('api → api', () => expect(entryPointKindToNodeType('api')).toBe('api'))
  it('job → job', () => expect(entryPointKindToNodeType('job')).toBe('job'))
  it('event → event', () => expect(entryPointKindToNodeType('event')).toBe('event'))
})
