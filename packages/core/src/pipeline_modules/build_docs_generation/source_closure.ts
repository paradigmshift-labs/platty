import { and, eq, inArray } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import type { RelationFactContext } from './types.js'

export interface SourceClosureInput {
  db: DB
  repoId: string
  seedNodeIds: string[]
  entryPointIds: string[]
  codeRelationFacts: RelationFactContext[]
  repoPath?: string | null
  maxHops?: number
}

export interface SourceClosureNode {
  nodeId: string
  hop: number
}

interface ClosureState {
  ordered: SourceClosureNode[]
  hops: Map<string, number>
}

// route 단위 소스 클로저 = build_route가 만든 번들(code_bundles) **그대로**.
// build_docs_generation은 도달성을 다시 계산하지 않는다. 예전엔 여기서 code_edges를 자체 BFS로
// 다시 walk하고 import/같은파일/type 토큰 클로저까지 union했는데, 그 set이 build_route의 단일
// 도달성 정의(canonical ROUTE_REACHABILITY_RELATIONS)와 손으로 따로 관리되며 표류했다
// (renders=화면발·resolves_to=DI/래퍼 누락). 단일 출처로 통일: 클로저는 번들 + 진입점 seed뿐.
//
// seed(진입점 노드)는 번들이 비어 있어도 최소한 핸들러를 보장하기 위해 hop 0으로 함께 넣는다
// (번들은 build_route가 seed로부터 만들므로 보통 seed를 이미 포함한다).
export function collectSourceClosure(input: SourceClosureInput): SourceClosureNode[] {
  const state = createClosureState()
  addMany(state, dedupe(input.seedNodeIds), 0)
  addClosureNodes(state, collectBundledNodes(input.db, input.repoId, input.entryPointIds))
  return state.ordered
}

export function collectBundledNodes(db: DB, repoId: string, entryPointIds: string[]): SourceClosureNode[] {
  if (entryPointIds.length === 0) return []
  const rows = db.select({
    nodeId: codeBundles.nodeId,
    depth: codeBundles.depth,
  })
    .from(codeBundles)
    .innerJoin(codeNodes, eq(codeNodes.id, codeBundles.nodeId))
    .innerJoin(entryPoints, eq(entryPoints.id, codeBundles.entryPointId))
    .where(and(
      eq(entryPoints.repoId, repoId),
      inArray(codeBundles.entryPointId, entryPointIds),
      eq(codeNodes.parseStatus, 'ok'),
    ))
    .all()

  const hops = new Map<string, number>()
  for (const row of rows) {
    hops.set(row.nodeId, Math.min(hops.get(row.nodeId) ?? row.depth, row.depth))
  }
  return [...hops.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([nodeId, hop]) => ({ nodeId, hop }))
}

function createClosureState(): ClosureState {
  return { ordered: [], hops: new Map() }
}

function addClosureNodes(state: ClosureState, nodes: SourceClosureNode[]): void {
  for (const node of nodes) addNode(state, node.nodeId, node.hop)
}

function addMany(state: ClosureState, ids: string[], hop: number): void {
  for (const id of ids) addNode(state, id, hop)
}

function addNode(state: ClosureState, nodeId: string, hop: number): boolean {
  const previous = state.hops.get(nodeId)
  if (previous != null) {
    if (hop < previous) state.hops.set(nodeId, hop)
    return false
  }
  state.hops.set(nodeId, hop)
  state.ordered.push({ nodeId, hop })
  return true
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}
