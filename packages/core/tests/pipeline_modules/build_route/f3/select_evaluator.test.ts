import { describe, it, expect, afterEach } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import type { SelectExpr } from '@/pipeline_modules/build_route/types.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { evaluateSelect } from '@/pipeline_modules/build_route/f3/select_evaluator.js'

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

const candidateIds = (cs: { node: CodeNode }[]): string[] =>
  cs.map((c) => c.node.id).sort()

// ────────────────────────────────────────
// 공용 fixture
// ────────────────────────────────────────
const ctrl = n({ id: 'r1:src/order.ts:OrderController', type: 'class', filePath: 'src/order.ts', name: 'OrderController' })
const list = n({ id: 'r1:src/order.ts:OrderController.list', type: 'method', filePath: 'src/order.ts', name: 'list' })
const create = n({ id: 'r1:src/order.ts:OrderController.create', type: 'method', filePath: 'src/order.ts', name: 'create' })
const setup = n({ id: 'r1:src/router.ts:setupRoutes', type: 'function', filePath: 'src/router.ts', name: 'setupRoutes' })
const dashboardPage = n({ id: 'r1:app/dashboard/page.tsx', type: 'file', filePath: 'app/dashboard/page.tsx', name: 'page.tsx' })
const layoutFile = n({ id: 'r1:app/layout.tsx', type: 'file', filePath: 'app/layout.tsx', name: 'layout.tsx' })
const blogPage = n({ id: 'r1:app/blog/page.tsx', type: 'file', filePath: 'app/blog/page.tsx', name: 'page.tsx' })

// ────────────────────────────────────────
describe('S1: relation:calls + callee.method', () => {
  it("calls edges 중 method='get' 매칭", () => {
    const callGet = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/x' })
    const callPost = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'post', chainPath: 'app' })
    const callOther = e({ sourceId: list.id, relation: 'calls', targetSymbol: 'unrelated' })
    const idx = createGraphIndex({ nodes: [setup, list], edges: [callGet, callPost, callOther] })

    const out = evaluateSelect({ relation: 'calls', callee: { method: ['get'] } }, idx)
    expect(candidateIds(out)).toEqual([setup.id])
    expect(out[0].matchedEdges.map((m) => m.targetSymbol)).toEqual(['get'])
  })

  it("method 배열 OR 매칭 (['get','post'])", () => {
    const callGet = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get' })
    const callPost = e({ sourceId: list.id, relation: 'calls', targetSymbol: 'post' })
    const idx = createGraphIndex({ nodes: [setup, list], edges: [callGet, callPost] })

    const out = evaluateSelect({ relation: 'calls', callee: { method: ['get', 'post'] } }, idx)
    expect(candidateIds(out)).toEqual([list.id, setup.id].sort())
  })

  it('same source의 다중 route call은 edge별 candidate로 유지', () => {
    const callGet = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'get',
      chainPath: 'app',
      firstArg: '/users',
    })
    const callPut = e({
      sourceId: setup.id,
      relation: 'calls',
      targetSymbol: 'put',
      chainPath: 'app',
      firstArg: '/user/:id',
    })
    const idx = createGraphIndex({ nodes: [setup], edges: [callGet, callPut] })

    const out = evaluateSelect({
      relation: 'calls',
      callee: {
        chain_path_root_in: ['app'],
        method: ['get', 'put'],
      },
      first_arg: { kind: 'string_literal' },
    }, idx)

    expect(out).toHaveLength(2)
    expect(out.map((c) => c.matchedEdges[0].firstArg).sort()).toEqual([
      '/user/:id',
      '/users',
    ])
  })

  it("callee.symbol='router' 매칭", () => {
    const callRouter = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'router' })
    const callOther = e({ sourceId: list.id, relation: 'calls', targetSymbol: 'get' })
    const idx = createGraphIndex({ nodes: [setup, list], edges: [callRouter, callOther] })

    const out = evaluateSelect({ callee: { symbol: 'router' } }, idx)
    expect(candidateIds(out)).toEqual([setup.id])
  })

  it('relation 생략 시 callee.method/chain_path/first_arg가 calls edge를 기본 후보로 사용', () => {
    const callGet = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/x' })
    const idx = createGraphIndex({ nodes: [setup], edges: [callGet] })

    expect(candidateIds(evaluateSelect({ callee: { method: 'get' } }, idx))).toEqual([setup.id])
    expect(candidateIds(evaluateSelect({ callee: { chain_path_root_in: ['app'] } }, idx))).toEqual([setup.id])
    expect(candidateIds(evaluateSelect({ first_arg: { kind: 'string_literal' } }, idx))).toEqual([setup.id])
  })
})

