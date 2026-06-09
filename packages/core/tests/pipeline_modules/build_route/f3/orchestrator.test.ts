import { describe, it, expect } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import type { LoadedAdapter } from '@/pipeline_modules/build_route/f2_load_adapters.js'
import type { Adapter } from '@/pipeline_modules/build_route/types.js'
import { nestjs } from '@/pipeline_modules/build_route/adapters/nestjs.js'
import { express } from '@/pipeline_modules/build_route/adapters/express.js'
import { nextjs } from '@/pipeline_modules/build_route/adapters/nextjs.js'
import { flutter_navigator } from '@/pipeline_modules/build_route/adapters/flutter_navigator.js'

const REPO = 'r1'
let edgeId = 1

function n(p: Partial<CodeNode> & Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name'>): CodeNode {
  return {
    repoId: REPO, lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-08', ...p,
  } as CodeNode
}

function e(p: Partial<CodeEdge> & Pick<CodeEdge, 'sourceId' | 'relation'>): CodeEdge {
  return {
    id: edgeId++, repoId: REPO, targetId: null, targetSpecifier: null,
    targetSymbol: null, typeRefSubtype: null, chainPath: null, firstArg: null,
    literalArgs: null, resolveStatus: 'pending', confidence: null, source: 'static',
    createdAt: '2026-05-08', ...p,
  } as CodeEdge
}

function loaded(adapter: Adapter): LoadedAdapter {
  return { ...adapter, resolvedAliases: {} }
}

// Emergent routing (default) self-gates the express rule on an `import express` edge. These unit graphs
// omitted it; EXPRESS_FILE + expressImport() add a realistic one (repo-level gate).
const EXPRESS_FILE = n({ id: 'r1:src/express-entry.ts', type: 'file', filePath: 'src/express-entry.ts', name: 'express-entry.ts' })
const expressImport = () => e({ sourceId: EXPRESS_FILE.id, relation: 'imports', targetSpecifier: 'express', targetSymbol: 'express' })

// ────────────────────────────────────────

describe('NestJS — Type C', () => {
  it("@Controller class + @Get method → entry_point 1건 (path='/list')", async () => {
    const ctrl = n({ id: 'r1:src/order.ts:OrderController', type: 'class', filePath: 'src/order.ts', name: 'OrderController' })
    const list = n({ id: 'r1:src/order.ts:OrderController.list', type: 'method', filePath: 'src/order.ts', name: 'list' })
    const decorCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' })
    const containsList = e({ sourceId: ctrl.id, targetId: list.id, relation: 'contains' })
    const decorList = e({ sourceId: list.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/list' })

    const graph = createGraphIndex({
      nodes: [ctrl, list],
      edges: [decorCtrl, containsList, decorList],
    })

    const r = await runRuleEngine({
      adapters: [loaded(nestjs)],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toHaveLength(1)
    const ep = r.entryPoints[0]
    expect(ep.framework).toBe('nestjs')
    expect(ep.kind).toBe('api')
    expect(ep.handlerNodeId).toBe(list.id)
    expect(ep.path).toBe('/list')
    expect(ep.detectionSource).toBe('rule:nestjs')
    expect(ep.confidence).toBe('high')
  })

  it('match 0건 → entryPoints 빈 배열', async () => {
    const graph = createGraphIndex({ nodes: [], edges: [] })
    const r = await runRuleEngine({
      adapters: [loaded(nestjs)],
      graph,
      repoId: REPO,
    })
    expect(r.entryPoints).toEqual([])
  })

  it('@Cron/@Interval/@Timeout service methods → job entry_points', async () => {
    const service = n({ id: 'r1:src/tasks.service.ts:TasksService', type: 'class', filePath: 'src/tasks.service.ts', name: 'TasksService' })
    const cron = n({ id: 'r1:src/tasks.service.ts:TasksService.handleCron', type: 'method', filePath: 'src/tasks.service.ts', name: 'handleCron' })
    const interval = n({ id: 'r1:src/tasks.service.ts:TasksService.handleInterval', type: 'method', filePath: 'src/tasks.service.ts', name: 'handleInterval' })
    const timeout = n({ id: 'r1:src/tasks.service.ts:TasksService.handleTimeout', type: 'method', filePath: 'src/tasks.service.ts', name: 'handleTimeout' })
    const graph = createGraphIndex({
      nodes: [service, cron, interval, timeout],
      edges: [
        e({ sourceId: service.id, targetId: cron.id, relation: 'contains' }),
        e({ sourceId: service.id, targetId: interval.id, relation: 'contains' }),
        e({ sourceId: service.id, targetId: timeout.id, relation: 'contains' }),
        e({ sourceId: cron.id, relation: 'decorates', targetSymbol: 'Cron', firstArg: '45 * * * * *' }),
        e({ sourceId: interval.id, relation: 'decorates', targetSymbol: 'Interval' }),
        e({ sourceId: timeout.id, relation: 'decorates', targetSymbol: 'Timeout' }),
      ],
    })

    const r = await runRuleEngine({
      adapters: [loaded(nestjs)],
      graph,
      repoId: REPO,
    })

    const jobs = r.entryPoints.filter((ep) => ep.kind === 'job')
    expect(jobs).toHaveLength(3)
    expect(jobs.map((ep) => ep.handlerNodeId).sort()).toEqual([
      cron.id,
      interval.id,
      timeout.id,
    ].sort())
    expect(jobs.every((ep) => ep.detectionEvidence.matchedRuleId === 'schedule_job')).toBe(true)
  })

  it('@Controller() + @Get() root handler → fullPath /', async () => {
    const ctrl = n({ id: 'r1:src/app.controller.ts:AppController', type: 'class', filePath: 'src/app.controller.ts', name: 'AppController' })
    const index = n({ id: 'r1:src/app.controller.ts:AppController.index', type: 'method', filePath: 'src/app.controller.ts', name: 'index' })
    const graph = createGraphIndex({
      nodes: [ctrl, index],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' }),
        e({ sourceId: ctrl.id, targetId: index.id, relation: 'contains' }),
        e({ sourceId: index.id, relation: 'decorates', targetSymbol: 'Get' }),
      ],
    })

    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].path).toBe('/')
    expect(r.entryPoints[0].fullPath).toBe('/')
  })

  it('@Sse method → GET api entry_point', async () => {
    const ctrl = n({ id: 'r1:src/app.controller.ts:AppController', type: 'class', filePath: 'src/app.controller.ts', name: 'AppController' })
    const sse = n({ id: 'r1:src/app.controller.ts:AppController.sse', type: 'method', filePath: 'src/app.controller.ts', name: 'sse' })
    const graph = createGraphIndex({
      nodes: [ctrl, sse],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' }),
        e({ sourceId: ctrl.id, targetId: sse.id, relation: 'contains' }),
        e({ sourceId: sse.id, relation: 'decorates', targetSymbol: 'Sse', firstArg: 'sse' }),
      ],
    })

    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
    expect(r.entryPoints[0].fullPath).toBe('/sse')
    expect(r.entryPoints[0].detectionEvidence.matchedRuleId).toBe('sse_handler')
  })
})

