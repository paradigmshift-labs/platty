// f3/sub_router_mounter — Express mount prefix 계산 (architecture.md §4.3, spec §5.3).
// pure(graph) — mountMap + 적용 결과 반환. 그래프 mutation 안 함.

import type { CodeEdge } from '@/db/schema/code_graph.js'
import type { GraphIndex } from '../graph_index.js'
import type { MountResult } from '../types.js'

const MAX_ITER = 10

interface LiteralArg {
  kind: string
  value: unknown
}

export function mountSubRouters(graph: GraphIndex): MountResult {
  const mountMap = new Map<string, string>()
  const mountEvidence = new Map<string, { nodeIds: string[]; edgeIds: number[] }>()
  const dynamicSet = new Set<string>()

  const mountEdges = graph
    .edgesByRelation('calls')
    .filter((edge) => edge.targetSymbol === 'use' || edge.targetSymbol === 'register')

  // 토폴로지: 다단 mount는 parent prefix가 결정된 후 자식 prefix 계산.
  // 여러 패스 fixed-point 반복.
  let changed = true
  let iter = 0
  while (changed && iter < MAX_ITER) {
    changed = false
    iter++
    for (const mountEdge of mountEdges) {
      const mount = parseMount(mountEdge)
      if (!mount) continue
      if (!mount.mountedName) {
        if (iter === 1) dynamicSet.add(mountEdge.sourceId)
        continue
      }
      let parentPrefix = ''
      if (mountEdge.chainPath) {
        const root = mountEdge.chainPath.split('.')[0]
        parentPrefix = mountMap.get(root) ?? ''
      }
      const fullPrefix = parentPrefix + mount.prefix
      if (mountMap.get(mount.mountedName) !== fullPrefix) {
        mountMap.set(mount.mountedName, fullPrefix)
        const parentEvidence = mountEdge.chainPath ? mountEvidence.get(mountEdge.chainPath.split('.')[0]) : undefined
        mountEvidence.set(mount.mountedName, {
          nodeIds: dedupe([...(parentEvidence?.nodeIds ?? []), mountEdge.sourceId]),
          edgeIds: dedupeNumbers([...(parentEvidence?.edgeIds ?? []), mountEdge.id]),
        })
        changed = true
      }
    }
  }

  // router 변수의 calls (mount 자체 제외) 에 prefix 매핑
  const prefixByCallEdgeId = new Map<number, string>()
  const evidenceByCallEdgeId = new Map<number, { nodeIds: string[]; edgeIds: number[] }>()
  for (const call of graph.edgesByRelation('calls')) {
    if (call.targetSymbol === 'use' || call.targetSymbol === 'register') continue
    if (!call.chainPath) continue
    const root = call.chainPath.split('.')[0]
    const sourceNodeName = graph.getNode(call.sourceId)?.name
    const evidenceKey = mountMap.has(root) ? root : sourceNodeName && mountMap.has(sourceNodeName) ? sourceNodeName : null
    const prefix = evidenceKey ? mountMap.get(evidenceKey) : undefined
    if (prefix !== undefined) {
      prefixByCallEdgeId.set(call.id, prefix)
      const evidence = evidenceKey ? mountEvidence.get(evidenceKey) : undefined
      if (evidence) evidenceByCallEdgeId.set(call.id, evidence)
    }
  }

  return {
    mountMap,
    prefixByCallEdgeId,
    evidenceByCallEdgeId,
    dynamicMountSources: Array.from(dynamicSet),
  }
}

function parseMount(edge: CodeEdge): { prefix: string; mountedName: string | null } | null {
  if (edge.targetSymbol === 'use') {
    if (edge.firstArg === null) return null
    const args = parseLiteralArgs(edge.literalArgs)
    if (!args || args.length < 2) return null
    const second = args[1]
    return {
      prefix: edge.firstArg,
      mountedName: isIdentifier(second) ? String(second.value) : null,
    }
  }

  if (edge.targetSymbol === 'register') {
    const args = parseArgExpressions(edge.argExpressions)
    if (!args || args.length < 2) return null
    const mountedName = argIdentifier(args[0])
    const prefix = objectStringProperty(args[1], 'prefix')
    if (!prefix) return null
    return { prefix, mountedName }
  }

  return null
}

function parseLiteralArgs(raw: string | null): LiteralArg[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isIdentifier(arg: unknown): arg is { kind: 'identifier'; value: string } {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    (arg as { kind?: unknown }).kind === 'identifier' &&
    typeof (arg as { value?: unknown }).value === 'string'
  )
}

type ArgExpression = {
  kind?: unknown
  raw?: unknown
  value?: unknown
  staticPattern?: unknown
  properties?: Record<string, ArgExpression>
}

function parseArgExpressions(raw: unknown): ArgExpression[] | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw as ArgExpression[]
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as ArgExpression[] : null
  } catch {
    return null
  }
}

function argIdentifier(arg: ArgExpression | undefined): string | null {
  if (!arg) return null
  if ((arg.kind === 'identifier' || arg.kind === 'member') && typeof arg.raw === 'string') return arg.raw.split('.').at(-1) ?? null
  return null
}

function objectStringProperty(arg: ArgExpression | undefined, key: string): string | null {
  const property = arg?.properties?.[key]
  if (!property) return null
  if (typeof property.value === 'string') return property.value
  if (typeof property.staticPattern === 'string' && !property.staticPattern.includes(':')) return property.staticPattern
  return null
}

function dedupe(values: string[]): string[] {
  return values.filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
}

function dedupeNumbers(values: number[]): number[] {
  return values.filter((value, index, all) => all.indexOf(value) === index)
}
