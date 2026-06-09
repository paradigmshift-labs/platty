// NestJS F4 source fallback — 실사례 시나리오 맥시멈
//
// 10개 어댑터 (nestjs_nestia/controller/schedule/graphql/bull/event_emitter/
// cqrs/websocket/microservice/grpc) — 각각의 패턴 변형을 다수 다룬다.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { buildSourceFallbackEntries } from '@/pipeline_modules/build_route/f4_evaluate_source_fallbacks.js'
import type { FrameworkDetectionResult } from '@/pipeline_modules/build_route/types.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nestjs-f4-'))
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

function methodNode(filePath: string, qualifiedName: string): CodeNode {
  return {
    id: `${REPO}:${filePath}:${qualifiedName}`,
    repoId: REPO,
    type: 'method',
    filePath,
    name: qualifiedName.split('.').pop() ?? qualifiedName,
    lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-15',
  }
}

function detections(framework: string): FrameworkDetectionResult[] {
  return [{ framework, detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }]
}

function run(repoPath: string, nodes: CodeNode[], edges: CodeEdge[] = []) {
  return buildSourceFallbackEntries({
    repoPath, repoId: REPO,
    stackInfo: { framework: 'nestjs', routingLibs: [] },
    detections: detections('nestjs'),
    graphNodes: nodes,
    graphEdges: edges,
  })
}