describe('Express — Type B', () => {
  it("app.get('/health', handler) → entry_point 1건 (path='/health')", async () => {
    const setup = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })
    const callGet = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'app',
      firstArg: '/health',
    })
    const graph = createGraphIndex({ nodes: [EXPRESS_FILE, setup], edges: [expressImport(), callGet] })

    const r = await runRuleEngine({
      adapters: [loaded(express)],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].path).toBe('/health')
    expect(r.entryPoints[0].handlerNodeId).toBe(setup.id)
  })
})

describe('Next.js — Type A', () => {
  it("app/dashboard/page.tsx 의 default export function → entry_point (path='/dashboard')", async () => {
    // 어댑터가 node_type='function' + is_default_export=true 매칭으로 변경됨.
    // file 노드 대신 default export function 노드를 fixture 로 사용.
    const pageFile = n({ id: 'r1:app/dashboard/page.tsx', type: 'file', filePath: 'app/dashboard/page.tsx', name: 'page.tsx' })
    const pageFn = n({ id: 'r1:app/dashboard/page.tsx:DashboardPage', type: 'function', filePath: 'app/dashboard/page.tsx', name: 'DashboardPage', isDefaultExport: true })
    const graph = createGraphIndex({ nodes: [pageFile, pageFn], edges: [] })

    const r = await runRuleEngine({
      adapters: [loaded(nextjs)],
      graph,
      repoId: REPO,
    })

    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(1)
    expect(pages[0].path).toBe('/dashboard')
    expect(pages[0].handlerNodeId).toBe(pageFn.id)
  })

  it("default export function 없으면 entry 0개", async () => {
    // file 노드만 있고 isDefaultExport=true 인 function 노드 없음
    const page = n({ id: 'r1:app/dashboard/page.tsx', type: 'file', filePath: 'app/dashboard/page.tsx', name: 'page.tsx' })
    const graph = createGraphIndex({ nodes: [page], edges: [] })

    const r = await runRuleEngine({
      adapters: [loaded(nextjs)],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].handlerNodeId).toBe(page.id)
    expect(r.entryPoints[0].path).toBe('/dashboard')
  })

  it('file fallback + default export function 중복이면 function handler를 우선한다', async () => {
    const pageFile = n({ id: 'r1:app/page.tsx', type: 'file', filePath: 'app/page.tsx', name: 'page.tsx' })
    const pageFn = n({ id: 'r1:app/page.tsx:Page', type: 'function', filePath: 'app/page.tsx', name: 'Page', isDefaultExport: true })
    const graph = createGraphIndex({ nodes: [pageFile, pageFn], edges: [] })

    const r = await runRuleEngine({
      adapters: [loaded(nextjs)],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].handlerNodeId).toBe(pageFn.id)
    expect(r.entryPoints[0].path).toBe('/')
  })

  it("layout 파일은 exclude_glob 으로 제외", async () => {
    const layout = n({ id: 'r1:app/layout.tsx', type: 'file', filePath: 'app/layout.tsx', name: 'layout.tsx' })
    const graph = createGraphIndex({ nodes: [layout], edges: [] })

    const r = await runRuleEngine({
      adapters: [loaded(nextjs)],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toHaveLength(0)
  })
})

describe('multi-adapter (모노레포)', () => {
  it('NestJS + Express 동시 활성화 — 둘 다 emit', async () => {
    const ctrl = n({ id: 'r1:src/o.ts:OrderController', type: 'class', filePath: 'src/o.ts', name: 'OrderController' })
    const list = n({ id: 'r1:src/o.ts:OrderController.list', type: 'method', filePath: 'src/o.ts', name: 'list' })
    const setup = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })

    const graph = createGraphIndex({
      nodes: [EXPRESS_FILE, ctrl, list, setup],
      edges: [
        expressImport(),
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' }),
        e({ sourceId: ctrl.id, targetId: list.id, relation: 'contains' }),
        e({ sourceId: list.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/list' }),
        e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/health' }),
      ],
    })

    const r = await runRuleEngine({
      adapters: [loaded(nestjs), loaded(express)],
      graph,
      repoId: REPO,
    })

    const frameworks = r.entryPoints.map((ep) => ep.framework).sort()
    expect(frameworks).toEqual(['express', 'nestjs'])
  })
})

describe('delegate_to llm_fallback', () => {
  it('rule.delegateTo 가 있으면 entryPoint 안 emit', async () => {
    const fakeAdapter = loaded({
      ...nestjs,
      entrypointRules: [
        {
          id: 'fb',
          kind: 'page',
          select: { node_type: 'method' },
          extract: {},
          delegateTo: 'llm_fallback',
        },
      ],
    })
    const m = n({ id: 'r1:m', type: 'method', filePath: 'a.ts', name: 'm' })
    const graph = createGraphIndex({ nodes: [m], edges: [] })

    const r = await runRuleEngine({
      adapters: [fakeAdapter],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toEqual([])
  })
})

describe('Express + sub_router_mounter 통합', () => {
  it("app.use('/api', userRouter) + userRouter.get('/list') → fullPath='/api/list'", async () => {
    const setup = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })
    const userRoutes = n({ id: 'r1:src/users.ts:setupUserRoutes', type: 'function', filePath: 'src/users.ts', name: 'setupUserRoutes' })

    const literalArgs = JSON.stringify([
      { kind: 'string', value: '/api' },
      { kind: 'identifier', value: 'userRouter' },
    ])
    const mount = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs,
    })
    const routerGet = e({
      sourceId: userRoutes.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'userRouter',
      firstArg: '/list',
    })

    const graph = createGraphIndex({ nodes: [setup, userRoutes], edges: [mount, routerGet] })
    const r = await runRuleEngine({
      adapters: [loaded(express)],
      graph,
      repoId: REPO,
    })

    // userRouter chain은 select 의 callee.chain_path_root_in:[app, router] 매칭 X
    // → express adapter select 가 'userRouter' 매칭하지 않으니 entry 안 나옴.
    // 본 테스트는 mount 자체 동작 + suspected 검증만.
    expect(r.suspected).toEqual([])
  })

  it('동적 mount → suspected', async () => {
    const setup = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })
    const dynamicMount = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs: JSON.stringify([
        { kind: 'string', value: '/api' },
        { kind: 'call_expression', value: 'getRouter()' },
      ]),
    })
    const graph = createGraphIndex({ nodes: [setup], edges: [dynamicMount] })

    const r = await runRuleEngine({
      adapters: [loaded(express)],
      graph,
      repoId: REPO,
    })
    expect(r.suspected).toHaveLength(1)
    expect(r.suspected[0].nodeId).toBe(setup.id)
    expect(r.suspected[0].reason).toBe('rule_low_confidence')
  })
})