describe('S2: decorated_by', () => {
  it("decorates edges target_symbol IN ['Get','Post']", () => {
    const decGet = e({ sourceId: list.id, relation: 'decorates', targetSymbol: 'Get' })
    const decPost = e({ sourceId: create.id, relation: 'decorates', targetSymbol: 'Post' })
    const decCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' })
    const idx = createGraphIndex({ nodes: [ctrl, list, create], edges: [decGet, decPost, decCtrl] })

    const out = evaluateSelect({ decorated_by: ['Get', 'Post'] }, idx)
    expect(candidateIds(out)).toEqual([list.id, create.id].sort())
  })
})

describe('S3: enclosing_class_decorated_by', () => {
  it('Class decorated by Controller → contained methods', () => {
    const decCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' })
    const containsList = e({ sourceId: ctrl.id, targetId: list.id, relation: 'contains' })
    const containsCreate = e({ sourceId: ctrl.id, targetId: create.id, relation: 'contains' })
    const idx = createGraphIndex({
      nodes: [ctrl, list, create],
      edges: [decCtrl, containsList, containsCreate],
    })

    const out = evaluateSelect({ enclosing_class_decorated_by: 'Controller' }, idx)
    expect(candidateIds(out)).toEqual([list.id, create.id].sort())
  })

  it('Class decorated by 다른 symbol → 매칭 0', () => {
    const decService = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Injectable' })
    const idx = createGraphIndex({ nodes: [ctrl, list], edges: [decService] })
    expect(evaluateSelect({ enclosing_class_decorated_by: 'Controller' }, idx)).toEqual([])
  })

  it('enclosing class 후보에 node_type/decorated_by/file_glob/exclude/default filters 적용', () => {
    const decCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' })
    const containsList = e({ sourceId: ctrl.id, targetId: list.id, relation: 'contains' })
    const containsCreate = e({ sourceId: ctrl.id, targetId: create.id, relation: 'contains' })
    const decGet = e({ sourceId: list.id, relation: 'decorates', targetSymbol: 'Get' })
    const decPost = e({ sourceId: create.id, relation: 'decorates', targetSymbol: 'Post' })
    const defaultList = { ...list, isDefaultExport: true }
    const idx = createGraphIndex({
      nodes: [ctrl, defaultList, create],
      edges: [decCtrl, containsList, containsCreate, decGet, decPost],
    })

    const out = evaluateSelect({
      enclosing_class_decorated_by: 'Controller',
      node_type: 'method',
      decorated_by: 'Get',
      file_glob: 'src/*.ts',
      exclude_glob: 'src/ignored.ts',
      is_default_export: true,
    }, idx)

    expect(candidateIds(out)).toEqual([list.id])
  })

  it('enclosing class contains edge without target or node is ignored', () => {
    const decCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' })
    const noTarget = e({ sourceId: ctrl.id, targetId: null, relation: 'contains' })
    const missingTarget = e({ sourceId: ctrl.id, targetId: 'missing', relation: 'contains' })
    const idx = createGraphIndex({ nodes: [ctrl], edges: [decCtrl, noTarget, missingTarget] })

    expect(evaluateSelect({ enclosing_class_decorated_by: 'Controller' }, idx)).toEqual([])
  })

  it('enclosing class default export 필터에서 null isDefaultExport는 false로 취급', () => {
    const nullableMethod = n({
      id: 'r1:src/order.ts:OrderController.nullable',
      type: 'method',
      filePath: 'src/order.ts',
      name: 'nullable',
      isDefaultExport: null as never,
    })
    const decCtrl = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'Controller' })
    const containsNullable = e({ sourceId: ctrl.id, targetId: nullableMethod.id, relation: 'contains' })
    const idx = createGraphIndex({ nodes: [ctrl, nullableMethod], edges: [decCtrl, containsNullable] })

    const out = evaluateSelect({
      enclosing_class_decorated_by: 'Controller',
      is_default_export: false,
    }, idx)

    expect(candidateIds(out)).toEqual([nullableMethod.id])
  })
})

