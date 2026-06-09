/**
 * 카테고리 H — Fastify
 *
 * `const fastify = Fastify(...)` 또는 `const app = fastify(...)` + 라우트
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/server.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('H. Fastify', () => {
  it('H-01: const fastify = Fastify(); fastify.get(...)', () => {
    const r = parse(`
      import Fastify from 'fastify'
      const fastify = Fastify({ logger: true })
      fastify.get('/orders', async () => [])
    `)
    const get = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'get')
    expect(get).toBeDefined()
    expect(get!.first_arg).toBe('/orders')
  })

  it('H-02: fastify.get(path, schema, handler)', () => {
    const r = parse(`
      import Fastify from 'fastify'
      const app = Fastify()
      app.get('/users/:id', {
        schema: {
          params: { type: 'object', properties: { id: { type: 'string' } } },
          response: { 200: { type: 'object' } }
        }
      }, async (req) => ({}))
    `)
    const get = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'get')
    expect(get).toBeDefined()
    expect(get!.first_arg).toBe('/users/:id')
  })

  it('H-03: fastify.register(plugin, opts) — 플러그인', () => {
    const r = parse(`
      import Fastify from 'fastify'
      import cors from '@fastify/cors'
      const app = Fastify()
      app.register(cors, { origin: '*' })
    `)
    const reg = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'register')
    expect(reg).toBeDefined()
    expect(reg!.literal_args).toBe(JSON.stringify([null, { origin: '*' }]))
  })

  it('H-04: fastify.addHook("preHandler", auth) — lifecycle hook', () => {
    const r = parse(`
      import Fastify from 'fastify'
      import { auth } from './auth'
      const app = Fastify()
      app.addHook('preHandler', auth)
    `)
    const hook = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'addHook')
    expect(hook).toBeDefined()
    expect(hook!.first_arg).toBe('preHandler')
  })

  it('H-05: fastify.decorate("user", null) — decorate 메커니즘', () => {
    const r = parse(`
      import Fastify from 'fastify'
      const app = Fastify()
      app.decorate('authenticated', false)
      app.decorateRequest('user', null)
    `)
    const dec = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'decorate')
    const decReq = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'decorateRequest')
    expect(dec).toBeDefined()
    expect(dec!.first_arg).toBe('authenticated')
    expect(decReq).toBeDefined()
  })

  it('H-06: fastify.listen({ port: 3000 })', () => {
    const r = parse(`
      import Fastify from 'fastify'
      const app = Fastify()
      app.listen({ port: 3000, host: '0.0.0.0' })
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'listen')
    expect(e).toBeDefined()
    expect(e!.literal_args).toBe(JSON.stringify([{ port: 3000, host: '0.0.0.0' }]))
  })

  it('H-07: fastify.setErrorHandler', () => {
    const r = parse(`
      import Fastify from 'fastify'
      const app = Fastify()
      app.setErrorHandler((err, req, reply) => reply.send({ error: err.message }))
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'setErrorHandler')
    expect(e).toBeDefined()
  })

  it('H-08: route shorthand chain — 다양한 메서드 등록', () => {
    const r = parse(`
      import Fastify from 'fastify'
      const app = Fastify()
      app.get('/', () => 'home')
      app.post('/orders', () => ({}))
      app.put('/orders/:id', () => ({}))
      app.delete('/orders/:id', () => ({}))
      app.patch('/orders/:id', () => ({}))
    `)
    const methods = r.edges
      .filter((e) => e.relation === 'calls' && ['get', 'post', 'put', 'delete', 'patch'].includes(e.target_symbol ?? ''))
      .map((e) => e.target_symbol)
      .sort()
    expect(methods).toEqual(['delete', 'get', 'patch', 'post', 'put'])
  })
})
