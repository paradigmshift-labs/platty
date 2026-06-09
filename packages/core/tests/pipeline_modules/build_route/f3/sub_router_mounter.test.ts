import { describe, it, expect } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { mountSubRouters } from '@/pipeline_modules/build_route/f3/sub_router_mounter.js'

const REPO = 'r1'
let edgeId = 1

function n(partial: Partial<CodeNode> & Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name'>): CodeNode {
  return {
    repoId: REPO,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: false,
    isDefaultExport: false,
    isAsync: false,
    isTest: false,
    testType: null,
    docComment: null,
    parseStatus: 'ok',
    createdAt: '2026-05-08',
    ...partial,
  } as CodeNode
}

function e(partial: Partial<CodeEdge> & Pick<CodeEdge, 'sourceId' | 'relation'>): CodeEdge {
  return {
    id: edgeId++,
    repoId: REPO,
    targetId: null,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    resolveStatus: 'pending',
    confidence: null,
    source: 'static',
    createdAt: '2026-05-08',
    ...partial,
  } as CodeEdge
}

const literalArgs = (...args: Array<{ kind: string; value: string }>) => JSON.stringify(args)
const argExpressions = (...args: unknown[]) => args
const ident = (value: string) => ({ kind: 'identifier', value })
const str = (value: string) => ({ kind: 'string', value })

const setupNode = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })
const routerSetupNode = n({ id: 'r1:src/users.ts:setupUserRoutes', type: 'function', filePath: 'src/users.ts', name: 'setupUserRoutes' })

describe("S16: app.use('/api', userRouter) + userRouter.get('/list')", () => {
  it("userRouter 안 calls에 '/api' prefix 주입", () => {
    const mount = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs: literalArgs(str('/api'), ident('userRouter')),
    })
    const routerGet = e({
      sourceId: routerSetupNode.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'userRouter',
      firstArg: '/list',
    })
    const idx = createGraphIndex({ nodes: [setupNode, routerSetupNode], edges: [mount, routerGet] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.get('userRouter')).toBe('/api')
    expect(r.prefixByCallEdgeId.get(routerGet.id)).toBe('/api')
    expect(r.dynamicMountSources).toEqual([])
  })
})

describe('S17: 다단 mount', () => {
  it("app.use('/v1', mainRouter) → mainRouter.use('/users', userRouter) → userRouter.get('/list')", () => {
    const m1 = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/v1',
      literalArgs: literalArgs(str('/v1'), ident('mainRouter')),
    })
    const m2 = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'mainRouter',
      firstArg: '/users',
      literalArgs: literalArgs(str('/users'), ident('userRouter')),
    })
    const routerGet = e({
      sourceId: routerSetupNode.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'userRouter',
      firstArg: '/list',
    })
    const idx = createGraphIndex({ nodes: [setupNode, routerSetupNode], edges: [m1, m2, routerGet] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.get('mainRouter')).toBe('/v1')
    expect(r.mountMap.get('userRouter')).toBe('/v1/users')
    expect(r.prefixByCallEdgeId.get(routerGet.id)).toBe('/v1/users')
  })
})

describe('Fastify register mount', () => {
  it("server.register(invoiceRoutes, { prefix: '/api' }) prefixes calls inside the plugin function", () => {
    const register = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'register',
      chainPath: 'server',
      firstArg: null,
      argExpressions: argExpressions(
        { index: 0, kind: 'identifier', raw: 'invoiceRoutes', resolution: 'dynamic' },
        {
          index: 1,
          kind: 'object',
          raw: "{ prefix: '/api' }",
          properties: {
            prefix: { index: 0, kind: 'string', raw: "'/api'", value: '/api', resolution: 'static' },
          },
          resolution: 'static',
        },
      ),
    })
    const invoiceRoutesNode = n({
      id: 'r1:src/routes/invoices.ts:invoiceRoutes',
      type: 'function',
      filePath: 'src/routes/invoices.ts',
      name: 'invoiceRoutes',
    })
    const routePost = e({
      sourceId: invoiceRoutesNode.id,
      relation: 'calls',
      targetSymbol: 'post',
      chainPath: 'server',
      firstArg: '/invoices',
    })
    const idx = createGraphIndex({ nodes: [setupNode, routerSetupNode, invoiceRoutesNode], edges: [register, routePost] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.get('invoiceRoutes')).toBe('/api')
    expect(r.prefixByCallEdgeId.get(routePost.id)).toBe('/api')
    expect(r.evidenceByCallEdgeId.get(routePost.id)).toEqual({
      nodeIds: [setupNode.id],
      edgeIds: [register.id],
    })
  })
})