describe('S4: file_glob', () => {
  it("'app/**/page.tsx' 매칭 — page 노드만", () => {
    const idx = createGraphIndex({ nodes: [dashboardPage, layoutFile, blogPage], edges: [] })
    const out = evaluateSelect({ file_glob: ['app/**/page.tsx'] }, idx)
    expect(candidateIds(out)).toEqual([dashboardPage.id, blogPage.id].sort())
  })
})

describe('S5: exclude_glob', () => {
  it("file_glob 'app/**/*.tsx' + exclude '**/layout.*' → page만", () => {
    const idx = createGraphIndex({ nodes: [dashboardPage, layoutFile, blogPage], edges: [] })
    const out = evaluateSelect(
      { file_glob: ['app/**/*.tsx'], exclude_glob: ['**/layout.*'] },
      idx,
    )
    expect(candidateIds(out)).toEqual([dashboardPage.id, blogPage.id].sort())
  })
})

describe('S6: first_arg.kind = string_literal', () => {
  it('firstArg NOT NULL 인 calls만', () => {
    const callStr = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', firstArg: '/orders' })
    const callObj = e({ sourceId: list.id, relation: 'calls', targetSymbol: 'get', firstArg: null })
    const idx = createGraphIndex({ nodes: [setup, list], edges: [callStr, callObj] })

    const out = evaluateSelect(
      { relation: 'calls', first_arg: { kind: 'string_literal' } },
      idx,
    )
    expect(candidateIds(out)).toEqual([setup.id])
  })
})

describe('S7: callee.chain_path_root_in', () => {
  it("chain_path root in ['app','router']", () => {
    const callApp = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app.routes' })
    const callRouter = e({ sourceId: list.id, relation: 'calls', targetSymbol: 'get', chainPath: 'router' })
    const callThis = e({ sourceId: create.id, relation: 'calls', targetSymbol: 'get', chainPath: 'this.svc' })
    const idx = createGraphIndex({
      nodes: [setup, list, create],
      edges: [callApp, callRouter, callThis],
    })

    const out = evaluateSelect(
      { relation: 'calls', callee: { chain_path_root_in: ['app', 'router'] } },
      idx,
    )
    expect(candidateIds(out)).toEqual([setup.id, list.id].sort())
  })

  it('chain_path 없는 calls edge는 chain_path_root_in에서 제외', () => {
    const callWithoutChain = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', chainPath: null })
    const idx = createGraphIndex({ nodes: [setup], edges: [callWithoutChain] })

    expect(evaluateSelect({ relation: 'calls', callee: { chain_path_root_in: ['app'] } }, idx)).toEqual([])
  })
})

describe('S8: node_type', () => {
  it("node_type:'method' 만 매칭", () => {
    const idx = createGraphIndex({ nodes: [ctrl, list, create, setup], edges: [] })
    const out = evaluateSelect({ node_type: 'method' }, idx)
    expect(candidateIds(out)).toEqual([list.id, create.id].sort())
  })
})

describe('S9: 다중 조건 AND', () => {
  it("relation:calls + method=get + first_arg=string_literal", () => {
    const a = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get', firstArg: '/x' })
    const b = e({ sourceId: list.id, relation: 'calls', targetSymbol: 'get', firstArg: null })
    const c = e({ sourceId: create.id, relation: 'calls', targetSymbol: 'post', firstArg: '/y' })
    const idx = createGraphIndex({ nodes: [setup, list, create], edges: [a, b, c] })

    const out = evaluateSelect(
      {
        relation: 'calls',
        callee: { method: ['get'] },
        first_arg: { kind: 'string_literal' },
      },
      idx,
    )
    expect(candidateIds(out)).toEqual([setup.id])
  })

  it('relation 기반 후보를 file_glob/node_type으로 교집합 필터링', () => {
    const callGet = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get' })
    const idx = createGraphIndex({ nodes: [setup], edges: [callGet] })

    const out = evaluateSelect({
      relation: 'calls',
      file_glob: 'src/*.ts',
      node_type: 'function',
    }, idx)

    expect(candidateIds(out)).toEqual([setup.id])
  })

  it('edge source가 node_type 필터에서 빠지면 candidate 생성에서 제외', () => {
    const callGet = e({ sourceId: ctrl.id, relation: 'calls', targetSymbol: 'get' })
    const idx = createGraphIndex({ nodes: [ctrl], edges: [callGet] })

    expect(evaluateSelect({ relation: 'calls', node_type: 'function' }, idx)).toEqual([])
  })
})

