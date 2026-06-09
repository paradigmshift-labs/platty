import { existsSync, readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import type { EntryPointDraft } from '../types.js'
import { findMatchingBrace, stripJsLikeComments } from './source_fallback_shared.js'
import type { LegacyFallbackInput } from './source_fallback_types.js'

type OrpcRouteDraft = {
  filePath: string
  fileNodeId: string
  method: string
  path: string
  canonicalTarget: string
}

export function buildOrpcFallbackEntries(input: LegacyFallbackInput): EntryPointDraft[] {
  if (!hasOrpcServerSignal(input)) return []

  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  for (const route of collectOrpcRouteDrafts(input)) {
    const key = `${route.method}:${route.path}:${route.fileNodeId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      framework: 'orpc',
      kind: 'api',
      httpMethod: route.method,
      path: route.path,
      fullPath: route.path,
      handlerNodeId: route.fileNodeId,
      metadata: {
        canonicalTarget: route.canonicalTarget,
        protocol: 'orpc',
        sourceFallback: 'orpc_server_route',
      },
      detectionSource: 'source:orpc',
      confidence: 'high',
      detectionEvidence: {
        matchedRuleId: 'source_orpc_server_route',
        matchedNodeIds: [route.fileNodeId],
        matchedEdgeIds: [],
      },
    })
  }
  return out
}

export function hasOrpcServerSignal(input: LegacyFallbackInput): boolean {
  if (input.stackInfo.routingLibs.some((lib) => lib.toLowerCase().includes('@orpc/server'))) return true
  return input.graphNodes.some((node) =>
    node.type === 'file' &&
    existsSync(joinPath(input.repoPath, node.filePath)) &&
    /@orpc\/server/.test(readFileSync(joinPath(input.repoPath, node.filePath), 'utf-8')),
  )
}

function collectOrpcRouteDrafts(input: LegacyFallbackInput): OrpcRouteDraft[] {
  const out: OrpcRouteDraft[] = []
  const files = input.graphNodes
    .filter((node) => node.type === 'file' && /\.(ts|tsx|js|jsx)$/.test(node.filePath))
    .sort((a, b) => a.filePath.localeCompare(b.filePath))

  for (const fileNode of files) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = stripJsLikeComments(readFileSync(abs, 'utf-8'))
    if (!source.includes('@orpc/server') && !source.includes('os.route')) continue

    for (const config of extractOrpcRouteConfigs(source)) {
      const method = extractObjectString(config, 'method')?.toUpperCase() ?? 'POST'
      const path = normalizeOrpcRoutePath(extractObjectString(config, 'path'))
      if (!path) continue
      out.push({
        filePath: fileNode.filePath,
        fileNodeId: fileNode.id,
        method,
        path,
        canonicalTarget: `orpc:${procedurePathFromRoutePath(path)}`,
      })
    }
  }

  return out
}

function extractOrpcRouteConfigs(source: string): string[] {
  const out: string[] = []
  const routeRe = /\bos\s*\.\s*route\s*\(\s*\{/g
  for (const match of source.matchAll(routeRe)) {
    const openBrace = source.indexOf('{', match.index)
    if (openBrace < 0) continue
    const closeBrace = findMatchingBrace(source, openBrace)
    if (closeBrace < 0) continue
    out.push(source.slice(openBrace + 1, closeBrace))
  }
  return out
}

function extractObjectString(source: string, key: string): string | null {
  return new RegExp(`\\b${key}\\s*:\\s*(['"])(.*?)\\1`).exec(source)?.[2] ?? null
}

function normalizeOrpcRoutePath(path: string | null): string | null {
  if (!path) return null
  const cleaned = path.trim().replace(/\/+/g, '/')
  if (!cleaned || cleaned === '/') return '/'
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`
}

function procedurePathFromRoutePath(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/^:/, '').replace(/^\$/, ''))
    .join('.')
}