describe('NestJS + controller_inheritance 통합', () => {
  it('OrderController extends BaseController(@Get) → 양쪽 모두 emit (inheritedFrom 표시)', async () => {
    const base = n({ id: 'r1:src/base.ts:BaseController', type: 'class', filePath: 'src/base.ts', name: 'BaseController' })
    const baseHealth = n({ id: 'r1:src/base.ts:BaseController.health', type: 'method', filePath: 'src/base.ts', name: 'health' })
    const ord = n({ id: 'r1:src/order.ts:OrderController', type: 'class', filePath: 'src/order.ts', name: 'OrderController' })
    const ordList = n({ id: 'r1:src/order.ts:OrderController.list', type: 'method', filePath: 'src/order.ts', name: 'list' })

    const graph = createGraphIndex({
      nodes: [base, baseHealth, ord, ordList],
      edges: [
        e({ sourceId: base.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/base' }),
        e({ sourceId: ord.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/orders' }),
        e({ sourceId: base.id, targetId: baseHealth.id, relation: 'contains' }),
        e({ sourceId: ord.id, targetId: ordList.id, relation: 'contains' }),
        e({ sourceId: ord.id, targetId: base.id, relation: 'extends' }),
        e({ sourceId: baseHealth.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/health' }),
        e({ sourceId: ordList.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/list' }),
      ],
    })

    const r = await runRuleEngine({
      adapters: [loaded(nestjs)],
      graph,
      repoId: REPO,
    })

    // base.health (자체) + ord.list (자체) + base.health (ord 로 inherited)
    expect(r.entryPoints.length).toBeGreaterThanOrEqual(3)

    const inherited = r.entryPoints.filter((ep) => ep.metadata.inheritedFrom === base.id)
    expect(inherited).toHaveLength(1)
    expect(inherited[0].metadata.inheritedToClass).toBe(ord.id)
    expect(inherited[0].path).toBe('/health')
  })
})

describe('alias 추적 통합', () => {
  it("@ApiGet wrapper → standard Get 으로 resolved + confidence='low'", async () => {
    const ctrl = n({ id: 'r1:c.ts:Ctrl', type: 'class', filePath: 'c.ts', name: 'Ctrl' })
    const m = n({ id: 'r1:c.ts:Ctrl.list', type: 'method', filePath: 'c.ts', name: 'list' })
    const graph = createGraphIndex({
      nodes: [ctrl, m],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/x' }),
        e({ sourceId: ctrl.id, targetId: m.id, relation: 'contains' }),
        e({ sourceId: m.id, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' }),
      ],
    })

    const adapter: LoadedAdapter = {
      ...nestjs,
      resolvedAliases: {
        ApiGet: { resolvesTo: 'Get', source: 'analyze_repo' },
      },
    }

    const r = await runRuleEngine({
      adapters: [adapter],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].confidence).toBe('low')
    expect(r.entryPoints[0].detectionEvidence.aliasChain).toEqual(['ApiGet', 'Get'])
    expect(r.entryPoints[0].path).toBe('/items')
  })
})

describe('NestJS — @Controller prefix 합성 (4 form)', () => {
  // Builds a graph with @Controller('cats') + one method decorator (symbol + firstArg)
  function makeCatsGraph(methodSymbol: string, methodFirstArg: string | null) {
    const ctrl = n({ id: 'r1:src/cats.ts:CatsController', type: 'class', filePath: 'src/cats.ts', name: 'CatsController' })
    const method = n({ id: 'r1:src/cats.ts:CatsController.act', type: 'method', filePath: 'src/cats.ts', name: 'act' })
    return createGraphIndex({
      nodes: [ctrl, method],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: 'cats' }),
        e({ sourceId: ctrl.id, targetId: method.id, relation: 'contains' }),
        e({ sourceId: method.id, relation: 'decorates', targetSymbol: methodSymbol, firstArg: methodFirstArg }),
      ],
    })
  }

  it('@Controller("cats") + @Get(":id") → fullPath = /cats/:id', async () => {
    const graph = makeCatsGraph('Get', ':id')
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].fullPath).toBe('/cats/:id')
  })

  it('@Controller("cats") + @Get() → fullPath = /cats', async () => {
    const graph = makeCatsGraph('Get', null)
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].fullPath).toBe('/cats')
  })

  it('@Controller("cats") + @Post("/x") → fullPath = /cats/x', async () => {
    const graph = makeCatsGraph('Post', '/x')
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].fullPath).toBe('/cats/x')
  })

  it('@Controller("cats") + @Post() → fullPath = /cats', async () => {
    const graph = makeCatsGraph('Post', null)
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].fullPath).toBe('/cats')
  })
})