describe('S10: 매칭 0건', () => {
  it('빈 배열', () => {
    const idx = createGraphIndex({ nodes: [setup], edges: [] })
    expect(evaluateSelect({ relation: 'calls', callee: { method: ['xyz'] } }, idx)).toEqual([])
  })

  it('decorated_by — decorates edge 0건', () => {
    const idx = createGraphIndex({ nodes: [list], edges: [] })
    expect(evaluateSelect({ decorated_by: ['Get'] }, idx)).toEqual([])
  })

  it('아무 selector도 없으면 빈 배열', () => {
    const idx = createGraphIndex({ nodes: [setup], edges: [] })
    expect(evaluateSelect({}, idx)).toEqual([])
  })

  it('edge sourceId에 해당하는 node가 없으면 candidate 생성에서 제외', () => {
    const callGet = e({ sourceId: 'missing', relation: 'calls', targetSymbol: 'get' })
    const idx = createGraphIndex({ nodes: [setup], edges: [callGet] })
    expect(evaluateSelect({ relation: 'calls', callee: { method: 'get' } }, idx)).toEqual([])
  })
})

// ────────────────────────────────────────
// S11: is_default_export primitive
// ────────────────────────────────────────
describe('S11: is_default_export', () => {
  const fileNode = n({ id: 'r1:app/page.tsx', type: 'file', filePath: 'app/page.tsx', name: 'page.tsx' })
  const pageFn = n({ id: 'r1:app/page.tsx:Page', type: 'function', filePath: 'app/page.tsx', name: 'Page', isDefaultExport: true })
  const metaVar = n({ id: 'r1:app/page.tsx:metadata', type: 'variable', filePath: 'app/page.tsx', name: 'metadata', isDefaultExport: false })
  const nonDefaultFn = n({ id: 'r1:app/page.tsx:generateStaticParams', type: 'function', filePath: 'app/page.tsx', name: 'generateStaticParams', isDefaultExport: false })

  it('is_default_export:true → isDefaultExport=true 노드만', () => {
    const idx = createGraphIndex({ nodes: [fileNode, pageFn, metaVar, nonDefaultFn], edges: [] })
    const out = evaluateSelect({ is_default_export: true }, idx)
    expect(candidateIds(out)).toEqual([pageFn.id])
  })

  it('is_default_export:false → isDefaultExport=false 노드만 (file 포함)', () => {
    const nullDefaultNode = n({
      id: 'r1:app/page.tsx:legacy',
      type: 'function',
      filePath: 'app/page.tsx',
      name: 'legacy',
      isDefaultExport: null as never,
    })
    const idx = createGraphIndex({ nodes: [fileNode, pageFn, metaVar, nonDefaultFn, nullDefaultNode], edges: [] })
    const out = evaluateSelect({ is_default_export: false }, idx)
    // fileNode.isDefaultExport=false (기본값), nullDefaultNode는 false로 취급
    expect(candidateIds(out)).toEqual([fileNode.id, metaVar.id, nonDefaultFn.id, nullDefaultNode.id].sort())
  })

  it('file_glob + is_default_export:true → 그 파일의 default export 만', () => {
    const otherFile = n({ id: 'r1:app/layout.tsx', type: 'file', filePath: 'app/layout.tsx', name: 'layout.tsx' })
    const layoutFn = n({ id: 'r1:app/layout.tsx:RootLayout', type: 'function', filePath: 'app/layout.tsx', name: 'RootLayout', isDefaultExport: true })
    const idx = createGraphIndex({ nodes: [fileNode, pageFn, metaVar, otherFile, layoutFn], edges: [] })
    const out = evaluateSelect({ file_glob: ['app/**/page.tsx'], is_default_export: true }, idx)
    // page.tsx 파일 안의 default export 만 — layoutFn 제외
    expect(candidateIds(out)).toEqual([pageFn.id])
  })

  it("node_type='function' + is_default_export:true → 함수 중 default export 만", () => {
    const idx = createGraphIndex({ nodes: [fileNode, pageFn, metaVar, nonDefaultFn], edges: [] })
    const out = evaluateSelect({ node_type: 'function', is_default_export: true }, idx)
    expect(candidateIds(out)).toEqual([pageFn.id])
  })

  it('is_default_export 필터 없으면 isDefaultExport 무관 (기존 동작 유지)', () => {
    const idx = createGraphIndex({ nodes: [fileNode, pageFn, metaVar, nonDefaultFn], edges: [] })
    // is_default_export 미지정 → 모든 function 노드
    const out = evaluateSelect({ node_type: 'function' }, idx)
    expect(candidateIds(out)).toEqual([pageFn.id, nonDefaultFn.id].sort())
  })
})

