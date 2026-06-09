import { existsSync, readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { codeNodes } from '@/db/schema/code_graph.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from '../types.js'
import {
  findMatchingBrace,
  findMatchingBracket,
  joinUrlPath,
  normalizeReactRoutePath,
  stripJsLikeComments,
} from './source_fallback_shared.js'
import type { LegacyFallbackInput } from './source_fallback_types.js'

interface FlutterGoRouteCall {
  start: number
  end: number
  path: string
  fullPath: string
  component?: string | null
}

function buildFlutterGoRouterFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const goRouterActive = input.detections.some((d) => d.framework === 'flutter_gorouter' && d.active)
  if (!goRouterActive) return []

  const dartFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && node.filePath.endsWith('.dart') && !node.filePath.startsWith('test/'),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  const routeNameConstants = collectDartRouteNameConstants(input.repoPath, dartFiles)

  for (const fileNode of dartFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    if (!source.includes('GoRoute')) continue

    const fallbackHandlerNode = input.graphNodes.find(
      (node) => node.filePath === fileNode.filePath && node.type === 'method' && node.name.endsWith('.build'),
    )

    for (const route of extractFlutterGoRouteCalls(source, routeNameConstants)) {
      if (seen.has(route.fullPath)) continue
      seen.add(route.fullPath)
      const componentHandlerNode = route.component
        ? input.graphNodes.find((node) => node.name === route.component && (node.type === 'class' || node.type === 'function'))
        : null
      const handlerNode = componentHandlerNode ?? fallbackHandlerNode
      const handlerNodeId = handlerNode?.id ?? fileNode.id
      out.push({
        framework: 'flutter_gorouter',
        kind: 'page',
        path: route.fullPath,
        fullPath: route.fullPath,
        handlerNodeId,
        metadata: {
          sourceFallback: 'flutter_gorouter_nested_routes',
          routeResolution: 'table_resolved',
          ...(route.component ? { component: route.component } : {}),
        },
        detectionSource: 'source:flutter_gorouter',
        confidence: handlerNode ? 'high' : 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_flutter_gorouter_nested_routes',
          matchedNodeIds: [...new Set([fileNode.id, handlerNodeId])],
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function extractFlutterGoRouteCalls(
  source: string,
  routeNameConstants: Map<string, string> = new Map(),
): FlutterGoRouteCall[] {
  const calls: FlutterGoRouteCall[] = []
  const navigationItemRanges = findFlutterNavigationItemRanges(source)
  const goRouteRe = /\bGoRoute\s*\(/g
  let match: RegExpExecArray | null
  while ((match = goRouteRe.exec(source)) !== null) {
    if (navigationItemRanges.some((range) => match!.index >= range.start && match!.index <= range.end)) continue
    const openParen = source.indexOf('(', match.index)
    const end = findMatchingParen(source, openParen)
    if (end < 0) continue
    const body = source.slice(openParen + 1, end)
    const path = extractDartNamedStringArg(body, 'path', routeNameConstants)
    if (!path) continue
    calls.push({
      start: match.index,
      end,
      path,
      fullPath: normalizeReactRoutePath(path),
      component: extractDartRouteComponent(body),
    })
  }
  const typedOrGeneratedRouteRe = /\b(?:TypedGoRoute(?:<[^>]+>)?|GoRouteData\.\$route)\s*\(/g
  while ((match = typedOrGeneratedRouteRe.exec(source)) !== null) {
    if (navigationItemRanges.some((range) => match!.index >= range.start && match!.index <= range.end)) continue
    const openParen = source.indexOf('(', match.index)
    const end = findMatchingParen(source, openParen)
    if (end < 0) continue
    const body = source.slice(openParen + 1, end)
    const path = extractDartNamedStringArg(body, 'path', routeNameConstants)
    if (!path) continue
    calls.push({
      start: match.index,
      end,
      path,
      fullPath: normalizeReactRoutePath(path),
      component: extractDartRouteComponent(body),
    })
  }

  calls.sort((a, b) => a.start - b.start)
  for (const call of calls) {
    const parent = [...calls]
      .reverse()
      .find((candidate) => candidate.start < call.start && candidate.end > call.end)
    if (!parent) continue
    call.fullPath = call.path.startsWith('/')
      ? normalizeReactRoutePath(call.path)
      : normalizeReactRoutePath(`${parent.fullPath}/${call.path}`)
  }

  const dataDrivenRoutes = extractFlutterDemoRouteValues(source, routeNameConstants)
  if (dataDrivenRoutes.length > 0 && /\bpath\s*:\s*demo\.route\b/.test(source)) {
    const parent = calls.find((call) => call.path === '/') ?? calls[0]
    const parentPath = parent?.fullPath ?? '/'
    for (const path of dataDrivenRoutes) {
      const fullPath = path.startsWith('/')
        ? normalizeReactRoutePath(path)
        : normalizeReactRoutePath(`${parentPath}/${path}`)
      if (calls.some((call) => call.fullPath === fullPath)) continue
      calls.push({ start: parent?.start ?? 0, end: parent?.end ?? 0, path, fullPath })
    }
  }

  if (/\bpath\s*:\s*item\.path\b/.test(source)) {
    for (const path of extractFlutterNavigationItemRoutes(source, routeNameConstants)) {
      const fullPath = normalizeReactRoutePath(path)
      if (calls.some((call) => call.fullPath === fullPath)) continue
      calls.push({ start: 0, end: 0, path, fullPath })
    }
  }

  return calls
}

function findFlutterNavigationItemRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /\bNavigationItem\s*\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const openParen = source.indexOf('(', match.index)
    const end = findMatchingParen(source, openParen)
    if (end >= 0) ranges.push({ start: match.index, end })
  }
  return ranges
}

function extractFlutterNavigationItemRoutes(
  source: string,
  routeNameConstants: Map<string, string>,
): string[] {
  const out: string[] = []
  const re = /\bNavigationItem\s*\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const openParen = source.indexOf('(', match.index)
    const end = findMatchingParen(source, openParen)
    if (end < 0) continue
    const body = source.slice(openParen + 1, end)
    const basePath = extractDartNamedStringArg(body, 'path', routeNameConstants)
    if (!basePath) continue
    out.push(basePath)
    for (const child of extractFlutterGoRouteCalls(body, routeNameConstants)) {
      if (child.fullPath === '/') continue
      out.push(joinUrlPath(basePath, child.fullPath))
    }
  }
  return [...new Set(out)]
}

function collectDartRouteNameConstants(
  repoPath: string,
  dartFiles: Array<typeof codeNodes.$inferSelect>,
): Map<string, string> {
  const out = new Map<string, string>()
  const bareConstants = new Map<string, string | null>()
  const rememberBareConstant = (name: string, value: string) => {
    const current = bareConstants.get(name)
    if (current === undefined) {
      bareConstants.set(name, value)
    } else if (current !== value) {
      bareConstants.set(name, null)
    }
  }
  for (const fileNode of dartFiles) {
    const abs = joinPath(repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    const constsByClass = new Map<string, Map<string, string>>()
    const constRe = /\bstatic\s+(?:const\s+)?(?:String\s+)?([A-Za-z_]\w*)\s*=\s*(['"])([^'"]+)\2/g
    for (const match of source.matchAll(constRe)) {
      const before = source.slice(0, match.index)
      const classMatches = [...before.matchAll(/\b(?:class|abstract\s+final\s+class)\s+([A-Za-z_]\w*)\b/g)]
      const className = classMatches.at(-1)?.[1]
      if (!className) continue
      const classConsts = constsByClass.get(className) ?? new Map<string, string>()
      classConsts.set(match[1], match[3])
      constsByClass.set(className, classConsts)
    }
    const getterRe = /\bstatic\s+(?:String\s+)?get\s+([A-Za-z_]\w*)\s*=>\s*(['"])([^'"]+)\2/g
    for (const match of source.matchAll(getterRe)) {
      const before = source.slice(0, match.index)
      const classMatches = [...before.matchAll(/\b(?:class|abstract\s+final\s+class)\s+([A-Za-z_]\w*)\b/g)]
      const className = classMatches.at(-1)?.[1]
      if (!className) continue
      const classConsts = constsByClass.get(className) ?? new Map<string, string>()
      classConsts.set(match[1], match[3])
      constsByClass.set(className, classConsts)
    }
    for (const [className, classConsts] of constsByClass.entries()) {
      for (const [name, raw] of classConsts.entries()) {
        const resolved = raw.replace(/\$([A-Za-z_]\w*)/g, (_all, ref: string) => classConsts.get(ref) ?? '')
        out.set(`${className}.${name}`, resolved)
        rememberBareConstant(name, resolved)
      }
    }
    for (const [name, value] of collectDartEnumPathConstants(source).entries()) {
      out.set(name, value)
    }
    const routeCtorRe = /\bclass\s+([A-Za-z_]\w*)\s+extends\s+[A-Za-z_]\w*(?:<[^>]+>)?(?:\s+implements\s+[^{]+)?\s*\{[\s\S]*?\bconst\s+\1\s*\([^)]*\)\s*:\s*super\s*\(\s*(['"])([^'"]+)\2/g
    for (const match of source.matchAll(routeCtorRe)) {
      out.set(`${match[1]}.path`, match[3])
    }
    for (const [name, value] of collectDartGoRouterPathObjects(source).entries()) {
      out.set(name, value)
    }
  }
  for (const [name, value] of bareConstants.entries()) {
    if (value !== null && !out.has(name)) out.set(name, value)
  }
  return out
}

function collectDartEnumPathConstants(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const enumRe = /\benum\s+([A-Za-z_]\w*)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = enumRe.exec(source)) !== null) {
    const enumName = match[1]
    const openBrace = source.indexOf('{', match.index)
    const closeBrace = findMatchingBrace(source, openBrace)
    if (closeBrace < 0) continue
    const body = source.slice(openBrace + 1, closeBrace)
    const constantsEnd = findTopLevelDartEnumConstantsEnd(body)
    const constantsBody = body.slice(0, constantsEnd)
    for (const constant of constantsBody.matchAll(/\b([A-Za-z_]\w*)\s*\(\s*(['"])([^'"]+)\2(?:\s*,[^)]*)?\s*\)/g)) {
      out.set(`${enumName}.${constant[1]}.path`, constant[3])
    }
  }
  return out
}

function findTopLevelDartEnumConstantsEnd(body: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    const prev = body[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    if (ch === ';' && depth === 0) return i
  }
  return body.length
}

function collectDartGoRouterPathObjects(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const classRoutes = new Map<string, { root: string; local: string }>()
  const classGetters = new Map<string, Map<string, { path: string; childClass?: string }>>()
  const staticGetters = new Map<string, { path: string; childClass?: string }>()

  const globalPathCtorRe = /\bclass\s+([A-Za-z_]\w*)[^{]*\{[\s\S]*?\b\1\s*\([^)]*\)\s*:\s*super\s*\(\s*(['"])([^'"]+)\2/g
  for (const match of source.matchAll(globalPathCtorRe)) {
    classRoutes.set(match[1], {
      root: normalizeReactRoutePath(match[3]),
      local: cleanGoRouterPathSegment(match[3]),
    })
  }
  const globalParamOnlyCtorRe = /\bclass\s+([A-Za-z_]\w*)[^{]*\{[\s\S]*?\b\1\s*\([^)]*\)\s*:\s*super\.only\s*\(\s*(['"])([^'"]+)\2/g
  for (const match of source.matchAll(globalParamOnlyCtorRe)) {
    classRoutes.set(match[1], {
      root: normalizeReactRoutePath(`:${match[3]}`),
      local: `:${match[3]}`,
    })
  }

  const classRe = /\bclass\s+([A-Za-z_]\w*)[^{]*\{([\s\S]*?)(?=\n\s*\})\n\s*\}/g
  for (const match of source.matchAll(classRe)) {
    const className = match[1]
    const body = match[2]
    const pathCtor = new RegExp(`\\b${className}\\s*\\([^)]*\\)\\s*:\\s*super\\s*\\(\\s*(['"])([^'"]+)\\1`).exec(body)
    const paramCtor = new RegExp(`\\b${className}\\s*\\([^)]*\\)\\s*:\\s*super\\.only\\s*\\(\\s*(['"])([^'"]+)\\1`).exec(body)
    if (pathCtor) {
      classRoutes.set(className, {
        root: normalizeReactRoutePath(pathCtor[2]),
        local: cleanGoRouterPathSegment(pathCtor[2]),
      })
    } else if (paramCtor) {
      classRoutes.set(className, {
        root: normalizeReactRoutePath(`:${paramCtor[2]}`),
        local: `:${paramCtor[2]}`,
      })
    }

    const getters = new Map<string, { path: string; childClass?: string }>()
    for (const getter of body.matchAll(/\b([A-Za-z_]\w*(?:<[^>]+>)?)\s+get\s+([A-Za-z_]\w*)\s*=>\s*([^;]+);/g)) {
      const childClass = /^([A-Za-z_]\w*)\s*\(/.exec(getter[3].trim())?.[1]
      const direct = resolveGoRouterPathObjectExpression(getter[3], false, classRoutes)
      if (direct) getters.set(getter[2], { path: direct, childClass })
    }
    if (getters.size > 0) classGetters.set(className, getters)
  }

  for (const staticGetter of source.matchAll(/\bstatic\s+[A-Za-z_]\w*(?:<[^>]+>)?\s+get\s+([A-Za-z_]\w*)\s*=>\s*([^;]+);/g)) {
    const before = source.slice(0, staticGetter.index)
    const className = [...before.matchAll(/\bclass\s+([A-Za-z_]\w*)\b/g)].at(-1)?.[1]
    if (!className) continue
    const childClass = /^([A-Za-z_]\w*)\s*\(/.exec(staticGetter[2].trim())?.[1]
    const path = resolveGoRouterPathObjectExpression(staticGetter[2], true, classRoutes)
    if (!path) continue
    staticGetters.set(`${className}.${staticGetter[1]}`, { path, childClass })
  }

  for (const [base, value] of staticGetters.entries()) {
    out.set(`${base}.goRoute`, value.path)
    expandGoRouterPathObjectChain(base, value.childClass, classGetters, out, 0)
  }

  return out
}

function expandGoRouterPathObjectChain(
  prefix: string,
  className: string | undefined,
  classGetters: Map<string, Map<string, { path: string; childClass?: string }>>,
  out: Map<string, string>,
  depth: number,
): void {
  if (!className || depth > 5) return
  const getters = classGetters.get(className)
  if (!getters) return
  for (const [getterName, value] of getters.entries()) {
    const nextPrefix = `${prefix}.${getterName}`
    out.set(`${nextPrefix}.goRoute`, value.path)
    expandGoRouterPathObjectChain(nextPrefix, value.childClass, classGetters, out, depth + 1)
  }
}

function resolveGoRouterPathObjectExpression(
  expression: string,
  root: boolean,
  classRoutes: Map<string, { root: string; local: string }>,
): string | null {
  const expr = expression.trim()
  const pathLiteral = /\bPath\s*\(\s*(['"])([^'"]+)\1/.exec(expr)?.[2]
  if (pathLiteral) return root ? normalizeReactRoutePath(pathLiteral) : cleanGoRouterPathSegment(pathLiteral)
  const paramLiteral = /\bParam\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3/.exec(expr)
  if (paramLiteral) {
    const path = `${cleanGoRouterPathSegment(paramLiteral[2])}/:${paramLiteral[4]}`
    return root ? normalizeReactRoutePath(path) : path
  }
  const className = /^([A-Za-z_]\w*)\s*\(/.exec(expr)?.[1]
  const classRoute = className ? classRoutes.get(className) : null
  return classRoute ? (root ? classRoute.root : classRoute.local) : null
}

function cleanGoRouterPathSegment(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '')
}

function extractFlutterDemoRouteValues(
  source: string,
  routeNameConstants: Map<string, string>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const routeRe = /\broute\s*:\s*(?:(['"])([^'"]+)\1|([A-Za-z_]\w*\.routeName))/g
  for (const match of source.matchAll(routeRe)) {
    const value = match[2] ?? routeNameConstants.get(match[3] ?? '')
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function extractDartNamedStringArg(
  body: string,
  argName: string,
  routeNameConstants: Map<string, string> = new Map(),
): string | null {
  const value = extractTopLevelDartNamedArg(body, argName)
  if (!value) return null
  return resolveDartRoutePathExpression(value, routeNameConstants)
}

function extractDartRouteComponent(body: string): string | null {
  for (const argName of ['builder', 'pageBuilder']) {
    const value = extractTopLevelDartNamedArg(body, argName)
    const component = value ? extractDartWidgetConstructorName(value) : null
    if (component) return component
  }
  return null
}

function extractDartWidgetConstructorName(expression: string): string | null {
  const childMatch = expression.match(/\b(?:child|page)\s*:\s*(?:const\s+)?([A-Z][A-Za-z0-9_]*)\s*\(/)
  if (childMatch) return childMatch[1]

  const match = expression.match(/(?:=>|return\s+)\s*(?:const\s+)?([A-Z][A-Za-z0-9_]*)\s*\(/)
    ?? expression.match(/^\s*(?:const\s+)?([A-Z][A-Za-z0-9_]*)\s*\(/)
  return match?.[1] ?? null
}

function resolveDartRoutePathExpression(
  expression: string,
  routeNameConstants: Map<string, string> = new Map(),
): string | null {
  const value = expression.trim()
  const literal = /^(['"])([^'"]+)\1/.exec(value)?.[2]
  if (literal) return literal
  const goRouteRef = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+\.goRoute)\b/.exec(value)?.[1]
  if (goRouteRef) return routeNameConstants.get(goRouteRef) ?? null
  const ref = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)/.exec(value)?.[1]
  if (ref) return routeNameConstants.get(ref) ?? null
  const ctorPathRef = /^const\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\.path\b/.exec(value)?.[1]
  if (ctorPathRef) return routeNameConstants.get(`${ctorPathRef}.path`) ?? null
  const bareRef = /^([A-Za-z_]\w*)\b/.exec(value)?.[1]
  return bareRef ? routeNameConstants.get(bareRef) ?? null : null
}

function extractTopLevelDartNamedArg(body: string, argName: string): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    const prev = body[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && body[i + 1] === '/') {
      i = body.indexOf('\n', i + 2)
      if (i < 0) break
      continue
    }
    if (ch === '/' && body[i + 1] === '*') {
      const commentEnd = body.indexOf('*/', i + 2)
      if (commentEnd < 0) break
      i = commentEnd + 1
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    if (depth !== 0) continue
    if (!body.startsWith(argName, i)) continue
    const before = body[i - 1]
    let colon = i + argName.length
    while (/\s/.test(body[colon] ?? '')) colon += 1
    if ((before && /[\w$]/.test(before)) || body[colon] !== ':') continue
    let start = colon + 1
    while (/\s/.test(body[start] ?? '')) start += 1
    let end = start
    let valueDepth = 0
    let valueQuote: string | null = null
    for (; end < body.length; end += 1) {
      const valueCh = body[end]
      const valuePrev = body[end - 1]
      if (valueQuote) {
        if (valueCh === valueQuote && valuePrev !== '\\') valueQuote = null
        continue
      }
      if (valueCh === '"' || valueCh === "'" || valueCh === '`') {
        valueQuote = valueCh
        continue
      }
      if (valueCh === '(' || valueCh === '[' || valueCh === '{') valueDepth += 1
      if (valueCh === ')' || valueCh === ']' || valueCh === '}') valueDepth -= 1
      if (valueCh === ',' && valueDepth === 0) break
    }
    return body.slice(start, end).trim()
  }
  return null
}

function findMatchingParen(source: string, openParen: number): number {
  if (openParen < 0) return -1
  let depth = 0
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function buildFlutterNavigatorFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const navigatorActive = input.stackInfo.framework === 'flutter'
    || input.detections.some((d) => d.framework === 'flutter_navigator' && d.active)
  if (!navigatorActive) return []

  const dartFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && node.filePath.endsWith('.dart'),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  const routeNameConstants = collectDartRouteNameConstants(input.repoPath, dartFiles)

  for (const fileNode of dartFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    if (
      !source.includes('MaterialApp') &&
      !source.includes('CupertinoApp') &&
      !source.includes('onGenerateRoute') &&
      !hasFlutterNavigatorAssignedRoutesMap(source)
    ) continue

    const routeEntries = [
      ...extractFlutterNavigatorRoutesMapEntries(source, routeNameConstants),
      ...extractFlutterNavigatorAssignedRoutesMapEntries(source, routeNameConstants),
      ...extractFlutterNavigatorOnGenerateRouteEntries(source, routeNameConstants),
    ]

    for (const entry of routeEntries) {
      const path = normalizeReactRoutePath(entry.path)
      if (seen.has(path)) continue
      seen.add(path)

      const className = entry.handlerClass
      const handlerNode = input.graphNodes.find(
        (node) =>
          node.type === 'class' &&
          node.name === className,
      )
      const handlerNodeId = handlerNode?.id ?? fileNode.id
      out.push({
        framework: 'flutter_navigator',
        kind: 'page',
        path,
        fullPath: path,
        handlerNodeId,
        metadata: {
          sourceFallback: 'flutter_navigator_routes_map',
          routeResolution: 'table_resolved',
        },
        detectionSource: 'source:flutter_navigator',
        confidence: handlerNode ? 'high' : 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_flutter_navigator_routes_map',
          matchedNodeIds: [handlerNodeId],
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function hasFlutterNavigatorAssignedRoutesMap(source: string): boolean {
  return /\bWidgetBuilder\b/.test(source) &&
    /\b(?:static\s+)?(?:final|const|var)\s+\w+\s*=\s*(?:<\s*String\s*,\s*WidgetBuilder\s*>)?\s*\{/.test(source)
}

function extractFlutterNavigatorRoutesMapEntries(
  source: string,
  routeNameConstants: Map<string, string> = new Map(),
): Array<{ path: string; handlerClass: string }> {
  // routes: { ... } 블록의 시작 위치 찾기 (trailing comma 유무 무관).
  // findMatchingBrace로 정확한 닫는 } 찾기 → 중첩 객체/문자열 안전.
  const headerRe = /\broutes\s*:\s*\{/g
  const headerMatch = headerRe.exec(source)
  if (!headerMatch) return []
  const openBrace = headerMatch.index + headerMatch[0].length - 1  // '{' 위치
  const closeBrace = findMatchingBrace(source, openBrace)
  if (closeBrace < 0) return []
  return extractFlutterNavigatorRoutesMapBodyEntries(
    source.slice(openBrace + 1, closeBrace),
    routeNameConstants,
  )
}

function extractFlutterNavigatorRoutesMapBodyEntries(
  body: string,
  routeNameConstants: Map<string, string> = new Map(),
): Array<{ path: string; handlerClass: string }> {
  const out: Array<{ path: string; handlerClass: string }> = []
  // arrow body: '/x': (c) => Widget()
  const routeKey = String.raw`(?:['"][^'"]+['"]|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)`
  const arrowRe = new RegExp(String.raw`(${routeKey})\s*:\s*\([^)]*\)\s*=>\s*(?:const\s+)?([A-Za-z_]\w*)\s*\(`, 'g')
  for (const match of body.matchAll(arrowRe)) {
    const path = resolveDartRoutePathExpression(match[1], routeNameConstants)
    if (path) out.push({ path, handlerClass: match[2] })
  }
  // block body: '/x': (c) { ... return Widget(...); }
  // path만 추출 (handler class는 return 문에서 첫 번째 widget constructor)
  const blockRe = new RegExp(String.raw`(${routeKey})\s*:\s*\([^)]*\)\s*\{`, 'g')
  for (const match of body.matchAll(blockRe)) {
    const path = resolveDartRoutePathExpression(match[1], routeNameConstants)
    if (!path) continue
    if (out.some((entry) => entry.path === path)) continue
    // 블록 body에서 return의 첫 widget constructor 추출
    const blockOpen = match.index + match[0].length - 1
    const blockClose = findMatchingBrace(body, blockOpen)
    if (blockClose < 0) continue
    const blockBody = body.slice(blockOpen + 1, blockClose)
    const returnMatch = /return\s+(?:const\s+)?([A-Za-z_]\w*)\s*\(/.exec(blockBody)
    out.push({ path, handlerClass: returnMatch?.[1] ?? '' })
  }
  return out
}

function extractFlutterNavigatorAssignedRoutesMapEntries(
  source: string,
  routeNameConstants: Map<string, string> = new Map(),
): Array<{ path: string; handlerClass: string }> {
  const headerRe = /\b(?:static\s+)?(?:final|const|var)\s+\w+\s*=\s*(?:<\s*String\s*,\s*WidgetBuilder\s*>)?\s*\{/g
  const out: Array<{ path: string; handlerClass: string }> = []
  for (const headerMatch of source.matchAll(headerRe)) {
    const openBrace = headerMatch.index + headerMatch[0].length - 1
    const closeBrace = findMatchingBrace(source, openBrace)
    if (closeBrace < 0) continue
    out.push(...extractFlutterNavigatorRoutesMapBodyEntries(
      source.slice(openBrace + 1, closeBrace),
      routeNameConstants,
    ))
  }
  return out
}

function extractFlutterNavigatorOnGenerateRouteEntries(
  source: string,
  routeNameConstants: Map<string, string> = new Map(),
): Array<{ path: string; handlerClass: string }> {
  source = stripJsLikeComments(source) // drop commented-out `// case AppRoutes.x:` so they aren't read as live routes
  const out: Array<{ path: string; handlerClass: string }> = []
  const pageRouteCtor = String.raw`(?:CupertinoPageRoute|MaterialPageRoute|PageRouteBuilder)(?:<[^>]+>)?`
  // builder cap is generous (a real onGenerateRoute builder block can have many arg-parsing statements before the
  // `return SomePage(...)`, e.g. heroines' webview case) — the body is already bounded to one case block, so a
  // large cap can't bleed across cases.
  const widgetFactory = String.raw`(?:builder|pageBuilder)\s*:\s*(?:\([^)]*\)|[A-Za-z_]\w*)\s*(?:=>\s*|\{[\s\S]{0,1500}?return\s+)(?:const\s+)?([A-Za-z_]\w*)\s*\(`
  const builderRe = new RegExp(String.raw`${pageRouteCtor}\s*\([\s\S]*?${widgetFactory}`)

  // Block-parse the switch: every `case <label>:` / `default:` opens a block that runs to the NEXT boundary.
  // Within a case block, find the first page-route builder ANYWHERE — so intermediate statements (local vars,
  // argument casts) between `case ...:` and `return MaterialPageRoute(...)` don't drop the screen. (The old
  // regex required `case X: return PageRoute(...)` adjacency and dropped any case with a middle line.) A quoted
  // label is the literal path (a `:id` route param inside the quotes is preserved); an identifier/dotted label
  // resolves via routeNameConstants; numeric/unknown labels still bound the block but emit nothing.
  const caseBoundaryRe = /(?:case\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|default)\s*:/g
  const boundaries = [...source.matchAll(caseBoundaryRe)]
  for (let i = 0; i < boundaries.length; i++) {
    const label = boundaries[i]![1]
    if (!label) continue // `default:` — bounds the previous block but is not a labeled route
    const path = label[0] === "'" || label[0] === '"' ? label.slice(1, -1) : routeNameConstants.get(label)
    if (!path) continue
    const blockStart = boundaries[i]!.index! + boundaries[i]![0].length
    const blockEnd = i + 1 < boundaries.length ? boundaries[i + 1]!.index! : source.length
    const builder = builderRe.exec(source.slice(blockStart, blockEnd))
    if (builder) out.push({ path, handlerClass: builder[1]! })
  }

  const ifRouteRe = new RegExp(String.raw`settings\.name\s*==\s*(['"])([^'"]+)\1[\s\S]{0,400}?return\s+${pageRouteCtor}\s*\([\s\S]*?${widgetFactory}`, 'g')
  for (const match of source.matchAll(ifRouteRe)) {
    out.push({ path: match[2], handlerClass: match[3] })
  }

  const ifRefRouteRe = new RegExp(String.raw`settings\.name\s*==\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)[\s\S]{0,400}?return\s+${pageRouteCtor}\s*\([\s\S]*?${widgetFactory}`, 'g')
  for (const match of source.matchAll(ifRefRouteRe)) {
    const path = routeNameConstants.get(match[1])
    if (path) out.push({ path, handlerClass: match[2] })
  }

  return out
}

function buildFlutterGetxFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const getxActive = input.detections.some((d) => d.framework === 'flutter_getx' && d.active)
  if (!getxActive) return []

  const dartFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && node.filePath.endsWith('.dart') && !node.filePath.startsWith('test/'),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  const routeNameConstants = collectDartRouteNameConstants(input.repoPath, dartFiles)

  for (const fileNode of dartFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    if (!source.includes('GetPage')) continue

    for (const route of extractFlutterNamedCtorRoutes(source, 'GetPage', 'name', routeNameConstants)) {
      if (seen.has(route.fullPath)) continue
      seen.add(route.fullPath)
      const handlerNodeId = resolveFlutterRouteHandlerNodeId(
        route.handlerClass,
        fileNode,
        input.graphNodes,
      )
      out.push({
        framework: 'flutter_getx',
        kind: 'page',
        path: route.fullPath,
        fullPath: route.fullPath,
        handlerNodeId,
        metadata: {
          sourceFallback: 'flutter_getx_get_pages',
          routeResolution: 'table_resolved',
        },
        detectionSource: 'source:flutter_getx',
        confidence: route.handlerClass ? 'high' : 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_flutter_getx_get_pages',
          matchedNodeIds: [handlerNodeId],
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function buildFlutterAutoRouteFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const autoRouteActive = input.detections.some((d) => d.framework === 'flutter_auto_route' && d.active)
  if (!autoRouteActive) return []

  const dartFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && node.filePath.endsWith('.dart') && !node.filePath.startsWith('test/'),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()
  const routeNameConstants = collectDartRouteNameConstants(input.repoPath, dartFiles)

  for (const fileNode of dartFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    if (!source.includes('AutoRoute')) continue

    for (const route of extractFlutterNamedCtorRoutes(source, 'AutoRoute', 'path', routeNameConstants)) {
      if (seen.has(route.fullPath)) continue
      seen.add(route.fullPath)
      const handlerNodeId = resolveFlutterRouteHandlerNodeId(
        route.handlerClass,
        fileNode,
        input.graphNodes,
      )
      out.push({
        framework: 'flutter_auto_route',
        kind: 'page',
        path: route.fullPath,
        fullPath: route.fullPath,
        handlerNodeId,
        metadata: {
          sourceFallback: 'flutter_auto_route_routes',
          routeResolution: 'table_resolved',
        },
        detectionSource: 'source:flutter_auto_route',
        confidence: route.handlerClass ? 'high' : 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_flutter_auto_route_routes',
          matchedNodeIds: [handlerNodeId],
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function buildFlutterBeamerFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const beamerActive = input.detections.some((d) => d.framework === 'flutter_beamer' && d.active)
  if (!beamerActive) return []

  const dartFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && node.filePath.endsWith('.dart') && !node.filePath.startsWith('test/'),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const fileNode of dartFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = readFileSync(abs, 'utf-8')
    if (!source.includes('pathPatterns') && !source.includes('pathBlueprints') && !source.includes('BeamPage')) continue
    const locations = extractBeamerLocations(source)
    const routeSources = locations.length > 0
      ? locations
      : [{
          className: null,
          pageClasses: extractBeamerPageClasses(source),
          paths: [
            ...extractFlutterStringListValues(source, 'pathPatterns'),
            ...extractFlutterStringListValues(source, 'pathBlueprints'),
          ],
        }]

    for (const location of routeSources) {
      const routeOwnerNodeId = resolveDartClassNodeId(location.className, fileNode, input.graphNodes)
      for (const path of location.paths) {
        const fullPath = normalizeReactRoutePath(path)
        if (seen.has(fullPath)) continue
        seen.add(fullPath)
        const handlerClass = inferBeamerHandlerClass(fullPath, location.pageClasses)
        const handlerNodeId = resolveFlutterRouteHandlerNodeId(handlerClass, fileNode, input.graphNodes)
        out.push({
          framework: 'flutter_beamer',
          kind: 'page',
          path: fullPath,
          fullPath,
          handlerNodeId,
          metadata: {
            sourceFallback: 'flutter_beamer_path_patterns',
            routeResolution: 'table_resolved',
            handlerClass,
            routeOwnerClass: location.className,
          },
          detectionSource: 'source:flutter_beamer',
          confidence: handlerClass ? 'high' : 'medium',
          detectionEvidence: {
            matchedRuleId: 'source_flutter_beamer_path_patterns',
            matchedNodeIds: [...new Set([handlerNodeId, routeOwnerNodeId])],
            matchedEdgeIds: [],
          },
        })
      }
    }
  }

  return out
}

interface BeamerLocationInfo {
  className: string | null
  pageClasses: string[]
  paths: string[]
}

function extractBeamerLocations(source: string): BeamerLocationInfo[] {
  const locations: BeamerLocationInfo[] = []
  for (const match of source.matchAll(/\bclass\s+([A-Za-z_]\w*)\s+extends\s+BeamLocation\b[^{]*\{/g)) {
    const openBrace = source.indexOf('{', match.index)
    const closeBrace = findMatchingBrace(source, openBrace)
    if (closeBrace < 0) continue
    const body = source.slice(openBrace + 1, closeBrace)
    const paths = [
      ...extractFlutterStringListValues(body, 'pathPatterns'),
      ...extractFlutterStringListValues(body, 'pathBlueprints'),
    ]
    if (paths.length === 0) continue
    locations.push({
      className: match[1],
      pageClasses: extractBeamerPageClasses(body),
      paths,
    })
  }
  return locations
}

function extractBeamerPageClasses(source: string): string[] {
  const classes: string[] = []
  for (const match of source.matchAll(/\bBeamPage\s*\([\s\S]*?\bchild\s*:\s*(?:const\s+)?([A-Za-z_]\w*)\s*\(/g)) {
    if (!classes.includes(match[1])) classes.push(match[1])
  }
  return classes
}

function inferBeamerHandlerClass(path: string, pageClasses: string[]): string | null {
  if (pageClasses.length === 0) return null
  const segments = path.split('/').filter(Boolean).filter((segment) => !segment.startsWith(':'))
  const candidates = segments.length > 0 ? [...segments].reverse() : ['home', 'index']
  for (const segment of candidates) {
    const normalizedSegment = normalizeNameForMatch(segment)
    const match = pageClasses.find((className) => normalizeNameForMatch(className.replace(/Page$/, '')) === normalizedSegment)
    if (match) return match
  }
  return pageClasses.length === 1 ? pageClasses[0] : null
}

function normalizeNameForMatch(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

interface FlutterNamedCtorRoute {
  start: number
  end: number
  path: string
  fullPath: string
  handlerClass: string | null
}

function extractFlutterNamedCtorRoutes(
  source: string,
  ctorName: string,
  pathArgName: string,
  routeNameConstants: Map<string, string> = new Map(),
): FlutterNamedCtorRoute[] {
  const routes: FlutterNamedCtorRoute[] = []
  const ctorRe = new RegExp(`\\b${ctorName}\\s*\\(`, 'g')
  let match: RegExpExecArray | null
  while ((match = ctorRe.exec(source)) !== null) {
    const openParen = source.indexOf('(', match.index)
    const end = findMatchingParen(source, openParen)
    if (end < 0) continue
    const body = source.slice(openParen + 1, end)
    const path = extractDartNamedStringArg(body, pathArgName, routeNameConstants)
    if (!path) continue
    routes.push({
      start: match.index,
      end,
      path,
      fullPath: normalizeReactRoutePath(path),
      handlerClass: extractFlutterPageHandlerClass(body),
    })
  }

  routes.sort((a, b) => a.start - b.start)
  for (const route of routes) {
    const parent = [...routes]
      .reverse()
      .find((candidate) => candidate.start < route.start && candidate.end > route.end)
    if (!parent) continue
    route.fullPath = route.path.startsWith('/')
      ? normalizeReactRoutePath(route.path)
      : normalizeReactRoutePath(`${parent.fullPath}/${route.path}`)
  }

  return routes
}

function extractFlutterPageHandlerClass(body: string): string | null {
  const pageExpr = extractTopLevelDartNamedArg(body, 'page')
  if (!pageExpr) return null
  const arrowCtor = /=>\s*(?:const\s+)?([A-Za-z_]\w*)\s*\(/.exec(pageExpr)?.[1]
  if (arrowCtor) return arrowCtor
  const directCtor = /(?:const\s+)?([A-Za-z_]\w*)\s*\(/.exec(pageExpr)?.[1]
  if (directCtor && directCtor !== 'EmptyRouterPage') return directCtor
  const routePage = /^([A-Za-z_]\w+)(?:Route)?\.page\b/.exec(pageExpr)?.[1]
  if (!routePage) return null
  const baseName = routePage.endsWith('Route') ? routePage.slice(0, -'Route'.length) : routePage
  return `${baseName}Page`
}

function resolveFlutterRouteHandlerNodeId(
  handlerClass: string | null,
  fileNode: typeof codeNodes.$inferSelect,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): string {
  return resolveDartClassNodeId(handlerClass, fileNode, graphNodes)
}

function resolveDartClassNodeId(
  className: string | null,
  fileNode: typeof codeNodes.$inferSelect,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): string {
  if (!className) return fileNode.id
  const classNode = graphNodes.find(
    (node) => node.type === 'class' && node.name === className,
  )
  return classNode?.id ?? fileNode.id
}

function extractFlutterStringListValues(source: string, argName: string): string[] {
  const out: string[] = []
  const arg = new RegExp(`\\b${argName}\\s*(?::|=>)\\s*\\[`, 'g')
  let match: RegExpExecArray | null
  while ((match = arg.exec(source)) !== null) {
    const open = source.indexOf('[', match.index)
    const close = findMatchingBracket(source, open)
    if (close < 0) continue
    const body = source.slice(open + 1, close)
    for (const item of body.matchAll(/(['"])([^'"]+)\1/g)) {
      out.push(item[2])
    }
  }
  return [...new Set(out)]
}


export {
  buildFlutterAutoRouteFallbackEntries,
  buildFlutterBeamerFallbackEntries,
  buildFlutterGetxFallbackEntries,
  buildFlutterGoRouterFallbackEntries,
  buildFlutterNavigatorFallbackEntries,
}
