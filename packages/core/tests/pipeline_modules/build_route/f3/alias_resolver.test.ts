import { describe, it, expect } from 'vitest'
import { resolveAlias } from '@/pipeline_modules/build_route/f3/alias_resolver.js'

const STD = new Set(['Get', 'Post', 'Put', 'Delete'])

describe('alias_resolver — S11~S15', () => {
  it("S11: 1-step wrapper '@ApiGet' → resolved='Get'", () => {
    const map = new Map([['ApiGet', 'Get']])
    const r = resolveAlias('ApiGet', map, STD)
    expect(r.resolved).toBe('Get')
    expect(r.chain).toEqual(['ApiGet', 'Get'])
    expect(r.cycleDetected).toBe(false)
  })

  it('S12: 3-step wrapper, depth=3 → resolved 마지막 standard', () => {
    const map = new Map([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'Get'],
    ])
    const r = resolveAlias('A', map, STD, { depth: 3 })
    expect(r.resolved).toBe('Get')
    expect(r.chain).toEqual(['A', 'B', 'C', 'Get'])
    expect(r.failedReason).toBeUndefined()
  })

  it('S13: 4-step wrapper, depth=3 → null + depth_exceeded', () => {
    const map = new Map([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'Get'],
    ])
    const r = resolveAlias('A', map, STD, { depth: 3 })
    expect(r.resolved).toBeNull()
    expect(r.failedReason).toBe('depth_exceeded')
    expect(r.chain).toEqual(['A', 'B', 'C', 'D'])
  })

  it('S14: cycle (A → B → A) → cycleDetected, failedReason=cycle', () => {
    const map = new Map([
      ['A', 'B'],
      ['B', 'A'],
    ])
    const r = resolveAlias('A', map, STD)
    expect(r.cycleDetected).toBe(true)
    expect(r.failedReason).toBe('cycle')
    expect(r.resolved).toBeNull()
    expect(r.chain).toEqual(['A', 'B', 'A'])
  })

  it('S15: external (mapping 없음, standard 도 아님) → null + external', () => {
    const map = new Map<string, string>()
    const r = resolveAlias('SomeExtDecorator', map, STD)
    expect(r.resolved).toBeNull()
    expect(r.failedReason).toBe('external')
    expect(r.chain).toEqual(['SomeExtDecorator'])
  })
})

describe('alias_resolver — 추가 가드', () => {
  it('symbol이 이미 standard → 즉시 반환', () => {
    const r = resolveAlias('Get', new Map(), STD)
    expect(r.resolved).toBe('Get')
    expect(r.chain).toEqual(['Get'])
  })

  it('default depth = 3', () => {
    const map = new Map([
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'Get'],
    ])
    const r = resolveAlias('A', map, STD)
    expect(r.resolved).toBe('Get')
  })

  it('depth=1로 제한 시 2-step wrapper → depth_exceeded', () => {
    const map = new Map([
      ['A', 'B'],
      ['B', 'Get'],
    ])
    const r = resolveAlias('A', map, STD, { depth: 1 })
    expect(r.failedReason).toBe('depth_exceeded')
  })

  it('depth 소진 후 더 풀 alias가 없으면 external', () => {
    const map = new Map([['A', 'B']])
    const r = resolveAlias('A', map, STD, { depth: 1 })
    expect(r.failedReason).toBe('external')
    expect(r.chain).toEqual(['A', 'B'])
  })

  it('self-cycle (A → A) → cycle', () => {
    const map = new Map([['A', 'A']])
    const r = resolveAlias('A', map, STD)
    expect(r.cycleDetected).toBe(true)
    expect(r.failedReason).toBe('cycle')
  })
})