// ────────────────────────────────────────────────────────────
// nestjs_controller — @Controller + @Get/@Post/etc
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_controller', () => {
  it('@Controller("users") + @Get(":id") → /users/:id GET', () => {
    const fp = 'src/users.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get } from '@nestjs/common'

@Controller('users')
export class UsersController {
  @Get(':id')
  findOne() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'UsersController.findOne')
    const entries = run(path, [file, handler])
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl.length).toBeGreaterThanOrEqual(1)
    expect(ctrl[0].fullPath).toBe('/users/:id')
    expect(ctrl[0].httpMethod).toBe('GET')
  })

  it('@Controller("/api/v1/orders") with leading slash + multi-segment', () => {
    const fp = 'src/orders.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get, Post } from '@nestjs/common'

@Controller('/api/v1/orders')
export class OrdersController {
  @Get()
  list() {}

  @Post()
  create() {}
}
`,
    })
    const file = fileNode(fp)
    const listH = methodNode(fp, 'OrdersController.list')
    const createH = methodNode(fp, 'OrdersController.create')
    const entries = run(path, [file, listH, createH])
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    const sorted = ctrl.map((ep) => `${ep.httpMethod} ${ep.fullPath}`).sort()
    expect(sorted).toEqual(['GET /api/v1/orders', 'POST /api/v1/orders'])
  })

  it('@Controller() (인자 없음) + @Get() → /', () => {
    const fp = 'src/health.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get } from '@nestjs/common'

@Controller()
export class HealthController {
  @Get()
  ping() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'HealthController.ping')
    const entries = run(path, [file, handler])
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl.length).toBeGreaterThanOrEqual(1)
    expect(ctrl[0].fullPath).toBe('/')
  })

  it('CRUD 5개 method 한 controller에서 추출', () => {
    const fp = 'src/cats.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get, Post, Put, Patch, Delete } from '@nestjs/common'

@Controller('cats')
export class CatsController {
  @Get() findAll() {}
  @Get(':id') findOne() {}
  @Post() create() {}
  @Put(':id') update() {}
  @Delete(':id') remove() {}
}
`,
    })
    const file = fileNode(fp)
    const handlers = [
      methodNode(fp, 'CatsController.findAll'),
      methodNode(fp, 'CatsController.findOne'),
      methodNode(fp, 'CatsController.create'),
      methodNode(fp, 'CatsController.update'),
      methodNode(fp, 'CatsController.remove'),
    ]
    const entries = run(path, [file, ...handlers])
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl.length).toBeGreaterThanOrEqual(5)
  })

  it('@HttpCode + @Get 동시 사용 — @Get만 카운트', () => {
    const fp = 'src/x.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get, HttpCode } from '@nestjs/common'

@Controller('items')
export class ItemsController {
  @HttpCode(204)
  @Get(':id')
  noContent() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'ItemsController.noContent')
    const entries = run(path, [file, handler])
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl.length).toBeGreaterThanOrEqual(1)
    expect(ctrl[0].httpMethod).toBe('GET')
  })

  it('@Version method-level overrides @Controller version', () => {
    const fp = 'src/versioned.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get, Version } from '@nestjs/common'

@Controller({ path: 'users', version: '1' })
export class UsersController {
  @Version('2')
  @Get(':id')
  findOne() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'UsersController.findOne')
    const entries = run(path, [file, handler])
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl).toHaveLength(1)
    expect(ctrl[0]).toMatchObject({
      fullPath: '/v2/users/:id',
      metadata: { version: '2', versionSource: 'method' },
    })
  })

  it('@Version also works after the route decorator', () => {
    const fp = 'src/versioned.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get, Version } from '@nestjs/common'

@Controller({ path: 'users', version: '1' })
export class UsersController {
  @Get(':id')
  @Version('3')
  findOne() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'UsersController.findOne')
    const entries = run(path, [file, handler])
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl).toHaveLength(1)
    expect(ctrl[0]).toMatchObject({
      fullPath: '/v3/users/:id',
      metadata: { version: '3', versionSource: 'method' },
    })
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_nestia — @TypedRoute.*
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_nestia (TypedRoute)', () => {
  it('@TypedRoute.Get → GET', () => {
    const fp = 'src/n.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller } from '@nestjs/common'
import { TypedRoute } from '@nestia/core'

@Controller('/typed')
export class TypedController {
  @TypedRoute.Get('/:id')
  one() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'TypedController.one')
    const entries = run(path, [file, handler])
    const nestia = entries.filter((e) => e.metadata?.adapterId === 'nestjs_nestia')
    expect(nestia.length).toBeGreaterThanOrEqual(1)
    expect(nestia[0].httpMethod).toBe('GET')
  })

  it('@TypedRoute.Post → POST', () => {
    const fp = 'src/n.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller } from '@nestjs/common'
import { TypedRoute } from '@nestia/core'

@Controller('/typed')
export class TypedController {
  @TypedRoute.Post()
  create() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'TypedController.create')
    const entries = run(path, [file, handler])
    const nestia = entries.filter((e) => e.metadata?.adapterId === 'nestjs_nestia')
    expect(nestia[0].httpMethod).toBe('POST')
  })

  it('@TypedRoute.Get respects method-level @Version override', () => {
    const fp = 'src/n.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Version } from '@nestjs/common'
import { TypedRoute } from '@nestia/core'

@Controller({ path: '/typed', version: '1' })
export class TypedController {
  @Version('2')
  @TypedRoute.Get('/:id')
  one() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'TypedController.one')
    const entries = run(path, [file, handler])
    const nestia = entries.filter((e) => e.metadata?.adapterId === 'nestjs_nestia')
    expect(nestia).toHaveLength(1)
    expect(nestia[0]).toMatchObject({
      fullPath: '/v2/typed/:id',
      metadata: { version: '2', versionSource: 'method' },
    })
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_websocket — @SubscribeMessage
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_websocket', () => {
  it("@WebSocketGateway + @SubscribeMessage('event') → WS event", () => {
    const fp = 'src/chat.gateway.ts'
    const path = tempRepo({
      [fp]: `
import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets'

@WebSocketGateway()
export class ChatGateway {
  @SubscribeMessage('message')
  onMessage() {}

  @SubscribeMessage('typing')
  onTyping() {}
}
`,
    })
    const file = fileNode(fp)
    const messageH = methodNode(fp, 'ChatGateway.onMessage')
    const typingH = methodNode(fp, 'ChatGateway.onTyping')
    const entries = run(path, [file, messageH, typingH])
    const ws = entries.filter((e) => e.metadata?.adapterId === 'nestjs_websocket')
    expect(ws.length).toBeGreaterThanOrEqual(2)
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_event_emitter — @OnEvent
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_event_emitter', () => {
  it("@OnEvent('user.created') → event handler", () => {
    const fp = 'src/listener.ts'
    const path = tempRepo({
      [fp]: `
import { Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'

@Injectable()
export class UserListener {
  @OnEvent('user.created')
  onUserCreated() {}

  @OnEvent('user.deleted')
  onUserDeleted() {}
}
`,
    })
    const file = fileNode(fp)
    const h1 = methodNode(fp, 'UserListener.onUserCreated')
    const h2 = methodNode(fp, 'UserListener.onUserDeleted')
    const entries = run(path, [file, h1, h2])
    const ev = entries.filter((e) => e.metadata?.adapterId === 'nestjs_event_emitter')
    expect(ev.length).toBeGreaterThanOrEqual(2)
  })

  it("@OnEvent with wildcard ('order.*')", () => {
    const fp = 'src/listener.ts'
    const path = tempRepo({
      [fp]: `
import { OnEvent } from '@nestjs/event-emitter'

export class WildcardListener {
  @OnEvent('order.*')
  onOrder() {}
}
`,
    })
    const file = fileNode(fp)
    const h = methodNode(fp, 'WildcardListener.onOrder')
    const entries = run(path, [file, h])
    const ev = entries.filter((e) => e.metadata?.adapterId === 'nestjs_event_emitter')
    expect(ev.length).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_bull — @Processor + @Process
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_bull', () => {
  it("@Processor('email') + @Process → job entry", () => {
    const fp = 'src/email.processor.ts'
    const path = tempRepo({
      [fp]: `
import { Processor, Process } from '@nestjs/bull'

@Processor('email')
export class EmailProcessor {
  @Process()
  handle() {}

  @Process('high-priority')
  handleHighPriority() {}
}
`,
    })
    const file = fileNode(fp)
    const h1 = methodNode(fp, 'EmailProcessor.handle')
    const h2 = methodNode(fp, 'EmailProcessor.handleHighPriority')
    const entries = run(path, [file, h1, h2])
    const bull = entries.filter((e) => e.metadata?.adapterId === 'nestjs_bull')
    expect(bull.length).toBeGreaterThanOrEqual(2)
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_microservice — @MessagePattern / @EventPattern
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_microservice', () => {
  it("@MessagePattern + @EventPattern", () => {
    const fp = 'src/orders.ms.ts'
    const path = tempRepo({
      [fp]: `
import { Controller } from '@nestjs/common'
import { MessagePattern, EventPattern } from '@nestjs/microservices'

@Controller()
export class OrdersMSController {
  @MessagePattern({ cmd: 'sum' })
  sum() {}

  @EventPattern('order.created')
  onOrderCreated() {}
}
`,
    })
    const file = fileNode(fp)
    const h1 = methodNode(fp, 'OrdersMSController.sum')
    const h2 = methodNode(fp, 'OrdersMSController.onOrderCreated')
    const entries = run(path, [file, h1, h2])
    const ms = entries.filter((e) => e.metadata?.adapterId === 'nestjs_microservice')
    expect(ms.length).toBeGreaterThanOrEqual(2)
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_grpc — @GrpcMethod
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_grpc', () => {
  it("@GrpcMethod('UserService', 'FindOne')", () => {
    const fp = 'src/users.grpc.ts'
    const path = tempRepo({
      [fp]: `
import { Controller } from '@nestjs/common'
import { GrpcMethod } from '@nestjs/microservices'

@Controller()
export class UsersGrpcController {
  @GrpcMethod('UserService', 'FindOne')
  findOne() {}

  @GrpcMethod('UserService')
  findAll() {}
}
`,
    })
    const file = fileNode(fp)
    const h1 = methodNode(fp, 'UsersGrpcController.findOne')
    const h2 = methodNode(fp, 'UsersGrpcController.findAll')
    const entries = run(path, [file, h1, h2])
    const grpc = entries.filter((e) => e.metadata?.adapterId === 'nestjs_grpc')
    expect(grpc.length).toBeGreaterThanOrEqual(2)
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_cqrs — @CommandHandler / @QueryHandler / @EventHandler / @Saga
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_cqrs', () => {
  it("@CommandHandler(CreateUserCommand)", () => {
    const fp = 'src/handlers/create-user.handler.ts'
    const path = tempRepo({
      [fp]: `
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { CreateUserCommand } from '../commands/create-user.command'

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  async execute() {}
}
`,
    })
    const file = fileNode(fp)
    const h = methodNode(fp, 'CreateUserHandler.execute')
    const entries = run(path, [file, h])
    const cqrs = entries.filter((e) => e.metadata?.adapterId === 'nestjs_cqrs')
    expect(cqrs.length).toBeGreaterThanOrEqual(1)
    expect(cqrs[0]?.handlerNodeId).toBe(h.id)
  })

  it("@QueryHandler + @EventsHandler 동시 추출", () => {
    const fp = 'src/handlers.ts'
    const path = tempRepo({
      [fp]: `
import { QueryHandler, EventsHandler } from '@nestjs/cqrs'

@QueryHandler(GetUserQuery)
export class GetUserHandler {
  async execute() {}
}

@EventsHandler(UserCreatedEvent)
export class UserCreatedHandler {
  async handle() {}
}
`,
    })
    const file = fileNode(fp)
    const h1 = methodNode(fp, 'GetUserHandler.execute')
    const h2 = methodNode(fp, 'UserCreatedHandler.handle')
    const entries = run(path, [file, h1, h2])
    const cqrs = entries.filter((e) => e.metadata?.adapterId === 'nestjs_cqrs')
    expect(cqrs.length).toBeGreaterThanOrEqual(2)
  })
})

// ────────────────────────────────────────────────────────────
// nestjs_graphql — @Query / @Mutation / @Subscription
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — nestjs_graphql', () => {
  it("@Resolver + @Query / @Mutation / @Subscription", () => {
    const fp = 'src/users.resolver.ts'
    const path = tempRepo({
      [fp]: `
import { Resolver, Query, Mutation, Subscription } from '@nestjs/graphql'

@Resolver()
export class UsersResolver {
  @Query(() => [User])
  users() {}

  @Mutation(() => User)
  createUser() {}

  @Subscription(() => User)
  userCreated() {}
}
`,
    })
    const file = fileNode(fp)
    const h1 = methodNode(fp, 'UsersResolver.users')
    const h2 = methodNode(fp, 'UsersResolver.createUser')
    const h3 = methodNode(fp, 'UsersResolver.userCreated')
    const entries = run(path, [file, h1, h2, h3])
    const gql = entries.filter((e) => e.metadata?.adapterId === 'nestjs_graphql')
    expect(gql.length).toBeGreaterThanOrEqual(3)
  })
})

// ────────────────────────────────────────────────────────────
// 거부 케이스 — 비-NestJS framework
// ────────────────────────────────────────────────────────────
describe('NestJS F4 — 거부 케이스', () => {
  it('framework가 nestjs 아니면 nestjs 어댑터들 inactive → 0건', () => {
    const fp = 'src/x.controller.ts'
    const path = tempRepo({
      [fp]: `
@Controller('test')
export class X {
  @Get() y() {}
}
`,
    })
    const file = fileNode(fp)
    const h = methodNode(fp, 'X.y')
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [{ framework: 'express', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file, h],
      graphEdges: [],
    })
    expect(entries.filter((e) => String(e.metadata?.adapterId ?? '').startsWith('nestjs'))).toHaveLength(0)
  })
})
