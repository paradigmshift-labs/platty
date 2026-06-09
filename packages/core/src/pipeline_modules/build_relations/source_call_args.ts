import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { BuildRelationsInputs, CodeEdgeLike, CodeNodeLike } from './types.js'
import { createSourceFallback } from './source_fallback.js'

export function resolveFirstArgFromSource(
  inputs: BuildRelationsInputs,
  node: CodeNodeLike,
  edge: CodeEdgeLike,
): string | null {
  return resolveFirstArgsFromSource(inputs, node, edge)[0] ?? null
}

export function resolveFirstArgsFromSource(
  inputs: BuildRelationsInputs,
  node: CodeNodeLike,
  edge: CodeEdgeLike,
): string[] {
  if (edge.firstArg) return [edge.firstArg]

  const graphArg = resolveFirstArgFromGraphArgExpressions(edge, inputs, node)
  if (graphArg && !isBareIdentifier(graphArg)) return [graphArg]

  const source = readNodeSource(inputs, node)
  if (!source) return graphArg ? [graphArg] : []

  const method = edge.targetSymbol
  if (!method) return []

  const chainPath = edge.chainPath ?? ''
  const patterns = buildCallPatterns(chainPath, method)
  const args: string[] = []
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const quotedArg = match[2]
      const rawArg = quotedArg ?? match[3] ?? match[1]
      const cleaned = quotedArg != null ? quotedArg.trim() : rawArg ? cleanFirstArg(rawArg) : null
      if (cleaned) args.push(cleaned)
    }
  }

  const sourceArgs = dedupe(args)
  if (sourceArgs.length > 0) return sourceArgs
  return graphArg ? [graphArg] : []
}

export function resolveFirstArgFromGraphArgExpressions(
  edge: CodeEdgeLike,
  inputs?: BuildRelationsInputs,
  node?: CodeNodeLike,
): string | null {
  const expressions = edge.argExpressions
  if (!expressions || !Array.isArray(expressions)) return null

  const first = expressions.find((arg) => arg.index === 0)
  if (!first) return null

  if (first.kind === 'string' && first.value) return first.value
  if (first.kind === 'template' && first.staticPattern) {
    if (first.raw && inputs && node) {
      const resolved = resolveTemplateRaw(first.raw, inputs, node)
      if (resolved) return resolved
    }
    return normalizeTemplatePattern(first.staticPattern, first.identifiers ?? [])
  }
  if (first.resolved) {
    if (first.resolved.kind === 'string' && first.resolved.value) return first.resolved.value
    if ((first.resolved.kind === 'identifier' || first.resolved.kind === 'member') && first.resolved.raw) {
      return first.resolved.raw
    }
    if (first.resolved.kind === 'template' && first.resolved.staticPattern) {
      if (first.resolved.raw && inputs && node) {
        const resolved = resolveTemplateRaw(first.resolved.raw, inputs, node)
        if (resolved) return resolved
      }
      return normalizeTemplatePattern(first.resolved.staticPattern, first.resolved.identifiers ?? [])
    }
  }
  if ((first.kind === 'identifier' || first.kind === 'member') && first.raw) return first.raw

  return null
}

function resolveTemplateRaw(raw: string, inputs: BuildRelationsInputs, node: CodeNodeLike): string | null {
  if (!inputs.repoPath || !node.filePath) return null
  const body = raw.match(/^`([\s\S]*)`$/)?.[1]
  if (body == null) return null

  const fallback = createSourceFallback(inputs.repoPath)
  const resolved = body.replace(/\$\{\s*([^}]+?)\s*\}/g, (_match, expr: string) => {
    const trimmed = expr.trim()
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(trimmed)) {
      const constant = fallback.resolveConstant({
        identifier: trimmed,
        nodeId: node.id,
        filePath: node.filePath,
        allowedScopes: ['route', 'api'],
      })
      if (constant) return constant
      const dynamicName = trimmed.split('.').pop() ?? 'value'
      return `\${${dynamicName}}`
    }
    return '${value}'
  })

  return resolved.trim() || null
}

function readNodeSource(inputs: BuildRelationsInputs, node: CodeNodeLike): string | null {
  if (!inputs.repoPath || !node.filePath) return null

  const root = resolve(inputs.repoPath)
  const fullPath = isAbsolute(node.filePath) ? resolve(node.filePath) : resolve(root, node.filePath)
  const rel = relative(root, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  if (!existsSync(fullPath)) return null

  try {
    const source = readFileSync(fullPath, 'utf8')
    const lines = source.split(/\r?\n/)
    const start = Math.max(0, (node.lineStart ?? 1) - 1)
    const end = Math.min(lines.length, Math.max(node.lineEnd ?? lines.length, start + 1))
    return lines.slice(start, end).join('\n')
  } catch {
    return null
  }
}

function buildCallPatterns(chainPath: string, method: string): RegExp[] {
  const escapedMethod = escapeRegExp(method)
  const firstArg = "\\s*(?:(['\"`])([\\s\\S]*?)\\1|([A-Za-z_$][\\w.$]*))"
  const patterns: RegExp[] = []

  if (chainPath.startsWith('Navigator.of')) {
    patterns.push(new RegExp(String.raw`Navigator\s*\.\s*of\s*\([^)]*\)\s*\.\s*${escapedMethod}\s*\(${firstArg}`, 'gm'))
  } else if (chainPath) {
    patterns.push(new RegExp(String.raw`${escapeChainPath(chainPath)}\s*\.\s*${escapedMethod}\s*\(${firstArg}`, 'gm'))
  } else if (method === 'fetch') {
    patterns.push(new RegExp(String.raw`\bfetch\s*\(${firstArg}`, 'gm'))
  }

  return patterns
}

function cleanFirstArg(rawArg: string): string | null {
  const trimmed = rawArg.trim()
  if (!trimmed) return null

  const quoted = trimmed.match(/^(['"`])([\s\S]*?)\1$/)
  if (quoted?.[2]) return quoted[2].trim()

  const identifier = trimmed.match(/^([A-Za-z_$][\w.$]*)$/)?.[1]
  if (identifier) return identifier

  return null
}

function isBareIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value)
}

function normalizeTemplatePattern(staticPattern: string, identifiers: string[]): string | null {
  const normalized = staticPattern.replace(/:([A-Za-z_$][\w$]*)/g, (_, name: string) => {
    return `\${${identifiers.includes(name) ? name : 'value'}}`
  })
  return normalized.trim() || null
}

function escapeChainPath(chainPath: string): string {
  return chainPath
    .split('.')
    .map((part) => part.endsWith('()')
      ? `${escapeRegExp(part.slice(0, -2))}\\s*\\([^)]*\\)`
      : escapeRegExp(part))
    .join(String.raw`\s*\.\s*`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
