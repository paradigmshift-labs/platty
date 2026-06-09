import { existsSync, readFileSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import fg from 'fast-glob'
import { codeNodes } from '@/db/schema/code_graph.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from '../types.js'
import {
  findMatchingBrace,
  findMatchingParen,
  resolveRelativeSourceFile,
} from './source_fallback_shared.js'
import type { LegacyFallbackInput } from './source_fallback_types.js'

const TANSTACK_SERVER_HANDLER_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ANY'])

function buildReactRouterFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const reactActive = input.detections.some((d) => d.framework === 'react_router_v6' && d.active)
  if (!reactActive) return []

  const routeFiles = collectReactRouterSourceFiles(
    input.repoPath,
    input.stackInfo.routingFiles ?? [],
    input.graphNodes,
  )

  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  const lazyRouteBases = discoverReactLazyRouteBases(input.repoPath, routeFiles, input.graphNodes)
  for (const file of routeFiles) {
    const abs = joinPath(input.repoPath, file)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    const fileNode = input.graphNodes.find((node) => node.type === 'file' && node.filePath === file)
    const fileNodeId = fileNode?.id
    const routeBase = lazyRouteBases.get(file)
    const routerBasename = inferReactRouterBasename(input.repoPath, file)
    if (fileNodeId) {
      for (const jsxRoutePath of extractReactRouterJsxRoutePaths(source)) {
        const localPath = routeBase
          ? joinNestedReactRoutePath(routeBase, jsxRoutePath)
          : jsxRoutePath
        const path = applyReactRouterBasename(routerBasename, localPath)
        if (seen.has(path)) continue
        seen.add(path)
        out.push(makeReactRouterFallbackEntry(path, fileNodeId, 'react_router_v6_jsx'))
      }

      for (const jsxRoutePath of extractReactRouterLocalizedJsxRoutePaths(source, input.repoPath)) {
        const localPath = routeBase
          ? joinNestedReactRoutePath(routeBase, jsxRoutePath)
          : jsxRoutePath
        const path = applyReactRouterBasename(routerBasename, localPath)
        if (seen.has(path)) continue
        seen.add(path)
        out.push(makeReactRouterFallbackEntry(path, fileNodeId, 'react_router_v6_jsx'))
      }

      for (const constRoutePath of extractReactRouterConstJsxRoutePaths(source, input.repoPath)) {
        const localPath = routeBase
          ? joinNestedReactRoutePath(routeBase, constRoutePath)
          : constRoutePath
        const path = applyReactRouterBasename(routerBasename, localPath)
        if (seen.has(path)) continue
        seen.add(path)
        out.push(makeReactRouterFallbackEntry(path, fileNodeId, 'react_router_v6_jsx'))
      }

      for (const route of extractReactRouterObjectRoutes(source, input.graphNodes, file, input.repoPath)) {
        const localPath = route.path
        const path = applyReactRouterBasename(routerBasename, localPath)
        if (seen.has(path)) continue
        seen.add(path)
        const handlerNodeId = route.handlerNodeId ?? fileNodeId
        if (!handlerNodeId) continue
        out.push(makeReactRouterFallbackEntry(
          path,
          handlerNodeId,
          source.includes('createFrontendRouter') || source.includes('createSlice')
            ? 'react_microfrontend_router'
            : 'react_router_v6_object',
          [fileNodeId, handlerNodeId].filter((id): id is string => Boolean(id)),
        ))
      }
    }

    const frameworkHandlerNodeId = fileNodeId ?? inferReactRouterFrameworkHandlerNodeId(source, file, input.graphNodes)
    for (const localPath of extractReactRouterFrameworkRoutePaths(source)) {
      if (!frameworkHandlerNodeId) continue
      const path = applyReactRouterBasename(routerBasename, localPath)
      if (seen.has(path)) continue
      seen.add(path)
      out.push(makeReactRouterFallbackEntry(path, frameworkHandlerNodeId, 'react_router_v6_framework'))
    }

    for (const flatRoute of extractReactRouterFlatRoutePaths(source, input.repoPath, input.graphNodes)) {
      const path = applyReactRouterBasename(routerBasename, flatRoute.path)
      if (seen.has(path)) continue
      seen.add(path)
      out.push(makeReactRouterFallbackEntry(path, flatRoute.handlerNodeId, 'react_router_v6_flat_routes'))
    }
  }
  return out
}

function buildReactTanStackRouterFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const reactActive = input.detections.some((d) => d.framework === 'react_router_v6' && d.active)
  if (!reactActive) return []
  if (!input.stackInfo.routingLibs.some((lib) => lib === '@tanstack/react-router' || lib.startsWith('@tanstack/react-router@'))) {
    return []
  }

  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  for (const file of collectReactRouterSourceFiles(input.repoPath, input.stackInfo.routingFiles ?? [], input.graphNodes)) {
    const abs = joinPath(input.repoPath, file)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    if (!source.includes('createFileRoute') && !source.includes('createLazyFileRoute')) continue

    const fileNodeId = input.graphNodes.find((node) => node.type === 'file' && node.filePath === file)?.id
    const imports = collectNamedImportSources(source, file, input.repoPath, input.graphNodes)
    for (const route of extractTanStackFileRoutes(source)) {
      const path = normalizeReactRoutePath(route.path)
      if (seen.has(path)) continue
      const routeNodeId = route.routeVariableName
        ? findReactNodeIdByName(input.graphNodes, file, route.routeVariableName)
        : null
      const pageHandlerNodeId = route.componentName
        ? findReactComponentNodeId(input.graphNodes, file, route.componentName) ?? fileNodeId
        : fileNodeId
      const matchedNodeIds = [fileNodeId, routeNodeId, pageHandlerNodeId].filter((id): id is string => Boolean(id))
      seen.add(path)
      if (route.serverHandlers.length > 0) {
        for (const handler of route.serverHandlers) {
          const serverHandlerNodeId = findReactHandlerFunctionNodeId(input.graphNodes, file, handler.calledFunctionName, imports) ?? fileNodeId
          if (!serverHandlerNodeId) continue
          out.push(makeReactTanStackServerRouteEntry(
            path,
            handler.method === 'ANY' ? 'ALL' : handler.method,
            serverHandlerNodeId,
            [fileNodeId, routeNodeId, serverHandlerNodeId].filter((id): id is string => Boolean(id)),
          ))
        }
      } else {
        if (!pageHandlerNodeId) continue
        out.push(makeReactRouterFallbackEntry(
          path,
          pageHandlerNodeId,
          'react_tanstack_file_route',
          matchedNodeIds,
        ))
      }
    }
  }
  return out
}

