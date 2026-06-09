/**
 * 카테고리 K — tRPC
 *
 * router({ ... }) + procedure.input(...).query(...) / .mutation(...)
 * tRPC는 chain 패턴이 핵심 — BS-10 보강 후 자연스럽게 잡힘.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/router.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('K. tRPC', () => {
  it('K-01: publicProcedure.query() — 단순 query', () => {
    const r = parse(`
      import { publicProcedure } from './trpc'
      export const list = publicProcedure.query(() => [])
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'query')
    expect(e).toBeDefined()
  })

  it('K-02: procedure.input(z.object({...})).query(...) chain', () => {
    const r = parse(`
      import { publicProcedure } from './trpc'
      import { z } from 'zod'
      export const findOne = publicProcedure
        .input(z.object({ id: z.string() }))
        .query(({ input }) => ({ id: input.id }))
    `)
    const input = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'input')
    const query = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'query')
    expect(input).toBeDefined()
    expect(query).toBeDefined()
  })

  it('K-03: mutation chain — input + mutation', () => {
    const r = parse(`
      import { publicProcedure } from './trpc'
      import { z } from 'zod'
      export const create = publicProcedure
        .input(z.object({ name: z.string() }))
        .mutation(async ({ input }) => ({ id: '1', name: input.name }))
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'mutation')
    expect(e).toBeDefined()
  })

  it('K-04: router({ list, create, ... }) — router 정의', () => {
    const r = parse(`
      import { router } from './trpc'
      import { list, create } from './procedures'
      export const userRouter = router({
        list,
        create,
      })
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'router')
    expect(e).toBeDefined()
    // 객체 인자: shorthand property → null로
    expect(e!.literal_args).toBe(JSON.stringify([{ list: null, create: null }]))
  })

  it('K-05: protectedProcedure.use(authMw).query() — middleware chain', () => {
    const r = parse(`
      import { protectedProcedure } from './trpc'
      import { authMw } from './middleware'
      export const me = protectedProcedure
        .use(authMw)
        .query(({ ctx }) => ctx.user)
    `)
    const use = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'use')
    const query = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'query')
    expect(use).toBeDefined()
    expect(query).toBeDefined()
  })

  it('K-06: nested router — router({ users: usersRouter, posts: postsRouter })', () => {
    const r = parse(`
      import { router } from './trpc'
      import { usersRouter } from './users'
      import { postsRouter } from './posts'
      export const appRouter = router({
        users: usersRouter,
        posts: postsRouter,
      })
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'router')
    expect(e).toBeDefined()
    expect(e!.literal_args).toBe(JSON.stringify([{ users: null, posts: null }]))
  })

  it('K-07: subscription — observable / yield', () => {
    const r = parse(`
      import { publicProcedure } from './trpc'
      import { observable } from '@trpc/server/observable'
      export const onUpdate = publicProcedure.subscription(() =>
        observable<string>((emit) => emit.next('hi'))
      )
    `)
    const sub = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'subscription')
    expect(sub).toBeDefined()
  })

  it('K-08: zod input + output — input(z.x).output(z.y).query(...)', () => {
    const r = parse(`
      import { publicProcedure } from './trpc'
      import { z } from 'zod'
      export const greet = publicProcedure
        .input(z.string())
        .output(z.string())
        .query(({ input }) => 'hello ' + input)
    `)
    const calls = r.edges
      .filter((e) => e.relation === 'calls')
      .map((e) => e.target_symbol)
      .sort()
    expect(calls).toContain('input')
    expect(calls).toContain('output')
    expect(calls).toContain('query')
  })
})
