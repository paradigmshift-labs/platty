import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb, type DB } from '../../server/helpers.js'
import { codeRelations } from '@/db/schema/build_relations.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { projectPhaseStatus, projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { BuildDocsGenerationRuntime } from '@/pipeline_modules/build_docs/runtime/runtime.js'
import type { BuildDocsGenerationContextResponse } from '@/pipeline_modules/build_docs/runtime/types.js'

const now = '2026-06-02T00:00:00.000Z'

export interface ViennaChainFixture {
  db: DB
  repoRoot: string
  runtime: BuildDocsGenerationRuntime
  cleanup: () => void
}

export async function getApiContext(
  runtime: BuildDocsGenerationRuntime,
): Promise<BuildDocsGenerationContextResponse> {
  const task = await leaseApiTask(runtime)
  return runtime.getContext({
    taskId: task.task_id,
    leaseToken: task.lease_token,
  })
}

export async function leaseApiTask(runtime: BuildDocsGenerationRuntime): Promise<{
  task_id: string
  lease_token: string
}> {
  const start = await runtime.start({
    projectId: 'project:vienna-chain',
    outputLanguage: 'ko',
    requestedBy: 'user:test',
  })
  await runtime.approve({
    runId: start.run_id,
    maxConcurrentTasks: 1,
    approvedBy: 'user:test',
  })
  const task = await runtime.leaseTask({
    runId: start.run_id,
    workerId: 'worker:api-docs',
    documentTypes: ['api_spec'],
  })
  if (task.type !== 'task') throw new Error(`expected task lease, got ${task.type}`)
  return task
}

