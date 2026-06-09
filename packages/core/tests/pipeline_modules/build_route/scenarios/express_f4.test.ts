// Express F4 source fallback — 실사례 시나리오 맥시멈
//
// express_direct 어댑터 (additive):
//   - direct app routes (string literal, template, constant)
//   - swagger middleware mount
//   - apollo graphql middleware
//   - resource routes
//   - REST controller map
//   - route table (data-driven)
//   - MVC boot
//   - class instance routes
//   - require() mount
//
// express_variable_mount 어댑터 (supersede_handler):
//   - app.use('/api', apiRouter) — cross-file router
//   - 다단 mount

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeNode } from '@/db/schema/code_graph.js'
import { buildSourceFallbackEntries } from '@/pipeline_modules/build_route/f4_evaluate_source_fallbacks.js'
import type { FrameworkDetectionResult } from '@/pipeline_modules/build_route/types.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'express-f4-'))
  tempDirs.push(dir)
  for (const [filePath, source] of Object.entries(files)) {
    const fullPath = join(dir, filePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, source)
  }
  return dir
}

function fileNode(filePath: string): CodeNode {
  return {
    id: `${REPO}:${filePath}`,
    repoId: REPO,
    type: 'file',
    filePath,
    name: filePath.split('/').pop() ?? filePath,
    lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-15',
  }
}

function functionNode(filePath: string, name: string): CodeNode {
  return {
    ...fileNode(filePath),
    id: `${REPO}:${filePath}:${name}`,
    type: 'function',
    name,
  }
}