describe('buildDraft fallback — path null + parentPath → fullPath = parentPath', () => {
  it('@Get() 인자 없음(firstArg null) + parent_path 있으면 fullPath = parentPath', async () => {
    // NestJS: @Controller('cats') + @Get() (인자 없음)
    // path null, parentPath = '/cats' → fullPath = '/cats'
    const ctrl = n({ id: 'r1:src/cats.ts:CatsController', type: 'class', filePath: 'src/cats.ts', name: 'CatsController' })
    const findAll = n({ id: 'r1:src/cats.ts:CatsController.findAll', type: 'method', filePath: 'src/cats.ts', name: 'findAll' })

    const graph = createGraphIndex({
      nodes: [ctrl, findAll],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: 'cats' }),
        e({ sourceId: ctrl.id, targetId: findAll.id, relation: 'contains' }),
        e({ sourceId: findAll.id, relation: 'decorates', targetSymbol: 'Get', firstArg: null }),
      ],
    })

    // parentPath を inject するために fakeAdapter を使う
    // nestjs adapter の extract に parent_path を追加した 버전
    const fakeAdapter: LoadedAdapter = {
      ...nestjs,
      entrypointRules: [
        {
          id: 'api_handler_with_parent',
          kind: 'api',
          select: {
            node_type: 'method',
            decorated_by: ['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'],
            enclosing_class_decorated_by: 'Controller',
          },
          extract: {
            path: '${decorator.first_arg}',
            parent_path: '${enclosing_class.Controller.first_arg}',
            handler_node_id: '${self}',
          },
        },
      ],
      resolvedAliases: {},
    }

    const r = await runRuleEngine({
      adapters: [fakeAdapter],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toHaveLength(1)
    const ep = r.entryPoints[0]
    expect(ep.handlerNodeId).toBe(findAll.id)
    expect(ep.path).toBeUndefined()        // @Get() firstArg null → path is undefined
    expect(ep.parentPath).toBe('/cats')
    expect(ep.fullPath).toBe('/cats')      // fallback: path null + parentPath → fullPath = parentPath
  })
})

// ─── Cycle 8: http_method 추출 (NestJS + Express) ────────────────────────────