// ────────────────────────────────────────
// S12: requires_import — emergent-mode REPO-LEVEL evidence self-gate
// (the load-bearing primitive behind the emergent migration; default mode ignores it).
// ────────────────────────────────────────
describe('S12: requires_import (emergent repo-level self-gate)', () => {
  // Emergent routing is now the DEFAULT (the gate is on unless LEGACY_ROUTING=1). afterEach clears the
  // legacy override so other suites see the default.
  afterEach(() => {
    delete process.env.LEGACY_ROUTING
  })

  const routeFile = n({ id: 'r1:src/routes.ts:setupRoutes', type: 'function', filePath: 'src/routes.ts', name: 'setupRoutes' })
  const appFile = n({ id: 'r1:src/app.ts', type: 'file', filePath: 'src/app.ts', name: 'app.ts' })
  // `app.get('/x')` lives in routes.ts; routes.ts does NOT import express — `app` arrived by injection.
  const routeCall = () => e({ sourceId: routeFile.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/x' })
  // the express import lives in a DIFFERENT file (app.ts).
  const expressImport = () => e({ sourceId: appFile.id, relation: 'imports', targetSymbol: '*', targetSpecifier: 'express' })
  const sel: SelectExpr = {
    relation: 'calls',
    callee: { chain_path_root_in: ['app'], method: ['get'] },
    first_arg: { kind: 'string_literal' },
    requires_import: ['express'],
  }

  it('default (emergent) + repo imports express in a DIFFERENT file → route kept (gate is repo-level, not per-file)', () => {
    const idx = createGraphIndex({ nodes: [routeFile, appFile], edges: [routeCall(), expressImport()] })
    expect(candidateIds(evaluateSelect(sel, idx))).toEqual([routeFile.id])
  })

  it('default (emergent) + no file imports express → evidence withheld → 0 candidates', () => {
    const idx = createGraphIndex({ nodes: [routeFile, appFile], edges: [routeCall()] })
    expect(evaluateSelect(sel, idx)).toEqual([])
  })

  it('default (emergent) + a different specifier imported (fastify, not express) → gate does NOT fire → 0', () => {
    const fastifyImport = e({ sourceId: appFile.id, relation: 'imports', targetSymbol: '*', targetSpecifier: 'fastify' })
    const idx = createGraphIndex({ nodes: [routeFile, appFile], edges: [routeCall(), fastifyImport] })
    expect(evaluateSelect(sel, idx)).toEqual([])
  })

  it('LEGACY_ROUTING=1 → requires_import is a no-op (old framework-gate path); route kept without any import', () => {
    process.env.LEGACY_ROUTING = '1'
    const idx = createGraphIndex({ nodes: [routeFile], edges: [routeCall()] })
    expect(candidateIds(evaluateSelect(sel, idx))).toEqual([routeFile.id])
  })

  // The gate must cover the enclosing_class_decorated_by path too — that branch returns early, so a
  // decorator rule (NestJS @Controller+@Get) would otherwise fire without its declared import evidence.
  const decoSel: SelectExpr = { enclosing_class_decorated_by: 'Controller', decorated_by: ['Get'], requires_import: ['@nestjs/common'] }
  function nestGraph(withImport: boolean) {
    const ctrlFile = n({ id: 'r1:cats.ctrl.ts', type: 'file', filePath: 'cats.ctrl.ts', name: 'cats.ctrl.ts' })
    const cls = n({ id: 'r1:cats.ctrl.ts:CatsController', type: 'class', filePath: 'cats.ctrl.ts', name: 'CatsController' })
    const method = n({ id: 'r1:cats.ctrl.ts:CatsController.find', type: 'method', filePath: 'cats.ctrl.ts', name: 'find' })
    const edges = [
      e({ sourceId: cls.id, relation: 'decorates', targetSymbol: 'Controller' }),
      e({ sourceId: cls.id, targetId: method.id, relation: 'contains' }),
      e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/cats' }),
    ]
    if (withImport) edges.push(e({ sourceId: ctrlFile.id, relation: 'imports', targetSymbol: 'Get', targetSpecifier: '@nestjs/common' }))
    return createGraphIndex({ nodes: [ctrlFile, cls, method], edges })
  }

  it('EMERGENT + enclosing_class rule + repo imports @nestjs/common → method kept', () => {
    process.env.EMERGENT = '1'
    expect(candidateIds(evaluateSelect(decoSel, nestGraph(true)))).toEqual(['r1:cats.ctrl.ts:CatsController.find'])
  })

  it('EMERGENT + enclosing_class rule + NO @nestjs import → gate withholds (0), not bypassed by early return', () => {
    process.env.EMERGENT = '1'
    expect(evaluateSelect(decoSel, nestGraph(false))).toEqual([])
  })
})

// S13: min_arg_count — drop single-arg settings getters (app.get('env')) but keep routes (app.get('/x', h)).
describe('S13: min_arg_count (emergent call-arity gate)', () => {
  afterEach(() => {
    delete process.env.LEGACY_ROUTING
  })

  const fn = n({ id: 'r1:app.ts:setup', type: 'function', filePath: 'app.ts', name: 'setup' })
  const route = () => e({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/x', literalArgs: JSON.stringify(['/x', null]) })
  const getter = () => e({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: 'env', literalArgs: JSON.stringify(['env']) })
  const sel: SelectExpr = { relation: 'calls', callee: { chain_path_root_in: ['app'], method: ['get'] }, first_arg: { kind: 'string_literal' }, min_arg_count: 2 }

  it('default (emergent): keeps the 2-arg route, drops the 1-arg settings getter', () => {
    const idx = createGraphIndex({ nodes: [fn], edges: [route(), getter()] })
    const out = evaluateSelect(sel, idx)
    expect(out.map((c) => c.matchedEdges[0].firstArg)).toEqual(['/x'])
  })

  it('default (emergent): edge with null literalArgs is kept (conservative — no false drop)', () => {
    const noArgs = e({ sourceId: fn.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/y', literalArgs: null })
    const idx = createGraphIndex({ nodes: [fn], edges: [noArgs] })
    expect(evaluateSelect(sel, idx).map((c) => c.matchedEdges[0].firstArg)).toEqual(['/y'])
  })

  it('LEGACY_ROUTING=1: min_arg_count ignored — getter kept', () => {
    process.env.LEGACY_ROUTING = '1'
    const idx = createGraphIndex({ nodes: [fn], edges: [route(), getter()] })
    expect(evaluateSelect(sel, idx).map((c) => c.matchedEdges[0].firstArg).sort()).toEqual(['/x', 'env'])
  })
})

describe('shorthand: string vs string[] 둘 다 허용', () => {
  it('decorated_by string single', () => {
    const decGet = e({ sourceId: list.id, relation: 'decorates', targetSymbol: 'Get' })
    const idx = createGraphIndex({ nodes: [list], edges: [decGet] })
    const out = evaluateSelect({ decorated_by: 'Get' }, idx)
    expect(candidateIds(out)).toEqual([list.id])
  })

  it('callee.method string single', () => {
    const callGet = e({ sourceId: setup.id, relation: 'calls', targetSymbol: 'get' })
    const idx = createGraphIndex({ nodes: [setup], edges: [callGet] })
    const out = evaluateSelect({ relation: 'calls', callee: { method: 'get' } }, idx)
    expect(candidateIds(out)).toEqual([setup.id])
  })

  it('file_glob string single', () => {
    const idx = createGraphIndex({ nodes: [dashboardPage, layoutFile], edges: [] })
    const out = evaluateSelect({ file_glob: 'app/**/page.tsx' }, idx)
    expect(candidateIds(out)).toEqual([dashboardPage.id])
  })
})
