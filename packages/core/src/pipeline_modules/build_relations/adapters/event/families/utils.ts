import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import type { EventDecorator } from './types.js'

export function eventCallCandidate(
  sourceNodeId: string,
  call: { id: number; targetSymbol: string | null; chainPath: string | null; firstArg: string | null },
  broker: string,
  direction = 'publish',
): RelationCandidate {
  return {
    kind: 'event',
    sourceNodeId,
    evidenceNodeIds: [`edge:${call.id}`],
    targetSymbol: call.targetSymbol,
    chainPath: call.chainPath,
    firstArg: call.firstArg,
    payload: { broker, direction, adapter: 'event_broker' },
  }
}

export function hasPackageImport(
  nodeId: string,
  index: SemanticIndex,
  packageName: string,
): boolean {
  return collectPackageImportsForNode(nodeId, index).has(packageName)
}

export function collectPackageImportsForNode(
  nodeId: string,
  index: SemanticIndex,
): ReadonlySet<string> {
  const node = index.nodesById.get(nodeId)
  const fileNodes = node ? (index.nodesByFile.get(node.filePath) ?? []) : []
  const packages = new Set<string>()

  for (const fileNode of fileNodes) {
    for (const imp of index.importsBySource.get(fileNode.id) ?? []) {
      if (imp.targetSpecifier) packages.add(imp.targetSpecifier)
    }
  }

  return packages
}

export function decoratorsWithParentClass(
  nodeId: string,
  index: SemanticIndex,
): EventDecorator[] {
  const direct = index.decoratorsBySource.get(nodeId) ?? []
  const parentClassId = index.containsParentByChild.get(nodeId)
  if (!parentClassId) return direct
  return [...direct, ...(index.decoratorsBySource.get(parentClassId) ?? [])]
}

export function parseFirstObject(literalArgs: string | null | undefined): Record<string, unknown> | null {
  const parsed = parseLiteralArgs(literalArgs)
  const [first] = parsed
  return isRecord(first) ? first : null
}

export function parseLiteralArgs(literalArgs: string | null | undefined): unknown[] {
  if (!literalArgs) return []
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function findDecoratorArg(
  decorators: Array<{ targetSymbol: string | null; firstArg: string | null }>,
  symbol: string,
): string | null {
  return decorators.find((d) => d.targetSymbol === symbol)?.firstArg ?? null
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function collectStringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>()
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g)) {
    if (match[1] && match[2]) constants.set(match[1], match[2])
  }
  return constants
}

export function resolveObjectStringProperty(
  objectBody: string,
  property: string,
  constants: Map<string, string>,
): string | null {
  const literal = objectBody.match(new RegExp(`\\b${property}\\s*:\\s*['"]([^'"]+)['"]`))?.[1]
  if (literal) return literal

  const identifier = objectBody.match(new RegExp(`\\b${property}\\s*:\\s*([A-Za-z_$][\\w$]*)\\b`))?.[1]
  return identifier ? constants.get(identifier) ?? null : null
}

export type EventCallLike = Pick<CodeEdgeLike, 'id' | 'targetSymbol' | 'chainPath' | 'firstArg' | 'literalArgs'>