export function createViennaChainFixture(): ViennaChainFixture {
  const repoRoot = mkdtempSync(join(tmpdir(), 'platty-docs-vienna-chain-'))
  writeViennaChainSources(repoRoot)

  const db = createTestDb()
  db.insert(projects).values({
    id: 'project:vienna-chain',
    name: 'Vienna Chain Fixture',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(repositories).values({
    id: 'repo:api',
    projectId: 'project:vienna-chain',
    name: 'api-service',
    repoPath: repoRoot,
    framework: 'nestjs',
    analysisBranch: 'main',
    lastSyncedCommit: 'commit:vienna-chain',
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(codeNodes).values([
    node('node:controller:getOrder', 'method', 'src/orders/order.controller.ts', 'OrderController.getOrder', 5, 10, 'OrderController.getOrder(params: OrderRequestDto)'),
    node('node:service:getOrder', 'method', 'src/orders/order.service.ts', 'OrderService.getOrder', 5, 11, 'OrderService.getOrder(orderId: string, includeItems: boolean)'),
    node('node:repo:findById', 'method', 'src/orders/order.repository.ts', 'OrderRepository.findById', 3, 8, 'OrderRepository.findById(orderId: string, includeItems: boolean)'),
    node('node:mapper:mapOrderResponse', 'function', 'src/orders/order.mapper.ts', 'mapOrderResponse', 4, 9, 'mapOrderResponse(order: Order): OrderResponseDto'),
    node('node:helper:okResponse', 'function', 'src/shared/response.ts', 'okResponse', 1, 3, 'okResponse<T>(payload: T): T'),
    node('node:dto:OrderRequestDto', 'class', 'src/orders/order.dto.ts', 'OrderRequestDto', 1, 4, 'class OrderRequestDto'),
    node('node:dto:OrderResponseDto', 'class', 'src/orders/order.dto.ts', 'OrderResponseDto', 6, 10, 'class OrderResponseDto'),
    node('node:repo:selectFields', 'variable', 'src/orders/order.repository.ts', 'selectFields', 1, 1, 'const selectFields'),
  ]).run()
  db.insert(entryPoints).values({
    id: 'ep:api:getOrder',
    repoId: 'repo:api',
    framework: 'nestjs',
    kind: 'api',
    httpMethod: 'GET',
    path: '/api/orders/:orderId',
    fullPath: '/api/orders/:orderId',
    handlerNodeId: 'node:controller:getOrder',
    metadata: {},
    detectionSource: 'rule:test',
    confidence: 'high',
    detectionEvidence: { matchedNodeIds: ['node:controller:getOrder'] },
    createdAt: now,
  }).run()
  // build_route가 canonical 도달성으로 이 진입점에서 실제 산출하는 번들 (아래 codeEdges를 BFS):
  // controller(0) → service·OrderRequestDto(1) → repo·mapper(2) → selectFields·okResponse·OrderResponseDto(3).
  // build_docs_generation은 이 번들만 보고 소스 클로저를 만든다(자체 재-walk 없음).
  db.insert(codeBundles).values([
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:controller:getOrder', depth: 0, edgePath: ['node:controller:getOrder'] },
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:service:getOrder', depth: 1, edgePath: ['node:controller:getOrder', 'node:service:getOrder'] },
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:dto:OrderRequestDto', depth: 1, edgePath: ['node:controller:getOrder', 'node:dto:OrderRequestDto'] },
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:repo:findById', depth: 2, edgePath: ['node:controller:getOrder', 'node:service:getOrder', 'node:repo:findById'] },
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:mapper:mapOrderResponse', depth: 2, edgePath: ['node:controller:getOrder', 'node:service:getOrder', 'node:mapper:mapOrderResponse'] },
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:repo:selectFields', depth: 3, edgePath: ['node:controller:getOrder', 'node:service:getOrder', 'node:repo:findById', 'node:repo:selectFields'] },
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:helper:okResponse', depth: 3, edgePath: ['node:controller:getOrder', 'node:service:getOrder', 'node:mapper:mapOrderResponse', 'node:helper:okResponse'] },
    { entryPointId: 'ep:api:getOrder', nodeId: 'node:dto:OrderResponseDto', depth: 3, edgePath: ['node:controller:getOrder', 'node:service:getOrder', 'node:mapper:mapOrderResponse', 'node:dto:OrderResponseDto'] },
  ]).run()
  db.insert(codeEdges).values([
    edge('node:controller:getOrder', 'node:service:getOrder', 'calls', 'OrderService.getOrder'),
    edge('node:controller:getOrder', 'node:dto:OrderRequestDto', 'type_ref', 'OrderRequestDto'),
    edge('node:service:getOrder', 'node:repo:findById', 'calls', 'OrderRepository.findById'),
    edge('node:service:getOrder', 'node:mapper:mapOrderResponse', 'calls', 'mapOrderResponse'),
    edge('node:repo:findById', 'node:repo:selectFields', 'depends_on', 'selectFields'),
    edge('node:mapper:mapOrderResponse', 'node:helper:okResponse', 'calls', 'okResponse'),
    edge('node:mapper:mapOrderResponse', 'node:dto:OrderResponseDto', 'type_ref', 'OrderResponseDto'),
  ]).run()
  db.insert(codeRelations).values({
    id: 'rel:api:getOrder:orders',
    repoId: 'repo:api',
    sourceNodeId: 'node:controller:getOrder',
    kind: 'db_access',
    target: 'orders',
    operation: 'select',
    canonicalTarget: 'db:orders:select',
    payload: { table: 'orders' },
    evidenceNodeIds: ['node:repo:findById'],
    confidence: 'high',
    createdAt: now,
  }).run()
  seedRequiredRepositoryPhases(db)
  seedServiceMapPhase(db)

  return {
    db,
    repoRoot,
    runtime: new BuildDocsGenerationRuntime({ db }),
    cleanup: () => {
      if (existsSync(repoRoot)) rmSync(repoRoot, { recursive: true, force: true })
    },
  }
}

function writeViennaChainSources(repoRoot: string): void {
  const ordersDir = join(repoRoot, 'src/orders')
  const sharedDir = join(repoRoot, 'src/shared')
  mkdirSync(ordersDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })
  writeFileSync(join(ordersDir, 'order.controller.ts'), [
    'import { OrderService } from "./order.service"',
    'import { OrderRequestDto } from "./order.dto"',
    'import { mapOrderResponse } from "./order.mapper"',
    '',
    'export class OrderController {',
    '  async getOrder(params: OrderRequestDto) {',
    '    const order = await OrderService.getOrder(params.orderId, params.includeItems)',
    '    return mapOrderResponse(order)',
    '  }',
    '}',
  ].join('\n'), 'utf8')
  writeFileSync(join(ordersDir, 'order.service.ts'), [
    'import { OrderRepository } from "./order.repository"',
    'import { mapOrderResponse } from "./order.mapper"',
    '',
    'export class OrderService {',
    '  static async getOrder(orderId: string, includeItems: boolean) {',
    '    const order = await OrderRepository.findById(orderId, includeItems)',
    '    return mapOrderResponse(order)',
    '  }',
    '}',
    '',
    'export const unrelatedServiceValue = true',
  ].join('\n'), 'utf8')
  writeFileSync(join(ordersDir, 'order.repository.ts'), [
    'const selectFields = { id: true, status: true, total: true }',
    '',
    'export class OrderRepository {',
    '  static async findById(orderId: string, includeItems: boolean) {',
    '    return db.order.findUnique({',
    '      where: { id: orderId },',
    '      select: selectFields,',
    '      include: includeItems ? { items: true } : undefined,',
    '    })',
    '  }',
    '}',
  ].join('\n'), 'utf8')
  writeFileSync(join(ordersDir, 'order.mapper.ts'), [
    'import { okResponse } from "../shared/response"',
    'import { OrderResponseDto } from "./order.dto"',
    '',
    'export function mapOrderResponse(order: Order): OrderResponseDto {',
    '  const { id, status, total } = order',
    '  const payload = (() => {',
    '    return { id, status, total }',
    '  })()',
    '  return okResponse<OrderResponseDto>(payload)',
    '}',
  ].join('\n'), 'utf8')
  writeFileSync(join(ordersDir, 'order.dto.ts'), [
    'export class OrderRequestDto {',
    '  orderId!: string',
    '  includeItems = false',
    '}',
    '',
    'export class OrderResponseDto {',
    '  id!: string',
    '  status!: string',
    '  total!: number',
    '}',
  ].join('\n'), 'utf8')
  writeFileSync(join(sharedDir, 'response.ts'), [
    'export function okResponse<T>(payload: T): T {',
    '  return payload',
    '}',
  ].join('\n'), 'utf8')
}

function node(
  id: string,
  type: 'class' | 'function' | 'method' | 'variable',
  filePath: string,
  name: string,
  lineStart: number,
  lineEnd: number,
  signature: string,
) {
  return {
    id,
    repoId: 'repo:api',
    type,
    filePath,
    name,
    lineStart,
    lineEnd,
    signature,
    docComment: null,
    exported: true,
    isDefaultExport: false,
    isAsync: signature.includes('async'),
    isTest: false,
    parseStatus: 'ok' as const,
    createdAt: now,
  }
}

function edge(
  sourceId: string,
  targetId: string,
  relation: 'calls' | 'depends_on' | 'type_ref',
  targetSymbol: string,
) {
  return {
    repoId: 'repo:api',
    sourceId,
    targetId,
    relation,
    targetSpecifier: targetSymbol,
    targetSymbol,
    chainPath: targetSymbol,
    resolveStatus: 'resolved' as const,
    confidence: 'high' as const,
    source: 'static' as const,
    createdAt: now,
  }
}

function seedRequiredRepositoryPhases(db: DB): void {
  const phases = ['build_graph', 'build_pattern_profile', 'build_models', 'build_route', 'build_relations'] as const
  db.insert(repositoryPhaseStatus).values(phases.map((phase) => ({
    repositoryId: 'repo:api',
    phase,
    builtAt: phase === 'build_relations' ? now : '2026-06-01T00:00:00.000Z',
    builtFromCommit: 'commit:vienna-chain',
    confirmedAt: phase === 'build_route' ? '2026-06-02T01:00:00.000Z' : null,
    validity: 'fresh' as const,
    status: 'passed' as const,
    sourceRunId: `run:repo:api:${phase}`,
    sourceCommit: 'commit:vienna-chain',
    updatedAt: now,
  }))).run()
}

function seedServiceMapPhase(db: DB): void {
  db.insert(projectPhaseStatus).values({
    projectId: 'project:vienna-chain',
    phase: 'build_service_map',
    status: 'passed',
    sourceRunId: 'run:service-map',
    sourceCommit: 'commit:service-map',
    updatedAt: Date.parse('2026-06-03T00:00:00.000Z'),
    upstreamVersions: null,
    meta: null,
  }).run()
}
