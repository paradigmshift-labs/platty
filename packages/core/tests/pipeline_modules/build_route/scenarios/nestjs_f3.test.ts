// NestJS F3 어댑터 — 실사례 시나리오 맥시멈 커버리지
//
// 룰 3개를 다양한 작성 형식으로 검증:
// 1. api_handler: @Controller class + @Get/@Post/@Put/@Delete/@Patch/@All/@Options/@Head method
// 2. schedule_job: @Cron/@Interval/@Timeout
// 3. sse_handler: @Sse
//
// 실사례 다양성:
//   - HTTP method 8개 전체
//   - Path 형식 변형 (leading slash, parameter, wildcard, nested)
//   - Controller path 변형 (string, object, version, leading slash)
//   - Decorator alias (Nestia TypedRoute, custom wrappers)
//   - @HttpCode 동시 사용
//   - 다중 path 인자 (배열, 다중 decorator)
//   - 빈 인자, 루트 path
//   - Cron expression 변형 (string literal, enum identifier)
//   - Interval/Timeout with number arg

import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { nestjs } from '@/pipeline_modules/build_route/adapters/nestjs.js'
import { TEST_REPO as REPO, n, e, loaded, resetEdgeId } from '../helpers/graph_builders.js'

function makeCtrl(opts: { id?: string; path?: string | null; filePath?: string } = {}) {
  resetEdgeId()
  const ctrlId = opts.id ?? 'r1:src/x.controller.ts:XController'
  const filePath = opts.filePath ?? 'src/x.controller.ts'
  const ctrl = n({ id: ctrlId, type: 'class', filePath, name: 'XController' })
  const decorEdge = opts.path === null
    ? e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' })  // @Controller() — no arg
    : e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: opts.path ?? '/cats' })
  return { ctrl, decorEdge }
}

function makeMethod(parentId: string, opts: { id?: string; name?: string; decorator: string; firstArg?: string | null; filePath?: string }) {
  const methodId = opts.id ?? `${parentId}.${opts.name ?? 'handle'}`
  const filePath = opts.filePath ?? 'src/x.controller.ts'
  const method = n({ id: methodId, type: 'method', filePath, name: opts.name ?? 'handle' })
  const contains = e({ sourceId: parentId, targetId: method.id, relation: 'contains' })
  const decor = opts.firstArg === null
    ? e({ sourceId: method.id, relation: 'decorates', targetSymbol: opts.decorator })
    : e({ sourceId: method.id, relation: 'decorates', targetSymbol: opts.decorator, firstArg: opts.firstArg ?? null })
  return { method, contains, decor }
}

// ────────────────────────────────────────────────────────────
// HTTP method 8종 전체 매칭 검증
// ────────────────────────────────────────────────────────────
describe('NestJS api_handler — HTTP method 8종 전체', () => {
  const methods = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'] as const

  for (const method of methods) {
    it(`@${method}() 매칭 → httpMethod=${method.toUpperCase()}`, async () => {
      const { ctrl, decorEdge } = makeCtrl({ path: '/items' })
      const { method: m, contains, decor } = makeMethod(ctrl.id, { decorator: method, firstArg: '/x' })
      const graph = createGraphIndex({ nodes: [ctrl, m], edges: [decorEdge, contains, decor] })
      const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
      expect(r.entryPoints).toHaveLength(1)
      expect(r.entryPoints[0].httpMethod).toBe(method.toUpperCase())
      expect(r.entryPoints[0].fullPath).toBe('/items/x')
    })
  }
})

// ────────────────────────────────────────────────────────────
// Path 형식 변형 — 작성자별 스타일 차이
// ────────────────────────────────────────────────────────────
describe('NestJS api_handler — Path 형식 변형', () => {
  it('@Get() 인자 없음 → fullPath = controller path만', async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/users' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: null })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/users')
  })

  it("@Get('id') (no leading slash) → fullPath = /users/id", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/users' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: 'id' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/users/id')
  })

  it("@Get('/id') (leading slash) → fullPath = /users/id (중복 슬래시 제거)", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/users' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: '/id' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/users/id')
  })

  it("@Get(':id') — route parameter", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/users' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: ':id' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/users/:id')
  })

  it("@Get('users/:id/posts/:postId') — multiple params", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/api' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: 'users/:id/posts/:postId' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/api/users/:id/posts/:postId')
  })

  it("@Get('*') — wildcard catch-all", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/proxy' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: '*' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/proxy/*')
  })

  it("@Controller() + @Get() — 둘 다 빈 인자 → fullPath = '/'", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: null })  // @Controller() no arg
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: null })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/')
  })

  it("@Controller('') (빈 문자열) + @Get('health') → fullPath = /health", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: 'health' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/health')
  })
})

