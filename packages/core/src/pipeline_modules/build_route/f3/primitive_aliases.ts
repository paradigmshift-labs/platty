import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'

export interface PrimitiveAlias {
  wrapper: string
  primitive: string
  depth: number
  chain: string[]
  evidence: string[]
}

export interface DerivePrimitiveAliasesInput {
  graphNodes: CodeNode[]
  graphEdges: CodeEdge[]
  primitiveSymbols: string[]
  maxDepth: number
}

export interface DerivePrimitiveAliasesResult {
  aliases: Record<string, PrimitiveAlias>
  diagnostics: {
    cyclesSkipped: number
    unresolvedEdges: number
  }
}

export function derivePrimitiveAliases(input: DerivePrimitiveAliasesInput): DerivePrimitiveAliasesResult {
  const nodesById = new Map(input.graphNodes.map((node) => [node.id, node]))
  const aliases: Record<string, PrimitiveAlias> = {}
  const resolved = new Map<string, PrimitiveAlias>()
  const primitives = new Set(input.primitiveSymbols)
  let cyclesSkipped = 0
  let unresolvedEdges = 0

  for (const primitive of primitives) {
    resolved.set(primitive, {
      wrapper: primitive,
      primitive,
      depth: 0,
      chain: [primitive],
      evidence: [],
    })
  }

  for (let depth = 1; depth <= input.maxDepth; depth += 1) {
    let changed = false

    for (const edge of input.graphEdges) {
      if (edge.relation !== 'calls') continue

      const target = matchingResolvedTarget(edge, resolved)
      if (!target) {
        unresolvedEdges += 1
        continue
      }

      const sourceNode = nodesById.get(edge.sourceId)
      if (!sourceNode || sourceNode.type === 'file') continue
      const wrapper = sourceNode.name
      if (primitives.has(wrapper) || aliases[wrapper]) continue
      /* v8 ignore next 4 -- direct cycles are counted below; resolved aliases are skipped before this guard. */
      if (target.chain.includes(wrapper)) {
        cyclesSkipped += 1
        continue
      }

      const alias: PrimitiveAlias = {
        wrapper,
        primitive: target.primitive,
        depth,
        chain: [wrapper, ...target.chain],
        evidence: [
          `${wrapper} -> ${target.chain[0]}`,
          ...target.evidence,
        ],
      }
      aliases[wrapper] = alias
      resolved.set(wrapper, alias)
      changed = true
    }

    if (!changed) break
  }

  cyclesSkipped += countCallCycles(input.graphEdges, nodesById)

  return {
    aliases,
    diagnostics: {
      cyclesSkipped,
      unresolvedEdges,
    },
  }
}

function matchingResolvedTarget(
  edge: CodeEdge,
  resolved: Map<string, PrimitiveAlias>,
): PrimitiveAlias | null {
  const candidates = [
    edge.chainPath,
    edge.targetSymbol,
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const direct = resolved.get(candidate)
    if (direct) return direct
  }
  return null
}

function countCallCycles(edges: CodeEdge[], nodesById: Map<string, CodeNode>): number {
  const callTargets = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edge.relation !== 'calls' || !edge.targetSymbol) continue
    const source = nodesById.get(edge.sourceId)?.name
    if (!source) continue
    const targets = callTargets.get(source) ?? new Set<string>()
    targets.add(edge.targetSymbol)
    callTargets.set(source, targets)
  }

  let cycles = 0
  for (const [source, targets] of callTargets) {
    for (const target of targets) {
      if (callTargets.get(target)?.has(source)) cycles += 1
    }
  }
  return Math.floor(cycles / 2)
}