function extractTanStackFileRoutes(source: string): Array<{
  path: string
  routeVariableName: string | null
  componentName: string | null
  serverHandlers: Array<{ method: string; calledFunctionName: string | null }>
}> {
  const out: Array<{
    path: string
    routeVariableName: string | null
    componentName: string | null
    serverHandlers: Array<{ method: string; calledFunctionName: string | null }>
  }> = []
  const routeCallRe = /\bcreate(?:Lazy)?FileRoute\s*\(\s*(['"])(.*?)\1\s*\)/g
  for (const match of source.matchAll(routeCallRe)) {
    const firstCallEnd = match.index + match[0].length
    const secondOpen = source.slice(firstCallEnd).search(/\S/)
    const secondOpenIndex = secondOpen >= 0 ? firstCallEnd + secondOpen : -1
    if (secondOpenIndex < 0 || source[secondOpenIndex] !== '(') continue
    const secondClose = findMatchingParen(source, secondOpenIndex)
    if (secondClose < 0) continue
    const config = source.slice(secondOpenIndex + 1, secondClose)
    out.push({
      path: match[2],
      routeVariableName: extractAssignedIdentifierBeforeCall(source, match.index),
      componentName: extractTanStackComponentName(config),
      serverHandlers: extractTanStackServerHandlers(config),
    })
  }
  return out
}

function extractAssignedIdentifierBeforeCall(source: string, callIndex: number): string | null {
  const prefix = source.slice(Math.max(0, callIndex - 240), callIndex)
  return /(?:^|[;\r\n])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(prefix)?.[1] ?? null
}

function extractTanStackComponentName(config: string): string | null {
  const direct = /\bcomponent\s*:\s*([A-Za-z_$][\w$]*)\b/.exec(config)?.[1]
  if (direct) return direct
  return /\bcomponent\s*:\s*\(\s*\)\s*=>\s*<([A-Za-z_$][\w$]*)\b/.exec(config)?.[1] ?? null
}

function extractTanStackServerHandlers(config: string): Array<{ method: string; calledFunctionName: string | null }> {
  const handlersKey = /\bhandlers\s*:/.exec(config)
  if (!handlersKey) return []
  const handlersObjectStart = config.indexOf('{', handlersKey.index)
  if (handlersObjectStart < 0) return []
  const handlersObjectEnd = findMatchingBrace(config, handlersObjectStart)
  if (handlersObjectEnd < 0) return []
  const handlers = config.slice(handlersObjectStart + 1, handlersObjectEnd)
  const out: Array<{ method: string; calledFunctionName: string | null }> = []
  const seen = new Set<string>()
  const methodRe = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|ANY)\s*:/g
  for (const match of handlers.matchAll(methodRe)) {
    const method = match[1]
    if (!TANSTACK_SERVER_HANDLER_METHODS.has(method) || seen.has(method)) continue
    seen.add(method)
    out.push({
      method,
      calledFunctionName: extractTanStackServerHandlerCalledFunction(handlers, match.index + match[0].length),
    })
  }
  return out
}

function extractTanStackServerHandlerCalledFunction(handlersSource: string, afterMethodColon: number): string | null {
  const arrowStart = handlersSource.indexOf('=>', afterMethodColon)
  if (arrowStart < 0) return null
  const bodyStart = handlersSource.indexOf('{', arrowStart)
  if (bodyStart < 0) return null
  const bodyEnd = findMatchingBrace(handlersSource, bodyStart)
  if (bodyEnd < 0) return null
  const body = handlersSource.slice(bodyStart + 1, bodyEnd)
  const ignored = new Set(['Response', 'Number', 'String', 'Boolean', 'Object', 'Array', 'JSON'])
  for (const call of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (previousNonWhitespace(body, (call.index ?? 0) - 1) === '.') continue
    const name = call[1]
    if (!ignored.has(name)) return name
  }
  return null
}

function previousNonWhitespace(source: string, index: number): string | null {
  for (let i = index; i >= 0; i -= 1) {
    if (!/\s/.test(source[i] ?? '')) return source[i] ?? null
  }
  return null
}

function findReactComponentNodeId(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
  componentName: string,
): string | null {
  return graphNodes.find((node) =>
    node.filePath === filePath &&
    (node.type === 'function' || node.type === 'class' || node.type === 'variable') &&
    (node.name === componentName || node.name.endsWith(`.${componentName}`)),
  )?.id ?? null
}

function findReactNodeIdByName(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
  name: string,
): string | null {
  return graphNodes.find((node) =>
    node.filePath === filePath &&
    node.type !== 'file' &&
    (node.name === name || node.name.endsWith(`.${name}`)),
  )?.id ?? null
}

function findReactHandlerFunctionNodeId(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  routeFilePath: string,
  functionName: string | null,
  imports: Map<string, string>,
): string | null {
  if (!functionName) return null
  const importedFilePath = imports.get(functionName)
  return graphNodes.find((node) =>
    (node.type === 'function' || node.type === 'method' || node.type === 'variable') &&
    (node.filePath === importedFilePath || (!importedFilePath && node.filePath === routeFilePath)) &&
    (node.name === functionName || node.name.endsWith(`.${functionName}`)),
  )?.id ?? null
}

function collectReactRouterSourceFiles(
  repoPath: string,
  configuredRouteFiles: string[],
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): string[] {
  const out = new Set<string>()

  for (const file of configuredRouteFiles) {
    if (/\.(tsx|jsx|ts|js)$/.test(file) || /(^|\/)routes\.(ts|js)$/.test(file)) out.add(file)
  }
  for (const node of graphNodes) {
    if (
      node.type === 'file' &&
      (/\.(tsx|jsx|ts|js)$/.test(node.filePath) || /(^|\/)routes\.(ts|js)$/.test(node.filePath))
    ) {
      out.add(node.filePath)
    }
  }
  for (const file of fg.sync(['**/*.{tsx,jsx,ts,js}', '**/routes.{ts,js}'], {
    cwd: repoPath,
    onlyFiles: true,
    unique: true,
    dot: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
  })) {
    out.add(file)
  }

  return [...out].sort()
}

function extractReactRouterJsxRoutePaths(source: string): string[] {
  if (!source.includes('<Route')) return []

  const out: string[] = []
  const stack: Array<string | undefined> = []
  let offset = 0

  while (offset < source.length) {
    const open = source.indexOf('<Route', offset)
    const close = source.indexOf('</Route', offset)
    if (close >= 0 && (open < 0 || close < open)) {
      stack.pop()
      const closeEnd = source.indexOf('>', close)
      offset = closeEnd >= 0 ? closeEnd + 1 : close + 8
      continue
    }
    if (open < 0) break

    const tagEnd = findJsxTagEnd(source, open)
    if (tagEnd < 0) break
    const tag = source.slice(open, tagEnd + 1)
    const parent = [...stack].reverse().find((path) => path !== undefined)
    const rawPath = /\bpath=["']([^"']+)["']/.exec(tag)?.[1]
    const isIndex = /\bindex(?:\s*=\s*\{?true\}?|\s|>)/.test(tag)
    const fullPath = rawPath
      ? joinReactRouterJsxPath(parent, rawPath)
      : isIndex
        ? (parent ?? '/')
        : undefined

    if (fullPath && !out.includes(fullPath)) out.push(fullPath)

    const selfClosing = /\/\s*>$/.test(tag)
    if (!selfClosing) stack.push(fullPath ?? parent)
    offset = tagEnd + 1
  }

  return out
}

function findJsxTagEnd(source: string, start: number): number {
  let quote: string | null = null
  let braceDepth = 0
  for (let i = start; i < source.length; i += 1) {
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
    if (ch === '{') {
      braceDepth += 1
      continue
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
      continue
    }
    if (ch === '>' && braceDepth === 0) return i
  }
  return -1
}

function joinReactRouterJsxPath(parent: string | undefined, child: string): string {
  const normalizedChild = normalizeReactRoutePath(child)
  if (!parent || child.startsWith('/')) return normalizedChild
  const parentBase = parent.endsWith('/*') ? parent.slice(0, -2) : parent
  return joinUrlPath(parentBase, normalizedChild)
}

function extractReactRouterLocalizedJsxRoutePaths(source: string, repoPath: string): string[] {
  if (!source.includes('<Route') || !/\bpath=\{\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\s*\}/.test(source)) {
    return []
  }

  const enumValues = collectTsEnumStringValues(repoPath)
  const routeMessages = collectReactIntlRouteMessages(repoPath)
  if (enumValues.size === 0 || routeMessages.size === 0) return []

  const out: string[] = []
  const stack: Array<string | undefined> = []
  let offset = 0

  while (offset < source.length) {
    const open = source.indexOf('<Route', offset)
    const close = source.indexOf('</Route', offset)
    if (close >= 0 && (open < 0 || close < open)) {
      stack.pop()
      const closeEnd = source.indexOf('>', close)
      offset = closeEnd >= 0 ? closeEnd + 1 : close + 8
      continue
    }
    if (open < 0) break

    const tagEnd = findJsxTagEnd(source, open)
    if (tagEnd < 0) break
    const tag = source.slice(open, tagEnd + 1)
    const parent = [...stack].reverse().find((path) => path !== undefined)
    const expr = /\bpath=\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\}/.exec(tag)?.[1]
    const messageKey = expr ? enumValues.get(expr) : undefined
    const localizedPaths = messageKey ? routeMessages.get(messageKey) ?? [] : []

    let stackPath: string | undefined = parent
    for (const localizedPath of localizedPaths) {
      const fullPath = parent
        ? joinReactRouterJsxPath(parent, localizedPath)
        : normalizeReactRoutePath(localizedPath)
      if (!out.includes(fullPath)) out.push(fullPath)
      stackPath ??= fullPath
    }

    const selfClosing = /\/\s*>$/.test(tag)
    if (!selfClosing) stack.push(stackPath)
    offset = tagEnd + 1
  }

  return out
}

function extractReactRouterConstJsxRoutePaths(source: string, repoPath: string): string[] {
  if (!source.includes('<Route') || !/\bpath=\{\s*[A-Za-z_$][\w$]*\s*\}/.test(source)) {
    return []
  }

  const constValues = collectStringConstValues(repoPath)
  if (constValues.size === 0) return []

  const out: string[] = []
  const stack: Array<string | undefined> = []
  let offset = 0

  while (offset < source.length) {
    const open = source.indexOf('<Route', offset)
    const close = source.indexOf('</Route', offset)
    if (close >= 0 && (open < 0 || close < open)) {
      stack.pop()
      const closeEnd = source.indexOf('>', close)
      offset = closeEnd >= 0 ? closeEnd + 1 : close + 8
      continue
    }
    if (open < 0) break

    const tagEnd = findJsxTagEnd(source, open)
    if (tagEnd < 0) break
    const tag = source.slice(open, tagEnd + 1)
    const parent = [...stack].reverse().find((path) => path !== undefined)
    const expr = /\bpath=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(tag)?.[1]
    const constPath = expr ? constValues.get(expr) : undefined

    const fullPath = constPath
      ? parent
        ? joinReactRouterJsxPath(parent, constPath)
        : normalizeReactRoutePath(constPath)
      : undefined

    if (fullPath && !out.includes(fullPath)) out.push(fullPath)

    const selfClosing = /\/\s*>$/.test(tag)
    if (!selfClosing) stack.push(fullPath ?? parent)
    offset = tagEnd + 1
  }

  return out
}

function collectStringConstValues(repoPath: string): Map<string, string> {
  const raw = new Map<string, string>()
  for (const file of fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: repoPath,
    onlyFiles: true,
    unique: true,
    dot: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
  })) {
    const source = readFileSync(joinPath(repoPath, file), 'utf-8')
    const constRe = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*([^\r\n;]+);?/g
    for (const match of source.matchAll(constRe)) {
      const expression = match[2].trim()
      if (!isRouteLikeConstExpression(expression)) continue
      raw.set(match[1], expression)
    }
  }

  const resolved = new Map<string, string>()
  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false
    for (const [name, expression] of raw) {
      if (resolved.has(name)) continue
      const value = resolveStringConstExpression(expression, resolved)
      if (!value) continue
      resolved.set(name, value)
      changed = true
    }
    if (!changed) break
  }
  return resolved
}

