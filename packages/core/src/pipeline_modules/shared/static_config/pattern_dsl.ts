import type { CodeEdgeLike, CodeNodeLike } from '@/pipeline_modules/build_relations/types.js'
import type {
  ResolvedConfigSource,
  StaticAnalysisPatternRule,
  StaticAnalysisPatternRuleMatch,
  StaticAnalysisPatternValueSource,
} from './types.js'

const CONSUMABLE_RULE_SOURCES = new Set<ResolvedConfigSource>([
  'default',
  'repository_metadata',
  'user',
  'approved',
  'fixture',
])

export interface PatternDslFact {
  ruleId: string
  factKind: StaticAnalysisPatternRule['target']
  sourceNodeId: string
  target: string
  operation: string | null
  evidenceEdgeIds: number[]
}

export interface PatternDslLegacyFact {
  key: string
  value: string
}

export type PatternDslLegacyClassification = 'both' | 'dsl_only' | 'legacy_only' | 'conflict'

export interface PatternDslLegacyComparison {
  classification: PatternDslLegacyClassification
  key: string
  dslValue?: string
  legacyValue?: string
}

export function matchPatternDslRules(input: {
  rules: StaticAnalysisPatternRule[]
  edges: CodeEdgeLike[]
  nodes?: CodeNodeLike[]
}): PatternDslFact[] {
  const facts: PatternDslFact[] = []
  const nodesById = new Map((input.nodes ?? []).map((node) => [node.id, node]))
  for (const rule of input.rules) {
    if (rule.state !== 'active') continue
    if (!CONSUMABLE_RULE_SOURCES.has(rule.source)) continue
    for (const edge of input.edges) {
      const captures = matchEdge(rule.match, edge, input.edges, nodesById)
      if (!captures) continue
      const target = resolveValue(rule.emit.targetFrom, edge, captures)
      if (!target) continue
      const operation = rule.emit.operationValue
        ?? (rule.emit.operationFrom ? resolveValue(rule.emit.operationFrom, edge, captures) : null)
      facts.push({
        ruleId: rule.id,
        factKind: rule.target,
        sourceNodeId: edge.sourceId,
        target,
        operation,
        evidenceEdgeIds: [edge.id],
      })
    }
  }
  return facts
}

export function classifyDslLegacyFacts(input: {
  dslFacts: PatternDslLegacyFact[]
  legacyFacts: PatternDslLegacyFact[]
}): {
  comparisons: PatternDslLegacyComparison[]
  summary: Record<PatternDslLegacyClassification, number>
} {
  const dslByKey = new Map(input.dslFacts.map((fact) => [fact.key, fact.value]))
  const legacyByKey = new Map(input.legacyFacts.map((fact) => [fact.key, fact.value]))
  const keys = new Set([...dslByKey.keys(), ...legacyByKey.keys()])
  const comparisons: PatternDslLegacyComparison[] = []
  const summary = { both: 0, dsl_only: 0, legacy_only: 0, conflict: 0 }

  for (const key of [...keys].sort()) {
    const dslValue = dslByKey.get(key)
    const legacyValue = legacyByKey.get(key)
    if (dslValue === undefined) {
      summary.legacy_only += 1
      comparisons.push({ classification: 'legacy_only', key, legacyValue })
    } else if (legacyValue === undefined) {
      summary.dsl_only += 1
      comparisons.push({ classification: 'dsl_only', key, dslValue })
    } else if (dslValue === legacyValue) {
      summary.both += 1
      comparisons.push({ classification: 'both', key, dslValue, legacyValue })
    } else {
      summary.conflict += 1
      comparisons.push({ classification: 'conflict', key, dslValue, legacyValue })
    }
  }

  return { comparisons, summary }
}

export function extractLiteralArgValue(literalArgs: string | null | undefined, key: string): string | null {
  if (!literalArgs) return null
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    if (!Array.isArray(parsed)) return null
    const first = parsed[0]
    if (!first || typeof first !== 'object' || Array.isArray(first)) return null
    const value = (first as Record<string, unknown>)[key]
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch {
    return null
  }
}

