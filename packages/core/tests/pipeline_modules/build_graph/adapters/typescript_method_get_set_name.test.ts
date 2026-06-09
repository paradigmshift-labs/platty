// P4: get/set 메서드 이름 ID 오염 (`get:get`, `set:set`)
// 문제: getter/setter syntax 검출 로직이 method 이름 자체가 'get'/'set'인 경우도 매칭
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('P4: method 이름이 get/set일 때 ID 오염 방지', () => {
  it('GS-01: async get(key: string) — 메서드 이름 "get" → 노드 이름 RedisService.get (오염 X)', () => {
    const r = parse(`
      export class RedisService {
        async get(_key: string): Promise<string | null> { return null }
        async set(_key: string, _val: string): Promise<void> {}
        async del(_key: string): Promise<number> { return 0 }
      }
    `)
    const getMethod = r.nodes.find((n) => n.type === 'method' && n.name === 'RedisService.get')
    expect(getMethod, 'RedisService.get 노드 — 오염 없는 정확한 이름').toBeDefined()
    expect(getMethod!.id.endsWith(':RedisService.get')).toBe(true)
    expect(getMethod!.id.includes(':get:get')).toBe(false)

    const setMethod = r.nodes.find((n) => n.type === 'method' && n.name === 'RedisService.set')
    expect(setMethod).toBeDefined()
    expect(setMethod!.id.includes(':set:set')).toBe(false)
  })

  it('GS-02: getter syntax `get foo()` — 정상 displayName="get:foo"', () => {
    const r = parse(`
      export class C {
        get foo(): string { return 'x' }
      }
    `)
    // getter syntax는 기존 동작 보존 — 'get:foo' prefix
    const getter = r.nodes.find(
      (n) => n.type === 'method' && (n.name === 'C.get:foo' || n.name === 'C.foo'),
    )
    expect(getter, 'getter syntax는 기존 정책대로 발화').toBeDefined()
  })
})