function isRouteLikeConstExpression(expression: string): boolean {
  return /^(['"`])/.test(expression) && expression.includes('/')
}

function resolveStringConstExpression(expression: string, values: Map<string, string>): string | null {
  const stringLiteral = /^(['"])(.*?)\1(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.exec(expression)
  if (stringLiteral) return stringLiteral[2]

  const templateLiteral = /^`([\s\S]*)`(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.exec(expression)
  if (!templateLiteral) return null
  let unresolved = false
  const value = templateLiteral[1].replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, name: string) => {
    const resolved = values.get(name)
    if (resolved === undefined) {
      unresolved = true
      return ''
    }
    return resolved
  })
  return unresolved ? null : value
}

function collectTsEnumStringValues(repoPath: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: repoPath,
    onlyFiles: true,
    unique: true,
    dot: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
  })) {
    const source = readFileSync(joinPath(repoPath, file), 'utf-8')
    const enumRe = /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{([\s\S]*?)\}/g
    for (const enumMatch of source.matchAll(enumRe)) {
      const enumName = enumMatch[1]
      const body = enumMatch[2]
      const memberRe = /\b([A-Za-z_$][\w$]*)\s*=\s*(['"])(.*?)\2/g
      for (const memberMatch of body.matchAll(memberRe)) {
        out.set(`${enumName}.${memberMatch[1]}`, memberMatch[3])
      }
    }
  }
  return out
}

function collectReactIntlRouteMessages(repoPath: string): Map<string, string[]> {
  const byKey = new Map<string, string[]>()
  const languageCodes = collectReactIntlLanguageCodes(repoPath)

  for (const file of fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: repoPath,
    onlyFiles: true,
    unique: true,
    dot: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
  })) {
    const source = readFileSync(joinPath(repoPath, file), 'utf-8')
    if (!source.includes('routes.')) continue

    const language = inferReactIntlLanguageForFile(file, source, languageCodes)
    if (!language) continue

    const messageRe = /(['"])(routes\.[^'"]+)\1\s*:\s*(['"])(\/[^'"]*)\3/g
    for (const match of source.matchAll(messageRe)) {
      const key = match[2]
      const localizedPath = joinUrlPath(`/${language}`, match[4])
      const paths = byKey.get(key) ?? []
      if (!paths.includes(localizedPath)) paths.push(localizedPath)
      byKey.set(key, paths)
    }
  }

  return byKey
}

function collectReactIntlLanguageCodes(repoPath: string): Set<string> {
  const out = new Set<string>()
  for (const file of fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: repoPath,
    onlyFiles: true,
    unique: true,
    dot: false,
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
  })) {
    const source = readFileSync(joinPath(repoPath, file), 'utf-8')
    const enumRe = /\b(?:export\s+)?enum\s+[A-Za-z_$][\w$]*Language[A-Za-z_$\w]*\s*\{([\s\S]*?)\}/g
    for (const enumMatch of source.matchAll(enumRe)) {
      const memberRe = /=\s*(['"])([a-z]{2}(?:-[A-Z]{2})?)\1/g
      for (const memberMatch of enumMatch[1].matchAll(memberRe)) {
        out.add(memberMatch[2])
      }
    }
  }
  return out
}

function inferReactIntlLanguageForFile(file: string, source: string, languageCodes: Set<string>): string | null {
  const leaf = file.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '')
  if (leaf && languageCodes.has(leaf)) return leaf
  const exportedConst = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*:/.exec(source)?.[1]
    ?? /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/.exec(source)?.[1]
  if (exportedConst && languageCodes.has(exportedConst)) return exportedConst
  if (leaf === 'base-strings' && languageCodes.has('en')) return 'en'
  return null
}

function extractReactRouterFrameworkRoutePaths(source: string): string[] {
  if (!source.includes('@react-router/dev/routes')) return []

  const prefixBlocks = extractReactRouterPrefixBlocks(source)
  let sourceWithoutPrefixBlocks = source
  for (const block of [...prefixBlocks].sort((a, b) => b.start - a.start)) {
    sourceWithoutPrefixBlocks = `${sourceWithoutPrefixBlocks.slice(0, block.start)}${' '.repeat(block.end - block.start)}${sourceWithoutPrefixBlocks.slice(block.end)}`
  }

  const out: string[] = []
  if (/\bindex\s*\(/.test(sourceWithoutPrefixBlocks)) out.push('/')

  const routeRe = /\broute\s*\(\s*(['"])(.*?)\1/g
  for (const match of sourceWithoutPrefixBlocks.matchAll(routeRe)) {
    out.push(normalizeReactRoutePath(match[2]))
  }

  const helperNames = new Set<string>()
  const helperRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*=>\s*route\s*\(\s*\2\b/g
  for (const match of sourceWithoutPrefixBlocks.matchAll(helperRe)) {
    helperNames.add(match[1])
  }
  for (const helperName of helperNames) {
    const helperCallRe = new RegExp(`\\b${helperName}\\s*\\(\\s*(['"])(.*?)\\1`, 'g')
    for (const match of sourceWithoutPrefixBlocks.matchAll(helperCallRe)) {
      out.push(normalizeReactRoutePath(match[2]))
    }
  }

  for (const block of prefixBlocks) {
    for (const childPath of extractReactRouterFrameworkRoutePaths(`import { route } from "@react-router/dev/routes";\n${block.body}`)) {
      out.push(childPath === '/' ? normalizeReactRoutePath(block.prefix) : joinUrlPath(block.prefix, childPath))
    }
  }

  return [...new Set(out)]
}

function extractReactRouterPrefixBlocks(source: string): Array<{ prefix: string; body: string; start: number; end: number }> {
  const out: Array<{ prefix: string; body: string; start: number; end: number }> = []
  const prefixRe = /\bprefix\s*\(\s*(['"])(.*?)\1\s*,\s*\[/g
  let match: RegExpExecArray | null

  while ((match = prefixRe.exec(source)) !== null) {
    const arrayStart = prefixRe.lastIndex - 1
    const arrayEnd = findMatchingBracket(source, arrayStart)
    if (arrayEnd < 0) continue
    const callEnd = findMatchingParen(source, source.indexOf('(', match.index))
    out.push({
      prefix: normalizeReactRoutePath(match[2]),
      body: source.slice(arrayStart + 1, arrayEnd),
      start: match.index,
      end: callEnd > arrayEnd ? callEnd + 1 : arrayEnd + 1,
    })
  }

  return out
}

function findMatchingBracket(source: string, openBracket: number): number {
  if (openBracket < 0) return -1
  let depth = 0
  for (let i = openBracket; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '[') depth += 1
    if (ch === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function inferReactRouterFrameworkHandlerNodeId(
  source: string,
  routeConfigFile: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): string | null {
  if (!source.includes('@react-router/dev/routes')) return null
  const routeModule = /\b(?:index|route)\s*\(\s*(['"])(.*?)\1/.exec(source)?.[2]
  if (!routeModule) return null
  const candidate = joinPath(dirname(routeConfigFile), routeModule).replace(/\\/g, '/')
  return graphNodes.find((node) => node.type === 'file' && node.filePath === candidate)?.id ?? null
}

function extractReactRouterFlatRoutePaths(
  source: string,
  repoPath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): Array<{ path: string; handlerNodeId: string }> {
  if (!source.includes('flatRoutes')) return []

  const out: Array<{ path: string; handlerNodeId: string }> = []
  const seen = new Set<string>()
  for (const filePath of fg.sync('app/routes/**/*.{ts,tsx,js,jsx,mdx}', {
    cwd: repoPath,
    onlyFiles: true,
    unique: true,
    dot: false,
    ignore: ['**/+types/**'],
  })) {
    const routePath = reactRouterFlatRouteFileToPath(filePath)
    if (!routePath || seen.has(routePath)) continue
    seen.add(routePath)
    const fileNodeId = graphNodes.find((node) => node.type === 'file' && node.filePath === filePath)?.id
    if (!fileNodeId) continue
    out.push({ path: routePath, handlerNodeId: fileNodeId })
  }
  return out
}

function reactRouterFlatRouteFileToPath(filePath: string): string | null {
  const match = /^app\/routes\/(.+)\.(?:[jt]sx?|mdx)$/.exec(filePath)
  if (!match) return null

  const relativeRouteFile = match[1]
  const routeId = reactRouterFlatRouteIdForFile(relativeRouteFile)
  if (!routeId) return null

  const segments: string[] = []
  let hasIndex = false
  for (const rawSegment of routeId.split(/[/.]/)) {
    if (!rawSegment) continue
    if (rawSegment === '_index') {
      hasIndex = true
      continue
    }
    if (rawSegment.startsWith('_')) continue
    if (rawSegment.endsWith('_')) {
      segments.push(rawSegment.slice(0, -1))
      continue
    }
    if (rawSegment.startsWith('$')) {
      segments.push(`:${rawSegment.slice(1)}`)
      continue
    }
    segments.push(rawSegment)
  }

  if (segments.length === 0) return hasIndex ? '/' : null
  return normalizeReactRoutePath(segments.join('/'))
}

function reactRouterFlatRouteIdForFile(relativeRouteFile: string): string | null {
  const parts = relativeRouteFile.split('/')
  const leaf = parts.at(-1)
  if (!leaf) return null

  if (leaf === 'route') {
    const routeDir = parts.slice(0, -1).join('/')
    return routeDir || null
  }

  if (parts.length > 1) return null
  return leaf
}

function discoverReactLazyRouteBases(
  repoPath: string,
  routeFiles: string[],
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): Map<string, string> {
  const out = new Map<string, string>()

  for (const file of routeFiles) {
    const abs = joinPath(repoPath, file)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    const lazyRe = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*React\.lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*(['"])(.*?)\2\s*\)\s*\)/g
    for (const lazyMatch of source.matchAll(lazyRe)) {
      const componentName = lazyMatch[1]
      const target = resolveRelativeSourceFile(file, lazyMatch[3], repoPath, graphNodes)
      if (!target) continue

      for (const rawBasePath of extractRoutePathsRenderingComponent(source, componentName)) {
        const basePath = normalizeReactRoutePath(rawBasePath).replace(/\/\*$/, '')
        if (basePath) {
          out.set(target.filePath, basePath)
          break
        }
      }
    }
  }

  return out
}

function extractRoutePathsRenderingComponent(source: string, componentName: string): string[] {
  const out: string[] = []
  const componentRe = new RegExp(`<${componentName}\\b`, 'g')
  for (const match of source.matchAll(componentRe)) {
    const routeStart = source.lastIndexOf('<Route', match.index)
    if (routeStart < 0) continue
    const routeBlock = source.slice(routeStart, match.index)
    const pathMatches = [...routeBlock.matchAll(/\bpath=["']([^"']+)["']/g)]
    const path = pathMatches[pathMatches.length - 1]?.[1]
    if (path) out.push(path)
  }
  return out
}

function joinNestedReactRoutePath(basePath: string, rawChild: string): string {
  const child = normalizeReactRoutePath(rawChild)
  if (child === '/' || rawChild === '') return basePath
  if (child === '/*') return `${basePath}/*`.replace(/\/+/g, '/')
  return `${basePath.replace(/\/$/, '')}/${child.replace(/^\//, '')}`.replace(/\/+/g, '/')
}

function inferReactRouterBasename(repoPath: string, routeFile: string): string | null {
  const dir = dirname(routeFile)
  for (const name of ['main.tsx', 'main.jsx', 'index.tsx', 'index.jsx']) {
    const entryFile = dir === '.' ? name : `${dir}/${name}`
    const abs = joinPath(repoPath, entryFile)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    const match = /<BrowserRouter\b[^>]*\bbasename=["']([^"']+)["'][^>]*>/m.exec(source)
    if (match?.[1]) return normalizeReactRoutePath(match[1])
  }
  return null
}

function applyReactRouterBasename(basename: string | null, routePath: string): string {
  if (!basename || basename === '/') return routePath
  if (routePath === '/') return basename
  if (routePath === '/*') return `${basename}/*`.replace(/\/+/g, '/')
  return `${basename.replace(/\/$/, '')}/${routePath.replace(/^\//, '')}`.replace(/\/+/g, '/')
}

function makeReactTanStackServerRouteEntry(
  path: string,
  httpMethod: string,
  handlerNodeId: string,
  matchedNodeIds: string[],
): EntryPointDraft {
  return {
    framework: 'react_router_v6',
    kind: 'api',
    httpMethod,
    path,
    fullPath: path,
    handlerNodeId,
    metadata: { sourceFallback: 'react_tanstack_server_route' },
    detectionSource: 'source:react_tanstack_router',
    confidence: 'medium',
    detectionEvidence: {
      matchedRuleId: 'source_react_tanstack_server_route',
      matchedNodeIds,
      matchedEdgeIds: [],
    },
  }
}

function makeReactRouterFallbackEntry(
  path: string,
  handlerNodeId: string,
  sourceFallback:
    | 'react_router_v6_jsx'
    | 'react_router_v6_object'
    | 'react_microfrontend_router'
    | 'react_router_v6_framework'
    | 'react_router_v6_flat_routes'
    | 'react_tanstack_file_route',
  matchedNodeIds = [handlerNodeId],
): EntryPointDraft {
  return {
    framework: 'react_router_v6',
    kind: 'page',
    path,
    fullPath: path,
    handlerNodeId,
    metadata: { sourceFallback },
    detectionSource: sourceFallback === 'react_tanstack_file_route'
      ? 'source:react_tanstack_router'
      : sourceFallback === 'react_microfrontend_router'
        ? 'source:react_microfrontend_router'
        : 'source:react_router_v6',
    confidence: 'medium',
    detectionEvidence: {
      matchedRuleId:
        sourceFallback === 'react_tanstack_file_route'
          ? 'source_react_tanstack_file_route'
          : sourceFallback === 'react_router_v6_jsx'
          ? 'source_react_route_jsx'
          : sourceFallback === 'react_router_v6_object'
            ? 'source_react_create_browser_router'
            : sourceFallback === 'react_microfrontend_router'
              ? 'source_react_microfrontend_router'
              : sourceFallback === 'react_router_v6_framework'
              ? 'source_react_router_framework_routes'
              : 'source_react_router_flat_routes',
      matchedNodeIds,
      matchedEdgeIds: [],
    },
  }
}

function extractReactRouterObjectPaths(source: string): string[] {
  return extractReactRouterObjectRoutes(source, [], '', '').map((route) => route.path)
}

function extractReactRouterObjectRoutes(
  source: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
  repoPath: string,
): Array<{ path: string; handlerNodeId: string | null }> {
  if (
    !source.includes('createBrowserRouter') &&
    !source.includes('createHashRouter') &&
    !source.includes('createMemoryRouter') &&
    !source.includes('createFrontendRouter') &&
    !source.includes('createSlice') &&
    !source.includes('useRoutes') &&
    !source.includes('RouteObject') &&
    !source.includes('RSCRouteConfig')
  ) {
    return []
  }

  const out: Array<{ path: string; handlerNodeId: string | null }> = []
  const stack: Array<{ indent: number; path: string }> = []
  let cursor = 0
  for (const line of source.split(/\r?\n/)) {
    const indexMatch = /^(\s*)(?:[{,]\s*)?.*\bindex:\s*true\b/.exec(line)
    if (indexMatch) {
      const indent = indexMatch[1].length
      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        stack.pop()
      }
      const parent = stack[stack.length - 1]?.path
      if (parent) {
        const indexPosition = line.indexOf('index:')
        const block = extractEnclosingObjectBlock(source, cursor + (indexPosition >= 0 ? indexPosition : (indexMatch.index ?? 0))) ?? line
        out.push({
          path: parent,
          handlerNodeId: findReactRouteElementHandlerNodeId(block, source, graphNodes, filePath, repoPath),
        })
      }
      cursor += line.length + 1
      continue
    }

    const match = /^(\s*)(?:[{,]\s*)?.*\bpath:\s*["']([^"']*)["']/.exec(line)
    if (!match) {
      cursor += line.length + 1
      continue
    }

    const indent = match[1].length
    const rawPath = match[2]
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1]?.path
    const path = joinReactRouterPath(parent, rawPath)
    const pathPosition = line.indexOf('path:')
    const block = extractEnclosingObjectBlock(source, cursor + (pathPosition >= 0 ? pathPosition : (match.index ?? 0))) ?? line
    out.push({
      path,
      handlerNodeId: findReactRouteElementHandlerNodeId(block, source, graphNodes, filePath, repoPath),
    })
    if (!/}\s*,?\s*$/.test(line.trim())) {
      stack.push({ indent, path })
    }
    cursor += line.length + 1
  }
  return out
}

function findReactRouteElementHandlerNodeId(
  objectBlock: string,
  source: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
  repoPath: string,
): string | null {
  const componentName = /\belement\s*:\s*<([A-Za-z_$][\w$]*)\b/.exec(objectBlock)?.[1]
  if (!componentName) return null
  return findReactComponentNodeId(graphNodes, filePath, componentName)
    ?? findImportedReactComponentNodeId(source, graphNodes, filePath, repoPath, componentName)
}

function findImportedReactComponentNodeId(
  source: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
  repoPath: string,
  componentName: string,
): string | null {
  if (!repoPath) return null

  for (const match of source.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    const localName = match[1]
    if (localName !== componentName) continue
    const target = resolveRelativeSourceFile(filePath, match[2], repoPath, graphNodes)
    if (!target) continue
    const byLocalName = findReactComponentNodeId(graphNodes, target.filePath, localName)
    if (byLocalName) return byLocalName
    const defaultNode = findDefaultReactComponentNodeId(graphNodes, target.filePath)
    if (defaultNode) return defaultNode
  }

  for (const match of source.matchAll(/\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveRelativeSourceFile(filePath, match[2], repoPath, graphNodes)
    if (!target) continue
    for (const part of match[1].split(',')) {
      const pieces = part.trim().split(/\s+as\s+/i).map((piece) => piece.trim()).filter(Boolean)
      const importedName = pieces[0]
      const localName = pieces[1] ?? importedName
      if (!importedName || localName !== componentName) continue
      const byImportedName = findReactComponentNodeId(graphNodes, target.filePath, importedName)
      if (byImportedName) return byImportedName
      const byLocalName = findReactComponentNodeId(graphNodes, target.filePath, localName)
      if (byLocalName) return byLocalName
    }
  }

  return null
}

function findDefaultReactComponentNodeId(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
): string | null {
  const componentNodes = graphNodes.filter((node) =>
    node.filePath === filePath &&
    (node.type === 'function' || node.type === 'class' || node.type === 'variable'),
  )
  return componentNodes.find((node) => node.isDefaultExport)?.id
    ?? (componentNodes.length === 1 ? componentNodes[0].id : null)
}

function joinReactRouterPath(parent: string | undefined, child: string): string {
  const normalizedChild = normalizeReactRoutePath(child)
  if (!parent || child.startsWith('/')) return normalizedChild
  if (normalizedChild === '/*') return `${parent}/*`.replace(/\/+/g, '/')
  return `${parent.replace(/\/$/, '')}/${normalizedChild.replace(/^\//, '')}`.replace(/\/+/g, '/')
}

function joinUrlPath(parent: string, child: string): string {
  const raw = `${parent.replace(/\/$/, '')}/${child.replace(/^\//, '')}`
  const normalized = raw.replace(/\/+/g, '/')
  if (normalized === '') return '/'
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}

function buildReactRouterInteractionEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const reactActive = input.detections.some((d) => d.framework === 'react_router_v6' && d.active)
  if (!reactActive) return []

  const routeFiles = input.graphNodes.filter(
    (node) =>
      node.type === 'file' &&
      /(^|\/)(app\/)?routes\/.+\.(tsx|jsx|ts|js)$/.test(node.filePath) &&
      !/(^|\/)(actions|loaders|utils|helpers)\.(tsx|jsx|ts|js)$/.test(node.filePath),
  )
  const out: EntryPointDraft[] = buildReactRouterObjectInteractionEntries(input)
  const routePathByFile = inferReactRouterRoutePathByFile(input)
  for (const fileNode of routeFiles) {
    const source = safeReadSource(input.repoPath, fileNode.filePath)
    if (!source) continue
    const routePath = routePathByFile.get(fileNode.filePath) ?? reactRouterRouteModulePath(fileNode.filePath)
    for (const interaction of extractReactRouterInteractions(source)) {
      const handlerNode = input.graphNodes.find((node) => node.filePath === fileNode.filePath && node.type === 'function' && node.name === interaction.name)
      out.push({
        framework: 'react_router_v6',
        kind: 'api',
        httpMethod: interaction.kind === 'loader' || interaction.kind === 'clientLoader' ? 'GET' : 'POST',
        path: routePath,
        fullPath: `${routePath}#${interaction.kind}`,
        handlerNodeId: handlerNode?.id ?? fileNode.id,
        metadata: {
          interactionKind: interaction.kind === 'loader'
            ? 'react_router_loader'
            : interaction.kind === 'action'
              ? 'react_router_action'
              : interaction.kind === 'clientLoader'
                ? 'react_router_client_loader'
                : 'react_router_client_action',
          ...(interaction.kind.startsWith('client') ? { clientInteraction: true } : {}),
          parentRoute: routePath,
        },
        detectionSource: 'source:react_router_interaction',
        confidence: handlerNode ? 'high' : 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_react_router_loader_action',
          matchedNodeIds: [fileNode.id, handlerNode?.id].filter((id): id is string => Boolean(id)),
          matchedEdgeIds: [],
        },
      })
    }
  }
  return out
}

function inferReactRouterRoutePathByFile(input: {
  repoPath: string
  stackInfo: StackInfoForBuildRoute
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): Map<string, string> {
  const out = new Map<string, string>()
  const routeConfigFiles = new Set([
    ...(input.stackInfo.routingFiles ?? []),
    ...input.graphNodes
      .filter((node) => node.type === 'file' && /(^|\/)routes\.(ts|js)$/.test(node.filePath))
      .map((node) => node.filePath),
  ])

  for (const filePath of routeConfigFiles) {
    const source = safeReadSource(input.repoPath, filePath)
    if (!source) continue
    const baseDir = dirname(filePath)
    for (const entry of extractReactRouterDevRouteTargets(source)) {
      const targetFile = resolveRouteTargetFile(baseDir, entry.target, input.graphNodes)
      if (targetFile) out.set(targetFile, entry.path)
    }
    for (const entry of extractReactRouterLazyRouteTargets(source)) {
      const targetFile = resolveRouteTargetFile(baseDir, entry.target, input.graphNodes)
      if (targetFile) out.set(targetFile, entry.path)
    }
  }

  return out
}

function buildReactRouterObjectInteractionEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const routeConfigFiles = collectReactRouterSourceFiles(
    input.repoPath,
    input.stackInfo.routingFiles ?? [],
    input.graphNodes,
  ).filter((file) => {
    const source = safeReadSource(input.repoPath, file)
    return source?.includes('createBrowserRouter') || source?.includes('createHashRouter') || source?.includes('createMemoryRouter')
  })
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const filePath of routeConfigFiles) {
    const source = safeReadSource(input.repoPath, filePath)
    if (!source) continue
    const imports = collectNamedImportSources(source, filePath, input.repoPath, input.graphNodes)
    const fileNode = input.graphNodes.find((node) => node.type === 'file' && node.filePath === filePath)
    for (const route of extractReactRouterObjectInteractions(source)) {
      for (const interaction of route.interactions) {
        const targetFile = imports.get(interaction.name) ?? filePath
        const handlerNode = input.graphNodes.find(
          (node) => node.filePath === targetFile && node.type === 'function' && node.name === interaction.name,
        )
        const key = `${route.path}#${interaction.kind}:${interaction.name}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          framework: 'react_router_v6',
          kind: 'api',
          httpMethod: interaction.kind === 'loader' ? 'GET' : 'POST',
          path: route.path,
          fullPath: `${route.path}#${interaction.kind}`,
          handlerNodeId: handlerNode?.id ?? fileNode?.id ?? `${input.repoId}:${filePath}`,
          metadata: {
            interactionKind: interaction.kind === 'loader' ? 'react_router_loader' : 'react_router_action',
            parentRoute: route.path,
            handlerName: interaction.name,
          },
          detectionSource: 'source:react_router_interaction',
          confidence: handlerNode ? 'high' : 'medium',
          detectionEvidence: {
            matchedRuleId: 'source_react_router_object_loader_action',
            matchedNodeIds: [fileNode?.id, handlerNode?.id].filter((id): id is string => Boolean(id)),
            matchedEdgeIds: [],
          },
        })
      }
    }
  }

  return out
}

function collectNamedImportSources(
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
      const imported = part.trim().split(/\s+as\s+/i)
      const localName = (imported[1] ?? imported[0])?.trim()
      if (localName) out.set(localName, target.filePath)
    }
  }
  return out
}

function extractReactRouterObjectInteractions(source: string): Array<{
  path: string
  interactions: Array<{ kind: 'loader' | 'action'; name: string }>
}> {
  const out: Array<{ path: string; interactions: Array<{ kind: 'loader' | 'action'; name: string }> }> = []
  const pathRe = /\bpath\s*:\s*(['"])([^'"]*)\1/g
  for (const match of source.matchAll(pathRe)) {
    const block = extractEnclosingObjectBlock(source, match.index ?? 0)
    if (!block) continue
    const interactions: Array<{ kind: 'loader' | 'action'; name: string }> = []
    const loader = /\bloader\s*:\s*([A-Za-z_$][\w$]*)/.exec(block)?.[1]
    const action = /\baction\s*:\s*([A-Za-z_$][\w$]*)/.exec(block)?.[1]
    if (loader) interactions.push({ kind: 'loader', name: loader })
    if (action) interactions.push({ kind: 'action', name: action })
    if (interactions.length > 0) {
      out.push({ path: normalizeReactRoutePath(match[2]), interactions })
    }
  }
  return out
}

function extractEnclosingObjectBlock(source: string, fromIndex: number): string | null {
  const start = source.lastIndexOf('{', fromIndex)
  if (start < 0) return null
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }

  return null
}

function extractReactRouterDevRouteTargets(source: string): Array<{ path: string; target: string }> {
  const out: Array<{ path: string; target: string }> = []
  for (const match of source.matchAll(/\bindex\s*\(\s*(['"])(.*?)\1\s*\)/g)) {
    out.push({ path: '/', target: match[2] })
  }
  for (const match of source.matchAll(/\broute\s*\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3/g)) {
    out.push({ path: normalizeReactRoutePath(match[2]), target: match[4] })
  }
  return out
}

function extractReactRouterLazyRouteTargets(source: string): Array<{ path: string; target: string }> {
  const out: Array<{ path: string; target: string }> = []
  const stack: Array<{ indent: number; path: string }> = []
  let pendingIndex: { indent: number; path: string } | null = null

  for (const line of source.split(/\r?\n/)) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) stack.pop()

    const pathMatch = /\bpath\s*:\s*['"]([^'"]*)['"]/.exec(line)
    if (pathMatch) {
      const parent = stack[stack.length - 1]?.path
      stack.push({ indent, path: joinReactRouterPath(parent, pathMatch[1]) })
      pendingIndex = null
      continue
    }

    if (/\bindex\s*:\s*true\b/.test(line)) {
      pendingIndex = { indent, path: stack[stack.length - 1]?.path ?? '/' }
      continue
    }

    const lazyMatch = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line)
    if (!lazyMatch) continue
    const indexPath = pendingIndex && indent >= pendingIndex.indent ? pendingIndex.path : null
    out.push({ path: indexPath ?? stack[stack.length - 1]?.path ?? '/', target: lazyMatch[1] })
    pendingIndex = null
  }

  return out
}

function resolveRouteTargetFile(
  baseDir: string,
  target: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): string | null {
  const base = joinPath(baseDir, target).replace(/\\/g, '/').replace(/^\.\//, '')
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}.mdx`,
    `${base}/route.tsx`,
    `${base}/route.ts`,
    `${base}/route.jsx`,
    `${base}/route.js`,
  ]
  return candidates.find((candidate) => graphNodes.some((node) => node.type === 'file' && node.filePath === candidate)) ?? null
}

function extractReactRouterInteractions(source: string): Array<{ kind: 'loader' | 'action' | 'clientLoader' | 'clientAction'; name: string }> {
  const out: Array<{ kind: 'loader' | 'action' | 'clientLoader' | 'clientAction'; name: string }> = []
  for (const kind of ['loader', 'action', 'clientLoader', 'clientAction'] as const) {
    if (new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${kind}\\s*\\(`).test(source)
      || new RegExp(`\\bexport\\s+const\\s+${kind}\\s*=`).test(source)) {
      out.push({ kind, name: kind })
    }
  }
  return out
}

function reactRouterRouteModulePath(filePath: string): string {
  const match = /(?:^|\/)(?:app\/)?routes\/(.+)\.(?:tsx|jsx|ts|js)$/.exec(filePath)
  if (!match) return '/'
  const cleaned = match[1]
    .replace(/\/route$/, '')
    .replace(/\/route$/, '')
    .replace(/(?:^|\/)_index$/, '')
    .replace(/(?:^|\.)_index$/, '')
    .replace(/(?:^|\/)index$/, '')
    .replace(/\$$/, '*')
    .replace(/\$([A-Za-z_$][\w$]*)/g, ':$1')
    .replace(/\./g, '/')
    .split('/')
    .filter((segment) => segment && !segment.startsWith('_layout'))
    .join('/')
  return normalizeReactRoutePath(cleaned || '/')
}

function safeReadSource(repoPath: string, filePath: string): string | null {
  try {
    return readFileSync(joinPath(repoPath, filePath), 'utf-8')
  } catch {
    return null
  }
}

function normalizeReactRoutePath(path: string): string {
  if (path === '*') return '/*'
  const p = path.startsWith('/') ? path : `/${path}`
  return p
    .replace(/\/+/g, '/')
    .replace(/\[(\w+)\]/g, ':$1')
    .replace(/\/\$(?=\/|$)/g, '/*')
    .replace(/\$([A-Za-z_$][\w$]*)/g, ':$1')
}


export {
  buildReactRouterFallbackEntries,
  buildReactRouterInteractionEntries,
  buildReactTanStackRouterFallbackEntries,
}
