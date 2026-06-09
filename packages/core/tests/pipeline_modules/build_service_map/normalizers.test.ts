import { describe, it, expect } from 'vitest'
import {
  normalizePathParams,
  normalizePath,
  normalizeApiCanonicalTarget,
  normalizeScreenCanonicalTarget,
  countSharedPrefixSegments,
  extractDbTable,
  eventNodeId,
} from '@/pipeline_modules/build_service_map/normalizers.js'

describe('normalizePathParams', () => {
  it('${id} → :param', () => {
    expect(normalizePathParams('/users/${userId}')).toBe('/users/:param')
  })
  it('[id] → :param', () => {
    expect(normalizePathParams('/users/[userId]')).toBe('/users/:param')
  })
  it('{id} → :param', () => {
    expect(normalizePathParams('/users/{userId}')).toBe('/users/:param')
  })
  it(':id → :param', () => {
    expect(normalizePathParams('/users/:id')).toBe('/users/:param')
  })
})

describe('normalizePath', () => {
  it('trailing slash 제거', () => {
    expect(normalizePath('/api/orders/')).toBe('/api/orders')
  })
  it('query string 제거', () => {
    expect(normalizePath('/users/:id?format=json')).toBe('/users/:param')
  })
  it('uppercase → lowercase', () => {
    expect(normalizePath('/Users/Profile')).toBe('/users/profile')
  })
  it('path param + query + trailing slash 복합', () => {
    expect(normalizePath('/Users/:id/?format=json')).toBe('/users/:param')
  })
})

describe('normalizeApiCanonicalTarget — MAP-21', () => {
  it('POST /users/${userId} → POST /users/:param', () => {
    expect(normalizeApiCanonicalTarget('POST /users/${userId}')).toBe('POST /users/:param')
  })
  it('POST /users/[userId] → POST /users/:param', () => {
    expect(normalizeApiCanonicalTarget('POST /users/[userId]')).toBe('POST /users/:param')
  })
  it('POST /Users/:id/ (uppercase + trailing slash)', () => {
    expect(normalizeApiCanonicalTarget('POST /Users/:id/')).toBe('POST /users/:param')
  })
  it('POST /users/{userId}?format=json (query string)', () => {
    expect(normalizeApiCanonicalTarget('POST /users/{userId}?format=json')).toBe('POST /users/:param')
  })
})

describe('normalizeScreenCanonicalTarget', () => {
  it('screen: prefix 제거 후 정규화', () => {
    expect(normalizeScreenCanonicalTarget('screen:/Profile/')).toBe('screen:/profile')
  })
  it('prefix 없을 때도 정규화', () => {
    expect(normalizeScreenCanonicalTarget('/profile')).toBe('screen:/profile')
  })
})

describe('countSharedPrefixSegments', () => {
  it('같은 directory', () => {
    expect(countSharedPrefixSegments('apps/admin/pages/checkout.tsx', 'apps/admin/pages/profile.tsx')).toBe(3)
  })
  it('다른 app', () => {
    expect(countSharedPrefixSegments('apps/admin/pages/checkout.tsx', 'apps/user/pages/profile.tsx')).toBe(1)
  })
  it('완전히 다름', () => {
    expect(countSharedPrefixSegments('src/a/b.ts', 'other/c/d.ts')).toBe(0)
  })
})

describe('extractDbTable', () => {
  it('db:orders:insert → orders', () => {
    expect(extractDbTable('db:orders:insert')).toBe('orders')
  })
  it('db:users:select → users', () => {
    expect(extractDbTable('db:users:select')).toBe('users')
  })
})

describe('eventNodeId', () => {
  it('node_event prefix', () => {
    expect(eventNodeId('node_event:order.created')).toBe('event:node_event:order.created')
  })
  it('bull prefix', () => {
    expect(eventNodeId('bull:settlement/process')).toBe('event:bull:settlement/process')
  })
})
