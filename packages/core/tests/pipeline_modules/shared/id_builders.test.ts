import { describe, expect, it } from 'vitest'

import { makeDocumentId, makeEntryPointId } from '@/pipeline_modules/shared/id_builders.js'

describe('pipeline id builders', () => {
  it('builds stable opaque entry point ids from route identity fields', () => {
    expect(makeEntryPointId('repo:1', {
      framework: 'express',
      kind: 'api',
      httpMethod: 'GET',
      fullPath: '/api/orders/:id',
      path: '/orders/:id',
      handlerNodeId: 'repo:1:src/orders.ts:getOrder',
    })).toBe('repo:1:express:api:GET:/api/orders/:id:repo:1:src/orders.ts:getOrder')
  })

  it('builds document ids from project, document type, and primary entry point only', () => {
    const first = makeDocumentId('project:1', 'api_spec', 'repo:1:entry:orders')
    const second = makeDocumentId('project:1', 'api_spec', 'repo:1:entry:orders')
    const otherType = makeDocumentId('project:1', 'screen_spec', 'repo:1:entry:orders')

    expect(first).toMatch(/^doc:project:1:api_spec:[a-f0-9]{16}$/)
    expect(first).toBe(second)
    expect(first).not.toBe(otherType)
  })
})