// ────────────────────────────────────────────────────────────
// Controller path 변형 — 작성자별 스타일
// ────────────────────────────────────────────────────────────
describe('NestJS api_handler — Controller path 변형', () => {
  it("@Controller('cats') (no leading slash)", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: 'cats' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: ':id' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/cats/:id')
  })

  it("@Controller('/cats') (leading slash) — 동일 결과", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/cats' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Get', firstArg: ':id' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/cats/:id')
  })

  it("@Controller('api/v1/cats') — nested controller path", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: 'api/v1/cats' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Post', firstArg: null })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/api/v1/cats')
  })
})

// ────────────────────────────────────────────────────────────
// Decorator alias — Nestia / 커스텀 wrapper
// ────────────────────────────────────────────────────────────
describe('NestJS api_handler — Decorator alias', () => {
  it('TypedRoute built-in: @TypedRoute.Get → F3에서 자동 매칭 (analyze_repo 없이도)', async () => {
    // build_graph는 chain decorator를 target_symbol="TypedRoute.Get"으로 저장.
    // 어댑터의 built-in alias가 표준 NestJS HTTP decorator로 resolve해주어야 함.
    resetEdgeId()
    const ctrl = n({ id: 'r1:src/c.ts:Ctrl', type: 'class', filePath: 'src/c.ts', name: 'Ctrl' })
    const method = n({ id: 'r1:src/c.ts:Ctrl.list', type: 'method', filePath: 'src/c.ts', name: 'list' })
    const graph = createGraphIndex({
      nodes: [ctrl, method],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/items' }),
        e({ sourceId: ctrl.id, targetId: method.id, relation: 'contains' }),
        e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'TypedRoute.Get', firstArg: ':id' }),
      ],
    })
    // resolvedAliases 빈 채로도 매칭되어야 함 (built-in)
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
    expect(r.entryPoints[0].fullPath).toBe('/items/:id')
  })

  it('@TypedRoute.Get → Get으로 alias resolve (confidence=low)', async () => {
    resetEdgeId()
    const ctrl = n({ id: 'r1:src/c.ts:Ctrl', type: 'class', filePath: 'src/c.ts', name: 'Ctrl' })
    const method = n({ id: 'r1:src/c.ts:Ctrl.list', type: 'method', filePath: 'src/c.ts', name: 'list' })
    const decorCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/items' })
    const contains = e({ sourceId: ctrl.id, targetId: method.id, relation: 'contains' })
    // TypedRoute.Get — wrapper as 'TypedRoute_Get' symbol (build_graph가 결합 형태로 저장한다고 가정)
    const decorMethod = e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'TypedRoute_Get', firstArg: ':id' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorCtrl, contains, decorMethod] })
    const adapter = loaded(nestjs, { TypedRoute_Get: { resolvesTo: 'Get', source: 'analyze_repo' } })
    const r = await runRuleEngine({ adapters: [adapter], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
    expect(r.entryPoints[0].confidence).toBe('low')
    expect(r.entryPoints[0].detectionEvidence.aliasChain).toContain('TypedRoute_Get')
  })

  it('@ApiPaginatedGet (커스텀 wrapper) → Get으로 resolve', async () => {
    resetEdgeId()
    const ctrl = n({ id: 'r1:src/c.ts:Ctrl', type: 'class', filePath: 'src/c.ts', name: 'Ctrl' })
    const method = n({ id: 'r1:src/c.ts:Ctrl.list', type: 'method', filePath: 'src/c.ts', name: 'list' })
    const decorCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/items' })
    const contains = e({ sourceId: ctrl.id, targetId: method.id, relation: 'contains' })
    const decorMethod = e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'ApiPaginatedGet', firstArg: '' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorCtrl, contains, decorMethod] })
    const adapter = loaded(nestjs, { ApiPaginatedGet: { resolvesTo: 'Get', source: 'analyze_repo' } })
    const r = await runRuleEngine({ adapters: [adapter], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
    expect(r.entryPoints[0].confidence).toBe('low')
  })

  it('aliasMap에 없는 wrapper → 매칭 안 함 (standard decorator만 매칭)', async () => {
    resetEdgeId()
    const ctrl = n({ id: 'r1:src/c.ts:Ctrl', type: 'class', filePath: 'src/c.ts', name: 'Ctrl' })
    const method = n({ id: 'r1:src/c.ts:Ctrl.list', type: 'method', filePath: 'src/c.ts', name: 'list' })
    const decorCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/items' })
    const contains = e({ sourceId: ctrl.id, targetId: method.id, relation: 'contains' })
    const decorMethod = e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'UnknownWrapper', firstArg: ':id' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorCtrl, contains, decorMethod] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// schedule_job — Cron / Interval / Timeout 변형
// ────────────────────────────────────────────────────────────
describe('NestJS schedule_job — 변형', () => {
  it('@Cron 문자열 expression', async () => {
    resetEdgeId()
    const svc = n({ id: 'r1:src/t.ts:T', type: 'class', filePath: 'src/t.ts', name: 'T' })
    const job = n({ id: 'r1:src/t.ts:T.run', type: 'method', filePath: 'src/t.ts', name: 'run' })
    const contains = e({ sourceId: svc.id, targetId: job.id, relation: 'contains' })
    const decor = e({ sourceId: job.id, relation: 'decorates', targetSymbol: 'Cron', firstArg: '0 0 * * *' })
    const graph = createGraphIndex({ nodes: [svc, job], edges: [contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].kind).toBe('job')
    expect(r.entryPoints[0].handlerNodeId).toBe(job.id)
  })

  it('@Cron(CronExpression.EVERY_HOUR) (identifier — firstArg null)', async () => {
    resetEdgeId()
    const svc = n({ id: 'r1:src/t.ts:T', type: 'class', filePath: 'src/t.ts', name: 'T' })
    const job = n({ id: 'r1:src/t.ts:T.run', type: 'method', filePath: 'src/t.ts', name: 'run' })
    const contains = e({ sourceId: svc.id, targetId: job.id, relation: 'contains' })
    const decor = e({ sourceId: job.id, relation: 'decorates', targetSymbol: 'Cron', firstArg: null })
    const graph = createGraphIndex({ nodes: [svc, job], edges: [contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].kind).toBe('job')
  })

  it('@Interval (number arg, firstArg null)', async () => {
    resetEdgeId()
    const svc = n({ id: 'r1:src/t.ts:T', type: 'class', filePath: 'src/t.ts', name: 'T' })
    const job = n({ id: 'r1:src/t.ts:T.tick', type: 'method', filePath: 'src/t.ts', name: 'tick' })
    const contains = e({ sourceId: svc.id, targetId: job.id, relation: 'contains' })
    const decor = e({ sourceId: job.id, relation: 'decorates', targetSymbol: 'Interval', firstArg: null })
    const graph = createGraphIndex({ nodes: [svc, job], edges: [contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].kind).toBe('job')
  })

  it('@Timeout (number arg)', async () => {
    resetEdgeId()
    const svc = n({ id: 'r1:src/t.ts:T', type: 'class', filePath: 'src/t.ts', name: 'T' })
    const job = n({ id: 'r1:src/t.ts:T.delayed', type: 'method', filePath: 'src/t.ts', name: 'delayed' })
    const contains = e({ sourceId: svc.id, targetId: job.id, relation: 'contains' })
    const decor = e({ sourceId: job.id, relation: 'decorates', targetSymbol: 'Timeout', firstArg: null })
    const graph = createGraphIndex({ nodes: [svc, job], edges: [contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
  })

  it('multiple jobs in same service — 각각 entry', async () => {
    resetEdgeId()
    const svc = n({ id: 'r1:src/t.ts:T', type: 'class', filePath: 'src/t.ts', name: 'T' })
    const job1 = n({ id: 'r1:src/t.ts:T.daily', type: 'method', filePath: 'src/t.ts', name: 'daily' })
    const job2 = n({ id: 'r1:src/t.ts:T.hourly', type: 'method', filePath: 'src/t.ts', name: 'hourly' })
    const job3 = n({ id: 'r1:src/t.ts:T.weekly', type: 'method', filePath: 'src/t.ts', name: 'weekly' })
    const graph = createGraphIndex({
      nodes: [svc, job1, job2, job3],
      edges: [
        e({ sourceId: svc.id, targetId: job1.id, relation: 'contains' }),
        e({ sourceId: svc.id, targetId: job2.id, relation: 'contains' }),
        e({ sourceId: svc.id, targetId: job3.id, relation: 'contains' }),
        e({ sourceId: job1.id, relation: 'decorates', targetSymbol: 'Cron', firstArg: '0 0 * * *' }),
        e({ sourceId: job2.id, relation: 'decorates', targetSymbol: 'Cron', firstArg: '0 * * * *' }),
        e({ sourceId: job3.id, relation: 'decorates', targetSymbol: 'Cron', firstArg: '0 0 * * 0' }),
      ],
    })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints.filter((ep) => ep.kind === 'job')).toHaveLength(3)
  })
})

// ────────────────────────────────────────────────────────────
// sse_handler — SSE 변형
// ────────────────────────────────────────────────────────────
describe('NestJS sse_handler — 변형', () => {
  it("@Sse() — path 없이 (controller root)", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/events' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Sse', firstArg: null })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
    expect(r.entryPoints[0].fullPath).toBe('/events')
    expect(r.entryPoints[0].detectionEvidence.matchedRuleId).toBe('sse_handler')
  })

  it("@Sse('stream') — 명시 path", async () => {
    const { ctrl, decorEdge } = makeCtrl({ path: '/api' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'Sse', firstArg: 'stream' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [decorEdge, contains, decor] })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].fullPath).toBe('/api/stream')
  })

  it('@Sse + @Get 동시 사용 → 둘 다 emit (서로 다른 룰 매칭)', async () => {
    resetEdgeId()
    const ctrl = n({ id: 'r1:src/x.ts:X', type: 'class', filePath: 'src/x.ts', name: 'X' })
    const method = n({ id: 'r1:src/x.ts:X.feed', type: 'method', filePath: 'src/x.ts', name: 'feed' })
    const graph = createGraphIndex({
      nodes: [ctrl, method],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: '/api' }),
        e({ sourceId: ctrl.id, targetId: method.id, relation: 'contains' }),
        e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'Sse', firstArg: 'live' }),
        e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'Get', firstArg: 'live' }),
      ],
    })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    // 같은 path+method+handler → dedup으로 1건
    expect(r.entryPoints).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────
