/**
 * 카테고리 G — Hono
 *
 * `const app = new Hono()` + `app.get('/x', c => c.json(...))` + middleware
 * BS-11 보강 후 정상 동작.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/server.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('G. Hono', () => {
  it('G-01: const app = new Hono(); app.get(...) — new expression alias', () => {
    const r = parse(`
      import { Hono } from 'hono'
      const app = new Hono()
      app.get('/orders', (c) => c.json([]))
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'get')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('/orders')
  })

  it('G-02: app.use(cors()) — middleware', () => {
    const r = parse(`
      import { Hono } from 'hono'
      import { cors } from 'hono/cors'
      const app = new Hono()
      app.use(cors())
    `)
    const use = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'use')
    const corsCall = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'cors')
    expect(use).toBeDefined()
    expect(corsCall).toBeDefined()
  })

  it('G-03: app.get/post/put/delete', () => {
    const r = parse(`
      import { Hono } from 'hono'
      const app = new Hono()
      app.get('/x', (c) => c.json([]))
      app.post('/x', (c) => c.json({}))
      app.put('/x/:id', (c) => c.json({}))
      app.delete('/x/:id', (c) => c.body(null))
    `)
    const methods = r.edges
      .filter((e) => e.relation === 'calls' && ['get', 'post', 'put', 'delete'].includes(e.target_symbol ?? ''))
      .map((e) => e.target_symbol)
      .sort()
    expect(methods).toEqual(['delete', 'get', 'post', 'put'])
  })

  it('G-04: chain — app.get().post().delete()', () => {
    const r = parse(`
      import { Hono } from 'hono'
      const app = new Hono()
        .get('/x', (c) => c.json([]))
        .post('/x', (c) => c.json({}))
    `)
    const get = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'get')
    const post = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'post')
    expect(get).toBeDefined()
    expect(post).toBeDefined()
  })

  it('G-05: app.route("/api", apiRoutes)', () => {
    const r = parse(`
      import { Hono } from 'hono'
      import { apiRoutes } from './api'
      const app = new Hono()
      app.route('/api', apiRoutes)
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'route')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('/api')
  })

  it('G-06: c.json({ status, data }) — 객체 인자 walk', () => {
    const r = parse(`
      import { Hono } from 'hono'
      const app = new Hono()
      app.get('/health', (c: any) => c.json({ status: 'ok', uptime: 100 }))
    `)
    // c.json은 c가 callback param이라 import-bound 아님 → calls X (V1 한계)
    // 그러나 app.get의 literal_args는 캡처됨
    const getEdge = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'get')
    expect(getEdge!.first_arg).toBe('/health')
  })

  it('G-07: zValidator middleware (Hono + zod)', () => {
    const r = parse(`
      import { Hono } from 'hono'
      import { zValidator } from '@hono/zod-validator'
      import { z } from 'zod'
      const app = new Hono()
      app.post('/u', zValidator('json', z.object({ name: z.string() })), (c) => c.json({}))
    `)
    const post = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'post')
    expect(post).toBeDefined()
    expect(post!.first_arg).toBe('/u')
    const validator = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'zValidator')
    expect(validator).toBeDefined()
    expect(validator!.first_arg).toBe('json')
  })

  it('G-08: export default app — Hono Cloudflare Workers 패턴', () => {
    const r = parse(`
      import { Hono } from 'hono'
      const app = new Hono()
      app.get('/', (c) => c.text('OK'))
      export default app
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'get')
    expect(e).toBeDefined()
  })
})
