import { existsSync, readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { codeNodes } from '@/db/schema/code_graph.js'
import type { EntryPointDraft } from '../types.js'
import {
  findMatchingBrace,
  findMatchingParen,
  stripJsLikeComments,
} from './source_fallback_shared.js'
import type { LegacyFallbackInput } from './source_fallback_types.js'

interface TrpcRouterDefinition {
  name: string
  filePath: string
  fileNodeId: string
  body: string
}

interface TrpcProperty {
  key: string
  value: string
}

interface TrpcProcedureDraft {
  routerName: string
  filePath: string
  fileNodeId: string
  procedureName: string
  operation: 'query' | 'mutation' | 'subscription'
}

export function buildTrpcFallbackEntries(input: LegacyFallbackInput): EntryPointDraft[] {
  if (!isTrpcActive(input)) return []

  const definitions = collectTrpcRouterDefinitions(input)
  if (definitions.length === 0) return []

  const procedures: TrpcProcedureDraft[] = []
  const routerRefs: Array<{ parentRouter: string; prefix: string; childRouter: string; parentFileNodeId: string }> = []

  for (const definition of definitions) {
    for (const property of splitObjectProperties(definition.body)) {
      const operation = inferProcedureOperation(property.value)
      if (operation) {
        procedures.push({
          routerName: definition.name,
          filePath: definition.filePath,
          fileNodeId: definition.fileNodeId,
          procedureName: property.key,
          operation,
        })
        continue
      }

      const childRouter = extractRouterReference(property.value)
      if (childRouter) {
        routerRefs.push({
          parentRouter: definition.name,
          prefix: property.key,
          childRouter,
          parentFileNodeId: definition.fileNodeId,
        })
      }
    }
  }

  const parentEvidenceByChild = new Map<string, Set<string>>()
  const prefixesByRouter = inferRouterPrefixes(definitions, routerRefs, parentEvidenceByChild)
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const procedure of procedures) {
    const prefixes = prefixesByRouter.get(procedure.routerName) ?? [fallbackRouterPrefix(procedure.routerName)]
    for (const prefix of prefixes) {
      const procedurePath = [...prefix, procedure.procedureName].filter(Boolean).join('.')
      if (!procedurePath) continue
      const canonicalTarget = `trpc:${procedurePath}`
      const httpMethod = `TRPC_${procedure.operation.toUpperCase()}`
      const key = `${httpMethod}:${canonicalTarget}`
      if (seen.has(key)) continue
      seen.add(key)

      const matchedNodeIds = [
        ...new Set([
          procedure.fileNodeId,
          ...(parentEvidenceByChild.get(procedure.routerName) ?? []),
        ]),
      ]

      out.push({
        framework: 'nextjs',
        kind: 'api',
        httpMethod,
        path: canonicalTarget,
        fullPath: canonicalTarget,
        handlerNodeId: procedure.fileNodeId,
        metadata: {
          canonicalTarget,
          protocol: 'trpc',
          procedurePath,
          procedureOperation: procedure.operation,
          sourceFallback: 'trpc_router_procedure',
        },
        detectionSource: 'source:trpc',
        confidence: 'high',
        detectionEvidence: {
          matchedRuleId: 'source_trpc_router_procedure',
          matchedNodeIds,
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function isTrpcActive(input: LegacyFallbackInput): boolean {
  if (input.stackInfo.routingLibs.some((lib) => lib.toLowerCase().includes('trpc'))) return true
  return input.graphNodes.some((node) =>
    node.type === 'file' &&
    existsSync(joinPath(input.repoPath, node.filePath)) &&
    /@trpc\/server/.test(readFileSync(joinPath(input.repoPath, node.filePath), 'utf-8')),
  )
}

function collectTrpcRouterDefinitions(input: LegacyFallbackInput): TrpcRouterDefinition[] {
  const definitions: TrpcRouterDefinition[] = []
  const files = input.graphNodes
    .filter((node) => node.type === 'file' && /\.(ts|tsx|js|jsx)$/.test(node.filePath))
    .sort((a, b) => a.filePath.localeCompare(b.filePath))

  for (const fileNode of files) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = stripJsLikeComments(readFileSync(abs, 'utf-8'))
    if (!/\brouter\s*\(/.test(source)) {
      continue
    }

    const routerPattern = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*router\s*\(/g
    for (const match of source.matchAll(routerPattern)) {
      const openParen = source.indexOf('(', match.index ?? 0)
      const closeParen = openParen >= 0 ? findMatchingParen(source, openParen) : -1
      if (closeParen < 0) continue
      const firstArgStart = source.indexOf('{', openParen)
      if (firstArgStart < 0 || firstArgStart > closeParen) continue
      const firstArgEnd = findMatchingBrace(source, firstArgStart)
      if (firstArgEnd < 0 || firstArgEnd > closeParen) continue
      definitions.push({
        name: match[1],
        filePath: fileNode.filePath,
        fileNodeId: fileNode.id,
        body: source.slice(firstArgStart + 1, firstArgEnd),
      })
    }
  }

  return definitions
}

function inferRouterPrefixes(
  definitions: TrpcRouterDefinition[],
  refs: Array<{ parentRouter: string; prefix: string; childRouter: string; parentFileNodeId: string }>,
  parentEvidenceByChild: Map<string, Set<string>>,
): Map<string, string[][]> {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const childNames = new Set(refs.map((ref) => ref.childRouter))
  const roots = definitions
    .map((definition) => definition.name)
    .filter((name) => !childNames.has(name))

  const prefixes = new Map<string, string[][]>()
  const queue = roots.length > 0
    ? roots.map((routerName) => ({ routerName, prefix: [] as string[], evidence: [] as string[] }))
    : definitions.map((definition) => ({
        routerName: definition.name,
        prefix: fallbackRouterPrefix(definition.name),
        evidence: [] as string[],
      }))

  while (queue.length > 0) {
    const current = queue.shift()!
    if (!byName.has(current.routerName)) continue
    const existing = prefixes.get(current.routerName) ?? []
    if (!existing.some((prefix) => prefix.join('.') === current.prefix.join('.'))) {
      existing.push(current.prefix)
      prefixes.set(current.routerName, existing)
    }

    for (const ref of refs.filter((item) => item.parentRouter === current.routerName)) {
      const nextEvidence = [...new Set([...current.evidence, ref.parentFileNodeId])]
      const evidence = parentEvidenceByChild.get(ref.childRouter) ?? new Set<string>()
      for (const nodeId of nextEvidence) evidence.add(nodeId)
      parentEvidenceByChild.set(ref.childRouter, evidence)
      queue.push({
        routerName: ref.childRouter,
        prefix: [...current.prefix, ref.prefix],
        evidence: nextEvidence,
      })
    }
  }

  for (const definition of definitions) {
    if (!prefixes.has(definition.name)) prefixes.set(definition.name, [fallbackRouterPrefix(definition.name)])
  }
  return prefixes
}

function splitObjectProperties(body: string): TrpcProperty[] {
  const properties: TrpcProperty[] = []
  let start = 0
  let quote: string | null = null
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0

  for (let i = 0; i <= body.length; i += 1) {
    const ch = body[i] ?? ','
    const prev = body[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') braceDepth += 1
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (ch === '(') parenDepth += 1
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (ch === '[') bracketDepth += 1
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (ch === ',' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      const segment = body.slice(start, i).trim()
      start = i + 1
      const property = parseObjectProperty(segment)
      if (property) properties.push(property)
    }
  }

  return properties
}

function parseObjectProperty(segment: string): TrpcProperty | null {
  const colon = findTopLevelColon(segment)
  if (colon < 0) return null
  const rawKey = segment.slice(0, colon).trim()
  const key = rawKey.match(/^['"`]([^'"`]+)['"`]$/)?.[1] ?? rawKey.match(/^([A-Za-z_$][\w$]*)$/)?.[1]
  if (!key) return null
  return { key, value: segment.slice(colon + 1).trim() }
}

function findTopLevelColon(segment: string): number {
  let quote: string | null = null
  let braceDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]
    const prev = segment[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') braceDepth += 1
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (ch === '(') parenDepth += 1
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (ch === '[') bracketDepth += 1
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (ch === ':' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) return i
  }
  return -1
}

function inferProcedureOperation(value: string): 'query' | 'mutation' | 'subscription' | null {
  if (/\.\s*mutation\s*\(/.test(value)) return 'mutation'
  if (/\.\s*query\s*\(/.test(value)) return 'query'
  if (/\.\s*subscription\s*\(/.test(value)) return 'subscription'
  return null
}

function extractRouterReference(value: string): string | null {
  return value.match(/^([A-Za-z_$][\w$]*)\s*,?$/)?.[1] ?? null
}

function fallbackRouterPrefix(routerName: string): string[] {
  const stripped = routerName.replace(/Router$/, '')
  if (!stripped || stripped === routerName) return []
  return [stripped.charAt(0).toLowerCase() + stripped.slice(1)]
}