function matchEdge(
  match: StaticAnalysisPatternRuleMatch,
  edge: CodeEdgeLike,
  allEdges: CodeEdgeLike[],
  nodesById: Map<string, CodeNodeLike>,
): Record<string, string> | null {
  if (edge.relation !== match.relation) return null
  if (match.targetSymbolIn && !match.targetSymbolIn.includes(edge.targetSymbol ?? '')) return null
  if (match.decoratorName && edge.targetSymbol !== match.decoratorName) return null
  if (match.literalArgKey && extractLiteralArgValue(edge.literalArgs, match.literalArgKey) === null) return null
  if (match.fileGlob && !fileMatchesGlob(sourceFilePath(edge, nodesById), match.fileGlob)) return null
  if (match.importsContain && !sourceFileImportsPackage(edge, match.importsContain.packageName, allEdges, nodesById)) {
    return null
  }
  if (match.chainPathEquals && edge.chainPath !== match.chainPathEquals) return null
  if (match.chainPathPrefix && !(edge.chainPath ?? '').startsWith(match.chainPathPrefix)) return null
  if (match.chainPathPattern) return matchChainPathPattern(match.chainPathPattern, edge.chainPath)
  return {}
}

function matchChainPathPattern(pattern: string, chainPath: string | null | undefined): Record<string, string> | null {
  if (!chainPath) return null
  const placeholderNames = [...pattern.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1])
  if (placeholderNames.length === 0) return pattern === chainPath ? {} : null

  const escaped = escapeRegExp(pattern).replace(/\\\{([A-Za-z_][A-Za-z0-9_]*)\\\}/g, (_, name: string) => {
    return `['"]?(?<${name}>[^.()'"]+)['"]?`
  })
  const match = new RegExp(`^${escaped}$`).exec(chainPath)
  return match?.groups ? { ...match.groups } : null
}

function resolveValue(
  source: StaticAnalysisPatternValueSource,
  edge: CodeEdgeLike,
  captures: Record<string, string>,
): string | null {
  if (source === 'firstArg') return edge.firstArg ?? null
  if (source === 'targetSymbol') return edge.targetSymbol ?? null
  if (source.startsWith('literalArg:')) return extractLiteralArgValue(edge.literalArgs, source.slice('literalArg:'.length))
  if (source.startsWith('chainPathSegment:')) return captures[source.slice('chainPathSegment:'.length)] ?? null
  if (source.startsWith('chainPathCallArg:')) {
    const name = source.slice('chainPathCallArg:'.length)
    return captures[name] ?? extractFirstCallArg(edge.chainPath)
  }
  return null
}

function extractFirstCallArg(chainPath: string | null | undefined): string | null {
  if (!chainPath) return null
  const match = /\((['"])(.*?)\1\)/.exec(chainPath)
  return match?.[2] ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sourceFileImportsPackage(
  edge: CodeEdgeLike,
  packageName: string,
  allEdges: CodeEdgeLike[],
  nodesById: Map<string, CodeNodeLike>,
): boolean {
  const filePath = sourceFilePath(edge, nodesById)
  return allEdges.some((candidate) => {
    if (candidate.relation !== 'imports') return false
    if (candidate.targetSpecifier !== packageName) return false
    if (!filePath) return candidate.sourceId === edge.sourceId
    return sourceFilePath(candidate, nodesById) === filePath
  })
}

function sourceFilePath(edge: CodeEdgeLike, nodesById: Map<string, CodeNodeLike>): string | null {
  return nodesById.get(edge.sourceId)?.filePath ?? filePathFromNodeId(edge.repoId, edge.sourceId)
}

function filePathFromNodeId(repoId: string, nodeId: string): string | null {
  const prefix = `${repoId}:`
  const withoutRepo = nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : nodeId
  const separator = withoutRepo.lastIndexOf(':')
  return separator > 0 ? withoutRepo.slice(0, separator) : null
}

function fileMatchesGlob(filePath: string | null, glob: string): boolean {
  if (!filePath) return false
  const pattern = escapeRegExp(glob)
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
  return new RegExp(`^${pattern}$`).test(filePath)
}