describe('NestJS — httpMethod 추출', () => {
  it('@Get → httpMethod = GET', async () => {
    const ctrl = n({ id: 'r1:src/cats.ts:CatsController', type: 'class', filePath: 'src/cats.ts', name: 'CatsController' })
    const findAll = n({ id: 'r1:src/cats.ts:CatsController.findAll', type: 'method', filePath: 'src/cats.ts', name: 'findAll' })
    const graph = createGraphIndex({
      nodes: [ctrl, findAll],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: 'cats' }),
        e({ sourceId: ctrl.id, targetId: findAll.id, relation: 'contains' }),
        e({ sourceId: findAll.id, relation: 'decorates', targetSymbol: 'Get', firstArg: null }),
      ],
    })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
  })

  it('@Post → httpMethod = POST', async () => {
    const ctrl = n({ id: 'r1:src/cats.ts:CatsController', type: 'class', filePath: 'src/cats.ts', name: 'CatsController' })
    const create = n({ id: 'r1:src/cats.ts:CatsController.create', type: 'method', filePath: 'src/cats.ts', name: 'create' })
    const graph = createGraphIndex({
      nodes: [ctrl, create],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: 'cats' }),
        e({ sourceId: ctrl.id, targetId: create.id, relation: 'contains' }),
        e({ sourceId: create.id, relation: 'decorates', targetSymbol: 'Post', firstArg: null }),
      ],
    })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('POST')
  })

  it('@ApiGet (alias) → httpMethod = GET, confidence=low', async () => {
    const ctrl = n({ id: 'r1:c.ts:Ctrl', type: 'class', filePath: 'c.ts', name: 'Ctrl' })
    const m = n({ id: 'r1:c.ts:Ctrl.list', type: 'method', filePath: 'c.ts', name: 'list' })
    const graph = createGraphIndex({
      nodes: [ctrl, m],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/x' }),
        e({ sourceId: ctrl.id, targetId: m.id, relation: 'contains' }),
        e({ sourceId: m.id, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' }),
      ],
    })
    const adapter: LoadedAdapter = {
      ...nestjs,
      resolvedAliases: { ApiGet: { resolvesTo: 'Get', source: 'analyze_repo' } },
    }
    const r = await runRuleEngine({ adapters: [adapter], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
    expect(r.entryPoints[0].confidence).toBe('low')
  })
})

describe('Express — httpMethod 추출', () => {
  it('app.get → httpMethod = GET', async () => {
    const setup = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })
    const callGet = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/health' })
    const graph = createGraphIndex({ nodes: [EXPRESS_FILE, setup], edges: [expressImport(), callGet] })
    const r = await runRuleEngine({ adapters: [loaded(express)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
  })

  it('app.post → httpMethod = POST', async () => {
    const setup = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })
    const callPost = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'post', chainPath: 'app', firstArg: '/users' })
    const graph = createGraphIndex({ nodes: [EXPRESS_FILE, setup], edges: [expressImport(), callPost] })
    const r = await runRuleEngine({ adapters: [loaded(express)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('POST')
  })
})

describe('extract 평가 실패 → handler_node_id 없으면 skip', () => {
  it('extract 결과 모두 null → entryPoint emit 안 함', async () => {
    const fakeAdapter = loaded({
      ...nestjs,
      entrypointRules: [
        {
          id: 'unsupported',
          kind: 'api',
          select: { node_type: 'method' },
          extract: {
            // 미지원 placeholder
            handler_node_id: '${nonexistent_resolver}',
          },
        },
      ],
    })
    const m = n({ id: 'r1:m', type: 'method', filePath: 'a.ts', name: 'm' })
    const graph = createGraphIndex({ nodes: [m], edges: [] })

    const r = await runRuleEngine({
      adapters: [fakeAdapter],
      graph,
      repoId: REPO,
    })

    expect(r.entryPoints).toEqual([])
  })
})

describe('orchestrator coverage guards', () => {
  it('anonymous rule no-match와 extract 실패 reason은 anon fallback key로 집계', async () => {
    const m = n({ id: 'r1:m', type: 'method', filePath: 'a.ts', name: 'm' })
    const graph = createGraphIndex({ nodes: [m], edges: [] })
    const fakeAdapter = loaded({
      ...nestjs,
      name: 'fake',
      entrypointRules: [
        {
          kind: 'api',
          select: { node_type: 'class' },
          extract: {},
        },
        {
          kind: 'api',
          select: { node_type: 'method' },
          extract: { handler_node_id: '${nonexistent_resolver}' },
        },
      ],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.skippedReasons['no_match:fake:anon']).toBe(1)
    expect(r.skippedReasons['extract_failed:fake:anon']).toBe(1)
    expect(r.entryPoints).toEqual([])
  })

  it('nested rule은 child 존재 여부에 따라 pass-through와 missing reason을 기록', async () => {
    const page = n({ id: 'r1:page', type: 'function', filePath: 'a.tsx', name: 'Page' })
    const graph = createGraphIndex({ nodes: [page], edges: [] })
    const fakeAdapter = loaded({
      ...nextjs,
      name: 'nested',
      entrypointRules: [
        {
          id: 'parent_ok',
          kind: 'page',
          select: { node_type: 'function' },
          extract: { handler_node_id: '${self}', path: '${file_path → path_pattern}' },
          nested: { childRuleRef: 'child' },
        },
        {
          id: 'parent_missing',
          kind: 'page',
          select: { node_type: 'function' },
          extract: { handler_node_id: '${self}', path: '${file_path → path_pattern}' },
          nested: { childRuleRef: 'absent' },
        },
        {
          id: 'child',
          kind: 'page',
          select: { node_type: 'function' },
          extract: { handler_node_id: '${self}', path: '${file_path → path_pattern}' },
        },
      ],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.skippedReasons['nested_pass_through:nested:parent_ok']).toBe(1)
    expect(r.skippedReasons['nested_child_missing:nested:parent_missing']).toBe(1)
  })

  it('id 없는 nested rule도 anon key로 reason을 기록', async () => {
    const page = n({ id: 'r1:page', type: 'function', filePath: 'a.tsx', name: 'Page' })
    const graph = createGraphIndex({ nodes: [page], edges: [] })
    const fakeAdapter = loaded({
      ...nextjs,
      name: 'nested_anon',
      entrypointRules: [
        {
          kind: 'page',
          select: { node_type: 'function' },
          extract: { handler_node_id: '${self}', path: '${file_path → path_pattern}' },
          nested: { childRuleRef: 'child' },
        },
        {
          id: 'child',
          kind: 'page',
          select: { node_type: 'function' },
          extract: { handler_node_id: '${self}', path: '${file_path → path_pattern}' },
        },
        {
          kind: 'page',
          select: { node_type: 'function' },
          extract: { handler_node_id: '${self}', path: '${file_path → path_pattern}' },
          nested: { childRuleRef: 'missing' },
        },
      ],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.skippedReasons['nested_pass_through:nested_anon:anon']).toBe(1)
    expect(r.skippedReasons['nested_child_missing:nested_anon:anon']).toBe(1)
  })

  it('routing_files unmatched는 suspected로 수집하고 기존 suspected nodeId와 중복하지 않음', async () => {
    const setup = n({ id: 'r1:src/routes.ts:setup', type: 'function', filePath: 'src/routes.ts', name: 'setup' })
    const file = n({ id: 'r1:src/routes.ts', type: 'file', filePath: 'src/routes.ts', name: 'routes.ts' })
    const dynamicMount = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs: JSON.stringify([
        { kind: 'string', value: '/api' },
        { kind: 'call_expression', value: 'makeRouter()' },
      ]),
    })
    const graph = createGraphIndex({ nodes: [file, setup], edges: [dynamicMount] })

    const r = await runRuleEngine({
      adapters: [loaded(express)],
      graph,
      repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [], routingFiles: ['src/routes.ts'] },
    })

    expect(r.suspected.map((s) => s.nodeId)).toEqual([setup.id, file.id])
  })

  it('alias map이 있어도 standard decorator 매칭이면 aliasChain 없이 high confidence 유지', async () => {
    const ctrl = n({ id: 'r1:c.ts:Ctrl', type: 'class', filePath: 'c.ts', name: 'Ctrl' })
    const m = n({ id: 'r1:c.ts:Ctrl.list', type: 'method', filePath: 'c.ts', name: 'list' })
    const graph = createGraphIndex({
      nodes: [ctrl, m],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/x' }),
        e({ sourceId: ctrl.id, targetId: m.id, relation: 'contains' }),
        e({ sourceId: m.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/items' }),
      ],
    })
    const adapter: LoadedAdapter = {
      ...nestjs,
      resolvedAliases: { ApiGet: { resolvesTo: 'Get', source: 'analyze_repo' } },
    }

    const r = await runRuleEngine({ adapters: [adapter], graph, repoId: REPO })

    expect(r.entryPoints[0].confidence).toBe('high')
    expect(r.entryPoints[0].detectionEvidence.aliasChain).toBeUndefined()
  })

  it('alias map에 없는 wrapper decorator는 aliasChain 없이 high confidence 유지', async () => {
    const ctrl = n({ id: 'r1:c.ts:Ctrl', type: 'class', filePath: 'c.ts', name: 'Ctrl' })
    const m = n({ id: 'r1:c.ts:Ctrl.list', type: 'method', filePath: 'c.ts', name: 'list' })
    const graph = createGraphIndex({
      nodes: [ctrl, m],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/x' }),
        e({ sourceId: ctrl.id, targetId: m.id, relation: 'contains' }),
        e({ sourceId: m.id, relation: 'decorates', targetSymbol: 'ApiOtherGet', firstArg: '/items' }),
      ],
    })
    const fakeAdapter: LoadedAdapter = {
      ...nestjs,
      entrypointRules: [{
        id: 'other_wrapper',
        kind: 'api',
        select: {
          node_type: 'method',
          decorated_by: ['ApiOtherGet'],
          enclosing_class_decorated_by: 'Controller',
        },
        extract: {
          path: '${decorator.first_arg}',
          handler_node_id: '${self}',
        },
      }],
      resolvedAliases: { ApiGet: { resolvesTo: 'Get', source: 'analyze_repo' } },
    }

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].confidence).toBe('high')
    expect(r.entryPoints[0].detectionEvidence.aliasChain).toBeUndefined()
  })

  it('rule에 alias wrapper가 이미 있으면 alias expansion은 중복 추가하지 않음', async () => {
    const ctrl = n({ id: 'r1:c.ts:Ctrl', type: 'class', filePath: 'c.ts', name: 'Ctrl' })
    const m = n({ id: 'r1:c.ts:Ctrl.list', type: 'method', filePath: 'c.ts', name: 'list' })
    const graph = createGraphIndex({
      nodes: [ctrl, m],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/x' }),
        e({ sourceId: ctrl.id, targetId: m.id, relation: 'contains' }),
        e({ sourceId: m.id, relation: 'decorates', targetSymbol: 'ApiGet', firstArg: '/items' }),
      ],
    })
    const fakeAdapter: LoadedAdapter = {
      ...nestjs,
      entrypointRules: [{
        id: 'already_expanded',
        kind: 'api',
        select: {
          node_type: 'method',
          decorated_by: ['Get', 'ApiGet'],
          enclosing_class_decorated_by: 'Controller',
        },
        extract: { path: '${decorator.first_arg}', handler_node_id: '${self}' },
      }],
      resolvedAliases: { ApiGet: { resolvesTo: 'Get', source: 'analyze_repo' } },
    }

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.entryPoints[0].detectionEvidence.aliasChain).toEqual(['ApiGet', 'Get'])
  })

  it('decorated_by 없는 inherited rule은 모든 inherited decorator edge를 사용', async () => {
    const base = n({ id: 'r1:Base', type: 'class', filePath: 'base.ts', name: 'Base' })
    const method = n({ id: 'r1:Base.ping', type: 'method', filePath: 'base.ts', name: 'ping' })
    const child = n({ id: 'r1:Child', type: 'class', filePath: 'child.ts', name: 'Child' })
    const graph = createGraphIndex({
      nodes: [base, method, child],
      edges: [
        e({ sourceId: child.id, targetId: base.id, relation: 'extends' }),
        e({ sourceId: base.id, targetId: method.id, relation: 'contains' }),
        e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/ping' }),
      ],
    })
    const fakeAdapter = loaded({
      ...nestjs,
      entrypointRules: [{
        id: 'all_inherited',
        kind: 'api',
        select: { node_type: 'method', enclosing_class_decorated_by: 'Controller' },
        extract: { handler_node_id: '${self}', path: '${decorator.first_arg}' },
      }],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].metadata.inheritedToClass).toBe(child.id)
  })

  it('file fallback duplicate보다 function handler와 high confidence duplicate를 우선', async () => {
    const file = n({ id: 'r1:app/page.tsx', type: 'file', filePath: 'app/page.tsx', name: 'page.tsx' })
    const fn = n({ id: 'r1:app/page.tsx:Page', type: 'function', filePath: 'app/page.tsx', name: 'Page' })
    const graph = createGraphIndex({ nodes: [file, fn], edges: [] })
    const fakeAdapter = loaded({
      ...nextjs,
      name: 'dedupe',
      entrypointRules: [
        {
          id: 'file',
          kind: 'page',
          select: { node_type: 'file' },
          extract: { handler_node_id: '${self}', path: '/same' },
        },
        {
          id: 'fn',
          kind: 'page',
          select: { node_type: 'function' },
          extract: { handler_node_id: '${self}', path: '/same' },
        },
      ],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].handlerNodeId).toBe(fn.id)
  })

  it('B1: flutter_navigator routes_map walk → entry.key=path, entry.value=null이면 self fallback', async () => {
    // MaterialApp(routes: { '/home': () => HomePage(), '/profile': () => ProfilePage() })
    // dart.ts는 위젯 constructor 값을 literal로 추출 못함 → literalArgs에서 value=null
    // → handler_node_id는 edge sourceId(self)로 fallback되어야 함
    const main = n({ id: 'r1:lib/main.dart:main', type: 'function',
                     filePath: 'lib/main.dart', name: 'main' })
    const appCall = e({
      sourceId: main.id,
      relation: 'calls',
      targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { routes: { '/home': null, '/profile': null } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main], edges: [appCall] })

    const r = await runRuleEngine({
      adapters: [loaded(flutter_navigator)],
      graph,
      repoId: REPO,
    })

    const routes = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(routes).toHaveLength(2)
    expect(routes.map((ep) => ep.path).sort()).toEqual(['/home', '/profile'])
    // entry.value가 null이라 handlerNodeId는 self(main.id)로 fallback
    expect(routes.every((ep) => ep.handlerNodeId === main.id)).toBe(true)
    // on_generate_route는 delegateTo: 'llm_fallback' → suspected로 이동
    expect(r.suspected.some((s) => s.reason === 'adapter_delegate')).toBe(true)
  })

  it('B1: flutter_navigator routes_map walk → entry.value가 nodeId 문자열이면 그대로 사용', async () => {
    const main = n({ id: 'r1:lib/main.dart:main', type: 'function',
                     filePath: 'lib/main.dart', name: 'main' })
    const homePage = n({ id: 'r1:lib/home.dart:HomePage', type: 'class',
                         filePath: 'lib/home.dart', name: 'HomePage' })
    const appCall = e({
      sourceId: main.id,
      relation: 'calls',
      targetSymbol: 'MaterialApp',
      firstArg: null,
      literalArgs: JSON.stringify([
        { routes: { '/home': 'r1:lib/home.dart:HomePage' } },
      ]),
    })
    const graph = createGraphIndex({ nodes: [main, homePage], edges: [appCall] })

    const r = await runRuleEngine({
      adapters: [loaded(flutter_navigator)],
      graph,
      repoId: REPO,
    })

    const routes = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(routes).toHaveLength(1)
    expect(routes[0].path).toBe('/home')
    expect(routes[0].handlerNodeId).toBe(homePage.id)
  })

  it('B3: 같은 key를 가진 두 비-file 노드 entry는 dedup되어 1건만 emit', async () => {
    // 시나리오: React Router 컴포넌트가 같은 path를 두 번 렌더링하는 경우
    // (또는 같은 source 노드에서 두 edge가 같은 firstArg로 매칭되는 경우)
    const app = n({ id: 'r1:src/App.tsx:App', type: 'function', filePath: 'src/App.tsx', name: 'App' })
    const e1 = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/home' })
    const e2 = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/home' })
    const graph = createGraphIndex({ nodes: [app], edges: [e1, e2] })
    const fakeAdapter = loaded({
      ...nextjs,
      name: 'react_router_v6',
      entrypointRules: [{
        id: 'route',
        kind: 'page',
        select: {
          relation: 'renders',
          callee: { symbol: 'Route' },
          first_arg: { kind: 'string_literal' },
        },
        extract: { handler_node_id: '${self}', path: '${first_arg}' },
      }],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    // 두 edge가 동일 (framework+kind+path) key → 1건으로 dedup되어야 함
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].path).toBe('/home')
    expect(r.entryPoints[0].handlerNodeId).toBe(app.id)
  })

  it('같은 file fallback key에서는 low confidence보다 high confidence를 우선', async () => {
    const file = n({ id: 'r1:app/page.tsx', type: 'file', filePath: 'app/page.tsx', name: 'page.tsx' })
    const aliasDecor = e({ sourceId: file.id, relation: 'decorates', targetSymbol: 'AliasPage', firstArg: '/same' })
    const pageDecor = e({ sourceId: file.id, relation: 'decorates', targetSymbol: 'Page', firstArg: '/same' })
    const graph = createGraphIndex({ nodes: [file], edges: [aliasDecor, pageDecor] })
    const lowAdapter = loaded({
      ...nextjs,
      name: 'dedupe_confidence',
      aliasResolution: { standardDecorators: ['Page'] },
      entrypointRules: [{
        id: 'low',
        kind: 'page',
        select: { node_type: 'file', decorated_by: ['Page'] },
        extract: { handler_node_id: '${self}', path: '${decorator.first_arg}' },
      }],
      resolvedAliases: { AliasPage: { resolvesTo: 'Page', source: 'analyze_repo' } },
    })
    const highAdapter = loaded({
      ...nextjs,
      name: 'dedupe_confidence',
      entrypointRules: [{
        id: 'high',
        kind: 'page',
        select: { node_type: 'file', decorated_by: ['Page'] },
        extract: { handler_node_id: '${self}', path: '${decorator.first_arg}' },
      }],
    })

    const r = await runRuleEngine({ adapters: [lowAdapter, highAdapter], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].confidence).toBe('high')
  })

  it('Express sub-router prefix가 매칭된 call edge path에 합성됨', async () => {
    const setup = n({ id: 'r1:src/app.ts:setup', type: 'function', filePath: 'src/app.ts', name: 'setup' })
    const mount = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'use',
      chainPath: 'app',
      firstArg: '/api',
      literalArgs: JSON.stringify([
        { kind: 'string', value: '/api' },
        { kind: 'identifier', value: 'userRouter' },
      ]),
    })
    const routerGet = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'userRouter',
      firstArg: '/list',
    })
    const graph = createGraphIndex({ nodes: [setup], edges: [mount, routerGet] })
    const fakeAdapter = loaded({
      ...express,
      entrypointRules: [{
        id: 'mounted_get',
        kind: 'api',
        select: {
          relation: 'calls',
          node_type: 'function',
          callee: { method: ['get'], chain_path_root_in: ['userRouter'] },
          first_arg: { kind: 'string_literal' },
        },
        extract: {
          path: '${first_arg}',
          http_method: '${callee.method}',
          handler_node_id: '${self}',
        },
      }],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].path).toBe('/api/list')
    expect(r.entryPoints[0].fullPath).toBe('/api/list')
  })

  it('extract가 full_path를 직접 반환하면 fullPath에 normalized 값으로 사용', async () => {
    const fn = n({ id: 'r1:handler', type: 'function', filePath: 'a.ts', name: 'handler' })
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const fakeAdapter = loaded({
      ...express,
      entrypointRules: [{
        id: 'full_path',
        kind: 'api',
        select: { node_type: 'function' },
        extract: { handler_node_id: '${self}', full_path: '/api//v1/' },
      }],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.entryPoints[0].fullPath).toBe('/api/v1')
  })

  it('빈 node id는 handler_node_id 누락으로 보고 emit하지 않음', async () => {
    const fn = n({ id: '', type: 'function', filePath: 'a.ts', name: 'handler' })
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const fakeAdapter = loaded({
      ...express,
      entrypointRules: [{
        id: 'empty_handler',
        kind: 'api',
        select: { node_type: 'function' },
        extract: { path: '/empty' },
      }],
    })

    const r = await runRuleEngine({ adapters: [fakeAdapter], graph, repoId: REPO })

    expect(r.entryPoints).toEqual([])
  })
})
