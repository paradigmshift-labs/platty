import { existsSync, readFileSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { codeNodes } from '@/db/schema/code_graph.js'
import { evaluateExtract } from '../f3/extract_evaluator.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from '../types.js'
import {
  resolveRelativeSourceFile,
  safeReadSource,
} from './source_fallback_shared.js'
import type { LegacyFallbackInput } from './source_fallback_types.js'

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])

function buildNextRouteHandlerFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const nextActive = input.detections.some((d) => d.framework === 'nextjs' && d.active)
  if (!nextActive) return []

  const appRouteFiles = input.graphNodes.filter(
    (node) =>
      node.type === 'file' &&
      /(^|\/)(src\/)?app\/.*\/route\.(ts|js)$/.test(node.filePath),
  )
  const out: EntryPointDraft[] = []

  for (const fileNode of appRouteFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    const routePath = evaluateExtract(
      '${file_path → path_pattern}',
      { candidate: { node: fileNode, matchedEdges: [] } },
    )
    if (!routePath) continue

    const methodNames = new Set<string>()
    for (const match of source.matchAll(/\bexport\s+(?:async\s+)?function\s+([A-Z]+)\s*\(/g)) {
      if (HTTP_METHODS.has(match[1])) methodNames.add(match[1])
    }
    for (const match of source.matchAll(/\bexport\s+const\s+([A-Z]+)\s*=/g)) {
      if (HTTP_METHODS.has(match[1])) methodNames.add(match[1])
    }
    for (const name of extractExportedDestructuredBindings(source)) {
      if (HTTP_METHODS.has(name)) methodNames.add(name)
    }
    for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/i)[0]?.trim()
        if (name && HTTP_METHODS.has(name)) methodNames.add(name)
      }
    }

    for (const method of methodNames) {
      const handlerNode = input.graphNodes.find(
        (node) =>
          node.filePath === fileNode.filePath &&
          node.type === 'function' &&
          node.name === method,
      )
      const handlerNodeId = handlerNode?.id ?? fileNode.id
      out.push({
        framework: 'nextjs',
        kind: 'api',
        httpMethod: method,
        path: routePath,
        fullPath: routePath,
        handlerNodeId,
        metadata: { sourceFallback: 'next_app_route_named_export' },
        detectionSource: 'source:nextjs',
        confidence: handlerNode ? 'high' : 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_next_app_route_named_export',
          matchedNodeIds: [handlerNodeId],
          matchedEdgeIds: [],
        },
      })
    }
  }

  const pagesApiFiles = input.graphNodes.filter(
    (node) =>
      node.type === 'file' &&
      /(^|\/)(src\/)?pages\/api\/.*\.(ts|js)$/.test(node.filePath),
  )

  for (const fileNode of pagesApiFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    const routePath = evaluateExtract(
      '${file_path → path_pattern}',
      { candidate: { node: fileNode, matchedEdges: [] } },
    )
    if (!routePath) continue

    const methodNames = extractPagesApiDispatchMethods(source)
    for (const method of methodNames) {
      out.push({
        framework: 'nextjs',
        kind: 'api',
        httpMethod: method,
        path: routePath,
        fullPath: routePath,
        handlerNodeId: fileNode.id,
        metadata: { sourceFallback: 'next_pages_api_method_dispatch' },
        detectionSource: 'source:nextjs_pages_api',
        confidence: 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_next_pages_api_method_dispatch',
          matchedNodeIds: [fileNode.id],
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function extractExportedDestructuredBindings(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(/\bexport\s+const\s*\{([^}]+)\}\s*=/g)) {
    for (const part of match[1].split(',')) {
      const binding = destructuredBindingName(part)
      if (binding) names.push(binding)
    }
  }
  return names
}

function destructuredBindingName(raw: string): string | null {
  const part = raw.trim()
  if (!part || part.startsWith('...')) return null
  const alias = part.match(/:\s*([A-Za-z_$][\w$]*)\s*(?:=[^,]+)?$/)
  if (alias) return alias[1]
  const shorthand = part.match(/^([A-Za-z_$][\w$]*)\s*(?:=[^,]+)?$/)
  return shorthand?.[1] ?? null
}

function extractPagesApiDispatchMethods(source: string): Set<string> {
  const methods = new Set<string>()
  for (const match of source.matchAll(/\bcase\s+['"`]([A-Z]+)['"`](?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*:/g)) {
    if (HTTP_METHODS.has(match[1])) methods.add(match[1])
  }
  for (const match of source.matchAll(/\b(?:req|request)\.method\s*={2,3}\s*['"`]([A-Z]+)['"`]/g)) {
    if (HTTP_METHODS.has(match[1])) methods.add(match[1])
  }
  for (const match of source.matchAll(/['"`]([A-Z]+)['"`]\s*={2,3}\s*\b(?:req|request)\.method\b/g)) {
    if (HTTP_METHODS.has(match[1])) methods.add(match[1])
  }
  return methods
}

function buildNextServerActionFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const nextActive = input.detections.some((d) => d.framework === 'nextjs' && d.active)
  if (!nextActive) return []

  const pageFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && /(^|\/)(src\/)?app\/.*\/page\.(tsx|jsx|ts|js)$/.test(node.filePath),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const fileNode of pageFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    const parentRoute = evaluateExtract('${file_path → path_pattern}', { candidate: { node: fileNode, matchedEdges: [] } })
    if (!parentRoute) continue

    const usedActions = extractUsedFormActions(source)
    const inlineActions = extractInlineServerActions(source)
    const importedActions = resolveImportedServerActions(source, fileNode.filePath, input.repoPath, input.graphNodes)
    for (const actionName of usedActions) {
      const actionFile = importedActions.get(actionName) ?? fileNode.filePath
      const actionSource = actionFile === fileNode.filePath ? source : safeReadSource(input.repoPath, actionFile)
      if (!actionSource) continue
      if (actionFile === fileNode.filePath && !inlineActions.has(actionName)) continue
      if (actionFile !== fileNode.filePath && !isExportedServerAction(actionSource, actionName)) continue
      const key = `${parentRoute}#action:${actionName}`
      if (seen.has(key)) continue
      seen.add(key)
      const handlerNode = input.graphNodes.find((node) => node.filePath === actionFile && node.name === actionName && node.type === 'function')
      out.push(makeNextServerActionEntry({
        parentRoute,
        actionName,
        handlerNodeId: handlerNode?.id ?? fileNode.id,
        matchedNodeIds: [fileNode.id, handlerNode?.id].filter((id): id is string => Boolean(id)),
      }))
    }
  }

  return out
}

function buildNextMiddlewareFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const nextActive = input.detections.some((d) => d.framework === 'nextjs' && d.active)
  if (!nextActive) return []

  const middlewareFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && /(^|\/)(src\/)?(middleware|proxy)\.(ts|js)$/.test(node.filePath),
  )
  const out: EntryPointDraft[] = []

  for (const fileNode of middlewareFiles) {
    const source = safeReadSource(input.repoPath, fileNode.filePath)
    if (!source) continue
    const handlerNode = input.graphNodes.find(
      (node) =>
        node.filePath === fileNode.filePath &&
        node.type === 'function' &&
        node.name === nextMiddlewareHandlerName(fileNode.filePath),
    )
    const handlerNodeId = handlerNode?.id ?? fileNode.id
    const matchers = extractNextMiddlewareMatchers(source)
    for (const matcher of matchers.length > 0 ? matchers : ['/:path*']) {
      out.push({
        framework: 'nextjs',
        kind: 'api',
        httpMethod: 'MIDDLEWARE',
        path: matcher,
        fullPath: `middleware:${matcher}`,
        handlerNodeId,
        metadata: {
          interactionKind: 'next_middleware',
          matcher,
          stablePublicUrl: false,
        },
        detectionSource: 'source:nextjs_middleware',
        confidence: handlerNode ? 'high' : 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_next_middleware',
          matchedNodeIds: [fileNode.id, handlerNode?.id].filter((id): id is string => Boolean(id)),
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function nextMiddlewareHandlerName(filePath: string): 'middleware' | 'proxy' {
  return /(^|\/)(src\/)?proxy\.(ts|js)$/.test(filePath) ? 'proxy' : 'middleware'
}

function buildNextConfigRewriteFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const nextActive = input.detections.some((d) => d.framework === 'nextjs' && d.active)
  if (!nextActive) return []

  const configFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && /(^|\/)next\.config\.(js|mjs|cjs|ts)$/.test(node.filePath),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  for (const fileNode of configFiles) {
    const source = safeReadSource(input.repoPath, fileNode.filePath)
    if (!source || !/\brewrites\s*\(/.test(source)) continue
    for (const rewrite of extractNextConfigRewrites(source)) {
      const key = `${rewrite.source}->${rewrite.destination}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        framework: 'nextjs',
        kind: 'api',
        httpMethod: 'GET',
        path: rewrite.source,
        fullPath: rewrite.source,
        handlerNodeId: fileNode.id,
        metadata: {
          sourceFallback: 'next_config_rewrite',
          rewriteDestination: rewrite.destination,
          stablePublicUrl: true,
        },
        detectionSource: 'source:nextjs_config',
        confidence: 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_next_config_rewrite',
          matchedNodeIds: [fileNode.id],
          matchedEdgeIds: [],
        },
      })
    }
  }
  return out
}

function extractNextConfigRewrites(source: string): Array<{ source: string; destination: string }> {
  const out: Array<{ source: string; destination: string }> = []
  for (const block of extractObjectBlocks(source)) {
    const routeSource = block.match(/\bsource\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]
    const destination = block.match(/\bdestination\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]
    if (!routeSource?.startsWith('/') || !destination?.startsWith('/')) continue
    out.push({ source: routeSource, destination })
  }
  return out
}

function extractObjectBlocks(source: string): string[] {
  const blocks: string[] = []
  const objectStartRe = /\{/g
  let match: RegExpExecArray | null
  while ((match = objectStartRe.exec(source)) !== null) {
    const end = findMatchingBrace(source, match.index)
    if (end < 0) continue
    const block = source.slice(match.index, end + 1)
    if (/\bsource\s*:/.test(block) && /\bdestination\s*:/.test(block)) blocks.push(block)
  }
  return blocks
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i]
    const prev = source[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function extractNextMiddlewareMatchers(source: string): string[] {
  const configMatch = source.match(/\bexport\s+const\s+config\s*=\s*\{([\s\S]*?)\n\s*\}/)
  if (!configMatch) return []
  const matcherValue = configMatch[1].match(/\bmatcher\s*:\s*(\[[\s\S]*?\]|['"`][^'"`]+['"`])/)
  if (!matcherValue) return []
  return [...matcherValue[1].matchAll(/['"`]([^'"`]+)['"`]/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith('/'))
}

function extractUsedFormActions(source: string): Set<string> {
  const out = new Set<string>()
  for (const match of source.matchAll(/\b(?:action|formAction)\s*=\s*\{\s*(\w+)\s*\}/g)) out.add(match[1])
  return out
}

function extractInlineServerActions(source: string): Set<string> {
  const out = new Set<string>()
  for (const match of source.matchAll(/\basync\s+function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/g)) {
    if (/['"]use server['"]/.test(match[2])) out.add(match[1])
  }
  return out
}

function resolveImportedServerActions(
  source: string,
  fromFile: string,
  repoPath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveRelativeSourceFile(fromFile, match[2], repoPath, graphNodes)
    if (!target) continue
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/i).pop()?.trim()
      if (name) out.set(name, target.filePath)
    }
  }
  return out
}

function isExportedServerAction(source: string, actionName: string): boolean {
  const fileLevel = /^\s*['"]use server['"]/.test(source)
  const exported = new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${actionName}\\s*\\(`).test(source)
    || new RegExp(`\\bexport\\s+const\\s+${actionName}\\s*=`).test(source)
  if (fileLevel && exported) return true
  const fn = new RegExp(`\\bexport\\s+async\\s+function\\s+${actionName}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source)
  return Boolean(fn?.[1] && /['"]use server['"]/.test(fn[1]))
}

function makeNextServerActionEntry(input: {
  parentRoute: string
  actionName: string
  handlerNodeId: string
  matchedNodeIds: string[]
}): EntryPointDraft {
  return {
    framework: 'nextjs',
    kind: 'api',
    httpMethod: 'POST',
    path: input.parentRoute,
    fullPath: `${input.parentRoute}#action:${input.actionName}`,
    handlerNodeId: input.handlerNodeId,
    metadata: {
      interactionKind: 'next_server_action',
      parentRoute: input.parentRoute,
      actionName: input.actionName,
      stablePublicUrl: false,
    },
    detectionSource: 'source:nextjs_server_action',
    confidence: 'high',
    detectionEvidence: {
      matchedRuleId: 'source_next_server_action',
      matchedNodeIds: input.matchedNodeIds,
      matchedEdgeIds: [],
    },
  }
}


export {
  buildNextConfigRewriteFallbackEntries,
  buildNextMiddlewareFallbackEntries,
  buildNextRouteHandlerFallbackEntries,
  buildNextServerActionFallbackEntries,
}
