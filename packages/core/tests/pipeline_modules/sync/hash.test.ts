import { describe, expect, it } from 'vitest'
import { hashValue, stableStringify } from '../../../src/pipeline_modules/sync/hash.js'

describe('sync hash helpers', () => {
  it('normalizes object keys before hashing', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}')
    expect(hashValue({ b: 2, a: 1 })).toBe(hashValue({ a: 1, b: 2 }))
  })
})
