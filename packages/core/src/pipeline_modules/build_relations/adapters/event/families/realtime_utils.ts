import type { CallArgExpression, CodeEdgeLike, SemanticIndex } from '../../../types.js'

export function sourceIdsForNode(nodeId: string, index: SemanticIndex): string[] {
  const node = index.nodesById.get(nodeId)
  return [
    nodeId,
    ...(node ? (index.nodesByFile.get(node.filePath) ?? []).map((fileNode) => fileNode.id) : []),
  ]
}

export function readStringArg(call: CodeEdgeLike, index: number): string | null {
  const expressions = Array.isArray(call.argExpressions)
    ? call.argExpressions as CallArgExpression[]
    : []
  const graphArg = expressions.find((arg) => arg.index === index)
  if (graphArg?.kind === 'string' && graphArg.value) return graphArg.value
  if (graphArg?.resolved?.kind === 'string' && graphArg.resolved.value) return graphArg.resolved.value

  const parsed = parseLiteralArgs(call.literalArgs)
  const value = parsed[index]
  return typeof value === 'string' ? value : null
}

export function isStaticRealtimeName(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(value)
}

export function normalizeMemberChainPath(chainPath: string): string {
  return chainPath.replace(/\s*\.\s*/g, '.').trim()
}

export function parseLiteralArgs(literalArgs: string | null | undefined): unknown[] {
  if (!literalArgs) return []
  try {
    const parsed = JSON.parse(literalArgs)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