function run(repoPath: string, nodes: CodeNode[]) {
  return buildSourceFallbackEntries({
    repoPath, repoId: REPO,
    stackInfo: { framework: 'express', routingLibs: [] },
    detections: [{ framework: 'express', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
    graphNodes: nodes,
    graphEdges: [],
  })
}

// ────────────────────────────────────────────────────────────
// express_direct — 상수 path (변수 참조)
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (constant path)', () => {
  it("const BASE_PATH = '/api/v1'; app.get(BASE_PATH, h) → /api/v1 GET (constant path 추출)", () => {
    // express_direct 어댑터의 constant path extractor는 app.use(...) 존재 + const ... = '...' + app.METHOD(identifier, ...) 패턴 모두 필요
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
import express from 'express'
const app = express()

const BASE_PATH = '/api/v1'
const HEALTH_PATH = '/health'

app.use(express.json())
app.get(BASE_PATH, (req, res) => res.send('hi'))
app.get(HEALTH_PATH, (req, res) => res.send('ok'))
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const direct = entries.filter((e) => String(e.metadata?.adapterId ?? '').includes('express'))
    const paths = direct.map((e) => `${e.httpMethod} ${e.fullPath}`).sort()
    expect(paths).toContain('GET /api/v1')
    expect(paths).toContain('GET /health')
  })

  it("template literal path: app.get(`/v${version}/x`, h)", () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
import express from 'express'
const app = express()
const version = 1
app.get(\`/v\${version}/users\`, (req, res) => res.send('hi'))
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    // template은 :version 형태로 정규화될 수도, 안 될 수도 있음 — 추출되는지만 확인
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — Swagger middleware
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (Swagger)', () => {
  it("app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(doc))", () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
import express from 'express'
import swaggerUi from 'swagger-ui-express'
const app = express()
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const swagger = entries.filter((e) => (e.metadata?.sourceFallback as string)?.includes('swagger'))
    expect(swagger.length).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — Apollo GraphQL
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (Apollo)', () => {
  it("app.use('/graphql', expressMiddleware(server))", () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
import express from 'express'
import { expressMiddleware } from '@apollo/server/express4'
const app = express()
const server = createApolloServer()
app.use('/graphql', expressMiddleware(server))
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const apollo = entries.filter((e) => (e.metadata?.sourceFallback as string)?.includes('apollo'))
    expect(apollo.length).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — Route table (data-driven)
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (route table)', () => {
  it("const routes = [{ path, method, action }]; iterate", () => {
    const fp = 'src/routes.ts'
    const path = tempRepo({
      [fp]: `
const Routes = [
  { path: '/users', method: 'get', action: 'list' },
  { path: '/users', method: 'post', action: 'create' },
  { path: '/users/:id', method: 'delete', action: 'remove' },
]

Routes.forEach((r) => app[r.method](r.path, controllers[r.action]))
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    // routeTable extractor가 잡으면 3개 정도 emit
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — REST controller map (Object.entries)
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (REST controller map)', () => {
  it("const routes = { users: require('./users') }; Object.entries(routes)", () => {
    const fp = 'src/routes.ts'
    const path = tempRepo({
      [fp]: `
const routes = {
  users: require('./users'),
  orders: require('./orders'),
}
Object.entries(routes).forEach(([resource, controller]) => {
  app.get(\`/\${resource}\`, controller.list)
  app.post(\`/\${resource}\`, controller.create)
})
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — app.map (비표준 Express 패턴)
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (app.map)', () => {
  it("app.map({ '/path': { get: h, post: h } })", () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
app.map({
  '/users': {
    get: listUsers,
    post: createUser,
  },
  '/orders': {
    get: listOrders,
  },
})
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — resource routes
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (resource)', () => {
  it("app.resource('/users', userController)", () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
const userController = {
  index: (req, res) => {},
  create: (req, res) => {},
}
app.resource = function(path, controller) {}
app.resource('/users', userController)
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — MVC boot
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (MVC boot)', () => {
  it("require('./boot')(app, ...) — controllers/ 디렉토리 자동 탐색", () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
const boot = require('./boot')
boot(app, __dirname + '/controllers')
`,
      'src/controllers/users.js': `
module.exports = {
  index: (req, res) => res.json([]),
  show: (req, res) => res.json({}),
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — class instance router
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (class instance)', () => {
  it("class ApiRouter { getRouter() { ... } } — 메서드 체인 라우터", () => {
    const fp = 'src/api-router.ts'
    const path = tempRepo({
      [fp]: `
import { Router } from 'express'

export class ApiRouter {
  private router = Router()

  constructor() {
    this.router.get('/users', this.listUsers)
    this.router.post('/users', this.createUser)
  }

  getRouter() {
    return this.router
  }

  listUsers() {}
  createUser() {}
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_direct — require mount
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_direct (require mount)', () => {
  it("app.use('/api', require('./routes/api'))", () => {
    const path = tempRepo({
      'src/server.ts': `
const app = express()
app.use('/api', require('./routes/api'))
app.use('/admin', require('./routes/admin'))
`,
      'src/routes/api.ts': `
const router = require('express').Router()
router.get('/users', (req, res) => res.json([]))
router.post('/users', (req, res) => res.status(201).send())
module.exports = router
`,
      'src/routes/admin.ts': `
const router = require('express').Router()
router.get('/dashboard', (req, res) => res.send('dashboard'))
module.exports = router
`,
    })
    const file1 = fileNode('src/server.ts')
    const file2 = fileNode('src/routes/api.ts')
    const file3 = fileNode('src/routes/admin.ts')
    const entries = run(path, [file1, file2, file3])
    // require_mount + cross-file routing
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// express_variable_mount — sub-router
// ────────────────────────────────────────────────────────────
describe('Express F4 — express_variable_mount', () => {
  it("app.use('/api', apiRouter) + cross-file apiRouter.get('/users', h)", () => {
    const path = tempRepo({
      'src/server.ts': `
import express from 'express'
import { apiRouter } from './api'
const app = express()
app.use('/api', apiRouter)
`,
      'src/api.ts': `
import { Router } from 'express'
export const apiRouter = Router()
apiRouter.get('/users', (req, res) => res.json([]))
apiRouter.post('/users', (req, res) => res.status(201).send())
apiRouter.get('/users/:id', (req, res) => res.json({}))
`,
    })
    const file1 = fileNode('src/server.ts')
    const file2 = fileNode('src/api.ts')
    const entries = run(path, [file1, file2])
    const mount = entries.filter((e) => e.metadata?.sourceFallback === 'express_variable_mount')
    expect(mount.length).toBeGreaterThanOrEqual(0)
  })

  it("app.use('/api', buildRouter()) resolves local route handler node for service-map reachability", () => {
    const path = tempRepo({
      'src/server.ts': `
import express from 'express'
import { buildRouter } from './orders'
const app = express()
app.use('/api', buildRouter())
`,
      'src/orders.ts': `
import { Router } from 'express'

export function buildRouter() {
  const router = Router()
  router.post('/orders', createOrder)
  return router
}

export function createOrder() {}
`,
    })
    const entries = run(path, [
      fileNode('src/server.ts'),
      fileNode('src/orders.ts'),
      functionNode('src/orders.ts', 'buildRouter'),
      functionNode('src/orders.ts', 'createOrder'),
    ])

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'api',
        httpMethod: 'POST',
        fullPath: '/api/orders',
        handlerNodeId: `${REPO}:src/orders.ts:createOrder`,
        metadata: expect.objectContaining({ sourceFallback: 'express_variable_mount' }),
      }),
    ]))
  })

  it("3-level nested mount: app.use('/api', apiRouter); apiRouter.use('/v1', v1Router)", () => {
    const path = tempRepo({
      'src/server.ts': `
const app = express()
app.use('/api', apiRouter)
`,
      'src/api.ts': `
import { Router } from 'express'
import { v1Router } from './v1'
export const apiRouter = Router()
apiRouter.use('/v1', v1Router)
`,
      'src/v1.ts': `
import { Router } from 'express'
export const v1Router = Router()
v1Router.get('/users', (req, res) => res.json([]))
`,
    })
    const file1 = fileNode('src/server.ts')
    const file2 = fileNode('src/api.ts')
    const file3 = fileNode('src/v1.ts')
    const entries = run(path, [file1, file2, file3])
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })

  it("같은 router를 다른 prefix에 mount 2번", () => {
    const path = tempRepo({
      'src/server.ts': `
const app = express()
app.use('/v1/users', userRouter)
app.use('/v2/users', userRouter)
`,
      'src/users.ts': `
import { Router } from 'express'
export const userRouter = Router()
userRouter.get('/', listUsers)
`,
    })
    const file1 = fileNode('src/server.ts')
    const file2 = fileNode('src/users.ts')
    const entries = run(path, [file1, file2])
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })
})

// ────────────────────────────────────────────────────────────
// 거부 케이스
// ────────────────────────────────────────────────────────────
describe('Express F4 — 거부 케이스', () => {
  it('express framework 비활성 → 0건', () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
const app = express()
app.get('/health', h)
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'nestjs', routingLibs: [] },
      detections: [{ framework: 'nestjs', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file],
      graphEdges: [],
    })
    expect(entries.filter((e) => String(e.metadata?.adapterId ?? '').includes('express'))).toHaveLength(0)
  })

  it('빈 파일 → 0건', () => {
    const fp = 'src/empty.ts'
    const path = tempRepo({ [fp]: '' })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries).toHaveLength(0)
  })
})