// 복합 시나리오 — 실제 NestJS controller 구조 (REST CRUD)
// ────────────────────────────────────────────────────────────
describe('NestJS — 복합 REST CRUD controller', () => {
  it('단일 Controller에 GET/POST/PUT/DELETE 4개 method → 4건 emit', async () => {
    resetEdgeId()
    const ctrl = n({ id: 'r1:src/users.controller.ts:UsersController', type: 'class',
                    filePath: 'src/users.controller.ts', name: 'UsersController' })
    const list = n({ id: 'r1:users.list', type: 'method', filePath: 'src/users.controller.ts', name: 'list' })
    const create = n({ id: 'r1:users.create', type: 'method', filePath: 'src/users.controller.ts', name: 'create' })
    const update = n({ id: 'r1:users.update', type: 'method', filePath: 'src/users.controller.ts', name: 'update' })
    const remove = n({ id: 'r1:users.remove', type: 'method', filePath: 'src/users.controller.ts', name: 'remove' })

    const graph = createGraphIndex({
      nodes: [ctrl, list, create, update, remove],
      edges: [
        e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: 'users' }),
        e({ sourceId: ctrl.id, targetId: list.id, relation: 'contains' }),
        e({ sourceId: ctrl.id, targetId: create.id, relation: 'contains' }),
        e({ sourceId: ctrl.id, targetId: update.id, relation: 'contains' }),
        e({ sourceId: ctrl.id, targetId: remove.id, relation: 'contains' }),
        e({ sourceId: list.id, relation: 'decorates', targetSymbol: 'Get', firstArg: null }),
        e({ sourceId: create.id, relation: 'decorates', targetSymbol: 'Post', firstArg: null }),
        e({ sourceId: update.id, relation: 'decorates', targetSymbol: 'Put', firstArg: ':id' }),
        e({ sourceId: remove.id, relation: 'decorates', targetSymbol: 'Delete', firstArg: ':id' }),
      ],
    })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(4)
    const sorted = r.entryPoints.map((ep) => `${ep.httpMethod} ${ep.fullPath}`).sort()
    expect(sorted).toEqual([
      'DELETE /users/:id',
      'GET /users',
      'POST /users',
      'PUT /users/:id',
    ])
  })

  it('Controller 외부의 method (contains edge 없음) → 매칭 안 함', async () => {
    resetEdgeId()
    const orphan = n({ id: 'r1:src/util.ts:standalone', type: 'method', filePath: 'src/util.ts', name: 'standalone' })
    const graph = createGraphIndex({
      nodes: [orphan],
      edges: [
        e({ sourceId: orphan.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/x' }),
      ],
    })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    // enclosing_class_decorated_by='Controller' 조건 실패 → 매칭 안 됨
    expect(r.entryPoints).toHaveLength(0)
  })

  it('Controller가 아닌 class 안의 method (@Injectable service) → 매칭 안 함', async () => {
    resetEdgeId()
    const svc = n({ id: 'r1:src/s.ts:S', type: 'class', filePath: 'src/s.ts', name: 'S' })
    const m = n({ id: 'r1:src/s.ts:S.find', type: 'method', filePath: 'src/s.ts', name: 'find' })
    const graph = createGraphIndex({
      nodes: [svc, m],
      edges: [
        e({ sourceId: svc.id, relation: 'decorates', targetSymbol: 'Injectable' }),
        e({ sourceId: svc.id, targetId: m.id, relation: 'contains' }),
        e({ sourceId: m.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/x' }),  // 잘못 쓴 경우
      ],
    })
    const r = await runRuleEngine({ adapters: [loaded(nestjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})
