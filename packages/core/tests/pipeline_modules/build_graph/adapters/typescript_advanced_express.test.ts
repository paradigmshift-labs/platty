/**
 * 카테고리 F — Express
 *
 * 진입점: app.get/post/put/delete + router.use + middleware chain
 * build_route 핵심 — Express 라우트는 chain method (E8 보강 후 잡힘)
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/server.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('F. Express', () => {
  it("F-01: app.get('/orders', handler) — route 정의", () => {
    const r = parse(`
      import express from 'express'
      const app = express()
      app.get('/orders', (req, res) => res.json([]))
    `)
    // app은 const = express() 호출 결과 → 식별자 매핑은 됨
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'get')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('/orders')
  })

  it('F-02: app.post/put/patch/delete — 모든 HTTP 메서드', () => {
    const r = parse(`
      import express from 'express'
      const app = express()
      app.post('/x', () => {})
      app.put('/x/:id', () => {})
      app.patch('/x/:id', () => {})
      app.delete('/x/:id', () => {})
    `)
    const methods = r.edges
      .filter((e) => e.relation === 'calls' && ['post', 'put', 'patch', 'delete'].includes(e.target_symbol ?? ''))
      .map((e) => e.target_symbol)
      .sort()
    expect(methods).toEqual(['delete', 'patch', 'post', 'put'])
  })

  it("F-03: router.use(middleware) — middleware mount", () => {
    const r = parse(`
      import { Router } from 'express'
      import { authMiddleware } from './auth'
      const router = Router()
      router.use(authMiddleware)
      router.get('/me', (req, res) => res.json(req.user))
    `)
    const use = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'use')
    expect(use).toBeDefined()
  })

  it('F-04: app.use("/api", apiRouter) — path prefix mount', () => {
    const r = parse(`
      import express from 'express'
      import { apiRouter } from './api'
      const app = express()
      app.use('/api', apiRouter)
    `)
    const use = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'use')
    expect(use).toBeDefined()
    expect(use!.first_arg).toBe('/api')
  })

  it('F-05: middleware chain — app.get(path, mw1, mw2, handler)', () => {
    const r = parse(`
      import express from 'express'
      import { auth } from './auth'
      import { rateLimit } from './rate'
      const app = express()
      app.get('/protected', auth, rateLimit, (req, res) => res.json([]))
    `)
    const get = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'get')
    expect(get).toBeDefined()
    expect(get!.first_arg).toBe('/protected')
    // literal_args = ['/protected', null, null, null] (식별자/arrow는 null)
    expect(get!.literal_args).toBe(JSON.stringify(['/protected', null, null, null]))
  })

  it('F-06: error handler middleware — app.use((err, req, res, next) => ...)', () => {
    const r = parse(`
      import express from 'express'
      const app = express()
      app.use((err: any, req: any, res: any, next: any) => {
        res.status(500).json({ error: err.message })
      })
    `)
    const use = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'use')
    expect(use).toBeDefined()
  })

  it('F-07: router chain — Router().get().post().delete() 체이닝', () => {
    const r = parse(`
      import { Router } from 'express'
      export const userRouter = Router()
        .get('/', (req, res) => res.json([]))
        .post('/', (req, res) => res.json({}))
        .delete('/:id', (req, res) => res.sendStatus(204))
    `)
    const calls = r.edges
      .filter((e) => e.relation === 'calls')
      .map((e) => e.target_symbol)
      .sort()
    expect(calls).toContain('get')
    expect(calls).toContain('post')
    expect(calls).toContain('delete')
    expect(calls).toContain('Router')
  })

  it('F-08: app.listen(3000) — 서버 시작', () => {
    const r = parse(`
      import express from 'express'
      const app = express()
      app.listen(3000, () => console.log('ready'))
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'listen')
    expect(e).toBeDefined()
    expect(e!.literal_args).toBe(JSON.stringify([3000, null]))
  })

  it("F-09: req.body / req.params / req.query 사용 — 일반 식별자라 calls X (라우트 파라미터 추출은 spec 영역)", () => {
    const r = parse(`
      import express from 'express'
      const app = express()
      app.get('/orders/:id', (req, res) => {
        const id = req.params.id
        res.json({ id })
      })
    `)
    // req.params는 chain root가 'req' (parameter) → import-bound 아님 → calls 미생성
    // 라우트 path ':id'는 first_arg에 보존됨 (E1)
    const get = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'get')
    expect(get!.first_arg).toBe('/orders/:id')
  })

  it('F-10: app.set/app.locals/app.engine — config 호출도 calls edge', () => {
    const r = parse(`
      import express from 'express'
      const app = express()
      app.set('view engine', 'pug')
      app.locals.title = 'My App'
    `)
    const set = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'set')
    expect(set).toBeDefined()
    expect(set!.first_arg).toBe('view engine')
    expect(set!.literal_args).toBe(JSON.stringify(['view engine', 'pug']))
  })
})