describe('S18: 동적 mount → suspected', () => {
  it("app.use('/api', getRouter()) — 두 번째 인자가 call expression", () => {
    const mount = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs: literalArgs(str('/api'), { kind: 'call_expression', value: 'getRouter()' }),
    })
    const idx = createGraphIndex({ nodes: [setupNode], edges: [mount] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.size).toBe(0)
    expect(r.dynamicMountSources).toEqual([setupNode.id])
  })
})

describe('S19: mount second_arg가 inline router', () => {
  it("inline object/call → dynamic 으로 처리 (suspected)", () => {
    const mount = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs: literalArgs(str('/api'), { kind: 'object', value: '{...}' }),
    })
    const idx = createGraphIndex({ nodes: [setupNode], edges: [mount] })

    const r = mountSubRouters(idx)
    expect(r.dynamicMountSources).toEqual([setupNode.id])
  })
})

describe('S20: mount 등록되었지만 prefix 사용 안 한 라우트', () => {
  it('mount만 있고 router 호출 없음 → mountMap 등록되지만 prefixByCallEdgeId 비어 있음', () => {
    const mount = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs: literalArgs(str('/api'), ident('userRouter')),
    })
    const standalone = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'app',                  // userRouter 아닌 chain
      firstArg: '/health',
    })
    const idx = createGraphIndex({ nodes: [setupNode], edges: [mount, standalone] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.get('userRouter')).toBe('/api')
    expect(r.prefixByCallEdgeId.has(standalone.id)).toBe(false)
  })
})

describe('추가 가드', () => {
  it('mount edge 없음 → 빈 결과', () => {
    const idx = createGraphIndex({ nodes: [setupNode], edges: [] })
    const r = mountSubRouters(idx)
    expect(r.mountMap.size).toBe(0)
    expect(r.prefixByCallEdgeId.size).toBe(0)
    expect(r.dynamicMountSources).toEqual([])
  })

  it('mount edge.firstArg null → 무시 (정적 mount path 아님)', () => {
    const mount = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      firstArg: null,
      literalArgs: literalArgs(ident('something'), ident('userRouter')),
    })
    const idx = createGraphIndex({ nodes: [setupNode], edges: [mount] })
    const r = mountSubRouters(idx)
    expect(r.mountMap.size).toBe(0)
  })

  it('use 호출이 아니면 mount 후보에서 제외하고 chainPath 없는 라우트 호출도 prefix 대상에서 제외', () => {
    const nonUseMount = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'get',
      firstArg: '/api',
      literalArgs: literalArgs(str('/api'), ident('userRouter')),
    })
    const chainlessCall = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: null,
      firstArg: '/list',
    })
    const idx = createGraphIndex({ nodes: [setupNode], edges: [nonUseMount, chainlessCall] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.size).toBe(0)
    expect(r.prefixByCallEdgeId.has(chainlessCall.id)).toBe(false)
  })

  it('literalArgs가 없거나 배열이 아니거나 JSON이 깨진 mount는 무시', () => {
    const missingArgs = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      firstArg: '/missing',
      literalArgs: null,
    })
    const nonArrayArgs = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      firstArg: '/object',
      literalArgs: JSON.stringify({ kind: 'object' }),
    })
    const malformedArgs = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      firstArg: '/broken',
      literalArgs: '[',
    })
    const tooShortArgs = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      firstArg: '/short',
      literalArgs: literalArgs(str('/short')),
    })
    const idx = createGraphIndex({ nodes: [setupNode], edges: [missingArgs, nonArrayArgs, malformedArgs, tooShortArgs] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.size).toBe(0)
    expect(r.dynamicMountSources).toEqual([])
  })

  it('chainPath 없는 mount는 parent prefix 없이 등록하고 같은 prefix 재등록은 변경 없음', () => {
    const first = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: null,
      firstArg: '/api',
      literalArgs: literalArgs(str('/api'), ident('userRouter')),
    })
    const duplicate = e({
      sourceId: setupNode.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: null,
      firstArg: '/api',
      literalArgs: literalArgs(str('/api'), ident('userRouter')),
    })
    const routerGet = e({
      sourceId: routerSetupNode.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'userRouter',
      firstArg: '/list',
    })
    const idx = createGraphIndex({ nodes: [setupNode, routerSetupNode], edges: [first, duplicate, routerGet] })

    const r = mountSubRouters(idx)
    expect(r.mountMap.get('userRouter')).toBe('/api')
    expect(r.prefixByCallEdgeId.get(routerGet.id)).toBe('/api')
  })
})
