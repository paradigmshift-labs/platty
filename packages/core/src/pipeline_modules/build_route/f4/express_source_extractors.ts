import { existsSync, readFileSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { codeNodes } from '@/db/schema/code_graph.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from '../types.js'
import { joinUrlPath } from './source_fallback_shared.js'
import type { LegacyFallbackInput } from './source_fallback_types.js'

function buildExpressFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  const expressActive = input.detections.some((d) => d.framework === 'express' && d.active)
  if (!expressActive) return []

  const jsFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && /\.(js|cjs|mjs|ts)$/.test(node.filePath),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const fileNode of jsFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = stripJsLikeComments(readFileSync(abs, 'utf-8'))
    // entry gate — Express direct route 호출 패턴이 source에 있으면 실행.
    // 변수명은 'app'에 고정되지 않음 — `const server = express()`, `let api = express()` 등도 인식.
    const hasDirectExpressRoute = detectExpressAppVarNames(source).some((v) => {
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`\\b${escaped}\\.(?:get|post|put|patch|delete|all|head|options)\\s*\\(`).test(source)
    })
    const hasTemplateRoute = detectExpressAppVarNames(source).some((v) => {
      const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`\\b${escaped}\\.(?:get|post|put|patch|delete|all|head|options)\\s*\\(\\s*\``).test(source)
    })
    for (const route of [
      ...(hasDirectExpressRoute
        ? extractExpressDirectAppRoutes(source, fileNode.id)
        : []),
      ...extractExpressSwaggerMiddlewareRoutes(source, fileNode.id),
      ...(hasExpressDirectAppConstantPath(source)
        ? extractExpressDirectAppRoutes(source, fileNode.id)
        : []),
      ...(hasTemplateRoute
        ? extractExpressDirectAppRoutes(source, fileNode.id, { templateOnly: true })
        : []),
      ...extractExpressAppMapRoutes(source),
      ...extractExpressApolloGraphqlRoutes(source, fileNode.id),
      ...extractExpressResourceRoutes(source),
      ...extractExpressRequireMountRoutes(source, fileNode.filePath, input),
      ...(hasExpressAppVariableMount(source)
        ? extractExpressVariableMountRoutes(source, fileNode.filePath, input)
        : []),
      ...extractExpressClassInstanceRoutes(source, fileNode.filePath, input),
      ...extractExpressMvcBootRoutes(source, fileNode.filePath, input),
      ...extractExpressRouteTableRoutes(source, input),
      ...extractExpressRestControllerMapRoutes(source),
    ]) {
      const key = `${route.sourceFallback}:${route.method}:${route.path}`
      if (seen.has(key)) continue
      seen.add(key)
      const handlerNodeId = route.handlerNodeId ?? fileNode.id
      const matchedNodeIds = route.matchedNodeIds ?? [handlerNodeId]
      out.push({
        framework: 'express',
        kind: 'api',
        httpMethod: route.method.toUpperCase(),
        path: route.path,
        fullPath: route.path,
        handlerNodeId,
        metadata: { sourceFallback: route.sourceFallback },
        detectionSource: 'source:express',
        confidence: 'medium',
        detectionEvidence: {
          matchedRuleId: `source_${route.sourceFallback}`,
          matchedNodeIds,
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

type ExpressSourceRoute = {
  method: string
  path: string
  sourceFallback:
    | 'express_app_map'
    | 'express_resource'
    | 'express_require_mount'
    | 'express_variable_mount'
    | 'express_class_instance'
    | 'express_mvc_boot'
    | 'express_route_table'
    | 'express_rest_controller_map'
    | 'express_direct_app'
    | 'express_apollo_graphql'
    | 'express_swagger_middleware'
  handlerNodeId?: string
  matchedNodeIds?: string[]
}

function hasExpressDirectAppConstantPath(source: string): boolean {
  // 'app' 외의 변수명도 인정 (server, api 등). use() 호출 + 상수 path + METHOD(IDENT, ...) 패턴.
  const appVars = detectExpressAppVarNames(source)
  const alt = appVars.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const useRe = new RegExp(`\\b(?:${alt})\\.use\\s*\\(`)
  const constRe = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(['"`])[^'"`$]*?\1/
  const methodIdentRe = new RegExp(`\\b(?:${alt})\\.(?:get|post|put|patch|delete|all|head|options)\\s*\\(\\s*[A-Za-z_$][\\w$]*\\s*,`)
  return useRe.test(source) && constRe.test(source) && methodIdentRe.test(source)
}

function hasExpressAppVariableMount(source: string): boolean {
  if (/\bapp\.use\s*\(|\bthis\.express\.use\s*\(/.test(source)) return true
  for (const match of source.matchAll(/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(/g)) {
    const appVar = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${appVar}\\.use\\s*\\(`).test(source)) return true
  }
  return false
}

function extractExpressDirectAppRoutes(
  source: string,
  handlerNodeId?: string,
  options: { templateOnly?: boolean } = {},
): ExpressSourceRoute[] {
  const out: ExpressSourceRoute[] = []
  const constants = collectExpressStringConstants(source)
  // 변수명 동적 감지 — 'app' 외에 const server = express() 같은 패턴도 포함.
  const appVars = detectExpressAppVarNames(source)
  const appVarsAlt = appVars.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const methodsAlt = 'get|post|put|patch|delete|all|head|options'
  const routeRe = options.templateOnly
    ? new RegExp(`\\b(?:${appVarsAlt})\\.(${methodsAlt})\\s*\\(\\s*(\`)([^\`$]*?)\\2\\s*,`, 'g')
    : new RegExp(`\\b(?:${appVarsAlt})\\.(${methodsAlt})\\s*\\(\\s*(['"\`])([^'"\`$]*?)\\2\\s*,`, 'g')
  for (const match of source.matchAll(routeRe)) {
    out.push({
      method: match[1],
      path: joinUrlPath('/', match[3]),
      sourceFallback: 'express_direct_app',
      handlerNodeId,
    })
  }
  if (!options.templateOnly) {
    const constRouteRe = new RegExp(`\\b(?:${appVarsAlt})\\.(${methodsAlt})\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*,`, 'g')
    for (const match of source.matchAll(constRouteRe)) {
      const path = constants.get(match[2])
      if (!path) continue
      out.push({
        method: match[1],
        path: joinUrlPath('/', path),
        sourceFallback: 'express_direct_app',
        handlerNodeId,
      })
    }
  }
  return out
}

function stripJsLikeComments(source: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    const prev = source[i - 1]

    if (quote) {
      out += ch
      if (ch === quote && prev !== '\\') quote = null
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      out += '\n'
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n'
        i += 1
      }
      i += 1
      continue
    }

    out += ch
  }
  return out
}

function extractExpressApolloGraphqlRoutes(source: string, handlerNodeId?: string): ExpressSourceRoute[] {
  if (!source.includes('expressMiddleware')) return []

  const constants = collectExpressStringConstants(source)
  const out: ExpressSourceRoute[] = []
  const appUseRe = /\bapp\.use\s*\(\s*([^,\n]+)\s*,\s*expressMiddleware\s*\(/g
  for (const match of source.matchAll(appUseRe)) {
    const path = resolveExpressStringExpression(match[1], constants)
    if (!path) continue
    out.push({
      method: 'all',
      path: joinUrlPath('/', path),
      sourceFallback: 'express_apollo_graphql',
      handlerNodeId,
    })
  }
  return out
}

function extractExpressSwaggerMiddlewareRoutes(source: string, handlerNodeId?: string): ExpressSourceRoute[] {
  if (!source.includes('swaggerUi')) return []
  const out: ExpressSourceRoute[] = []
  const appUseRe = /\bapp\.use\s*\(\s*(['"`])([^'"`$]*?)\1\s*,\s*swaggerUi\.(?:serve|setup)\b/g
  for (const match of source.matchAll(appUseRe)) {
    if (hasExplicitExpressAppRouteForPath(source, match[2])) continue
    out.push({
      method: 'all',
      path: joinUrlPath('/', match[2]),
      sourceFallback: 'express_swagger_middleware',
      handlerNodeId,
    })
  }
  return out
}

function hasExplicitExpressAppRouteForPath(source: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\bapp\\.(?:get|post|put|patch|delete|all|head|options)\\s*\\(\\s*(['"\`])${escaped}\\1`).test(source)
}

function collectExpressStringConstants(source: string): Map<string, string> {
  const out = new Map<string, string>()
  // const / let / var 모두 인식 (실코드의 다양성 — JS 구버전 var, 재할당 가능한 let 등).
  const constRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`$]*?)\2/g
  for (const match of source.matchAll(constRe)) {
    out.set(match[1], match[3])
  }
  return out
}

/**
 * Express app 변수명 후보 수집 — 'app' 기본 + `const/let/var X = express()` 패턴에서 추출.
 * 실사례: const server = express(), let api = express(), var instance = express()
 */
function detectExpressAppVarNames(source: string): string[] {
  const names = new Set<string>(['app'])
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(/g
  for (const match of source.matchAll(re)) {
    names.add(match[1])
  }
  return Array.from(names)
}

function resolveExpressStringExpression(expression: string, constants: Map<string, string>): string | null {
  const expr = expression.trim()
  const literal = /^(['"`])([^'"`$]*?)\1$/.exec(expr)?.[2]
  if (literal !== undefined) return literal
  return constants.get(expr) ?? null
}

function extractExpressRestControllerMapRoutes(source: string): ExpressSourceRoute[] {
  if (!source.includes('Object.entries(routes)') || !source.includes('routeController')) return []

  const routesBlock = /\bconst\s+routes\s*=\s*\{([\s\S]*?)\}\s*;?/.exec(source)?.[1]
  if (!routesBlock) return []

  const routeNames: string[] = []
  const seenNames = new Set<string>()
  const uncommentedRoutesBlock = routesBlock.replace(/\/\/.*$/gm, '')
  for (const match of uncommentedRoutesBlock.matchAll(/(?:^|[,\s])([A-Za-z_$][\w$]*)\s*:\s*require\s*\(/g)) {
    const name = match[1]
    if (seenNames.has(name)) continue
    seenNames.add(name)
    routeNames.push(name)
  }
  if (routeNames.length === 0) return []

  const templates: Array<{ guard: string; method: string; suffix: string }> = [
    { guard: 'getAll', method: 'get', suffix: '' },
    { guard: 'getById', method: 'get', suffix: '/:id' },
    { guard: 'create', method: 'post', suffix: '' },
    { guard: 'update', method: 'put', suffix: '/:id' },
    { guard: 'remove', method: 'delete', suffix: '/:id' },
  ]

  const out: ExpressSourceRoute[] = []
  for (const routeName of routeNames) {
    for (const template of templates) {
      if (!new RegExp(`\\brouteController\\.${template.guard}\\b`).test(source)) continue
      out.push({
        method: template.method,
        path: joinUrlPath(`/api/${routeName}`, template.suffix),
        sourceFallback: 'express_rest_controller_map',
      })
    }
  }
  return out
}

function extractExpressVariableMountRoutes(
  source: string,
  currentFilePath: string,
  input: {
    repoPath: string
    graphNodes: Array<typeof codeNodes.$inferSelect>
  },
  basePrefix = '',
  visited = new Set<string>(),
  includeLocalRoutes = false,
  evidenceNodeIds: string[] = [],
): ExpressSourceRoute[] {
  const visitKey = `${currentFilePath}|${basePrefix}`
  if (visited.has(visitKey)) return []
  visited.add(visitKey)

  const requiredVars = new Map<string, string>()
  const requireVarRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])(.*?)\2\s*\)/g
  for (const match of source.matchAll(requireVarRe)) {
    requiredVars.set(match[1], match[3])
  }
  const importNamedRe = /\bimport\s+\{([^}]+)\}\s+from\s+(['"])(.*?)\2/g
  for (const match of source.matchAll(importNamedRe)) {
    for (const specifier of match[1].split(',')) {
      const localName = specifier.trim().split(/\s+as\s+/).pop()?.trim()
      if (localName) requiredVars.set(localName, match[3])
    }
  }
  const importDefaultRe = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])(.*?)\2/g
  for (const match of source.matchAll(importDefaultRe)) {
    requiredVars.set(match[1], match[3])
  }

  const out: ExpressSourceRoute[] = []
  const currentFileNode = input.graphNodes.find((node) => node.type === 'file' && node.filePath === currentFilePath)
  if (includeLocalRoutes) {
    for (const route of extractExpressRouterLocalRoutes(source)) {
      out.push({
        method: route.method,
        path: joinUrlPath(basePrefix || '/', route.path),
        sourceFallback: 'express_variable_mount',
        handlerNodeId: findExpressHandlerNodeId(input.graphNodes, currentFilePath, route.handlerName) ?? currentFileNode?.id,
        matchedNodeIds: [
          ...evidenceNodeIds,
          currentFileNode?.id,
          findExpressHandlerNodeId(input.graphNodes, currentFilePath, route.handlerName),
        ].filter((id): id is string => Boolean(id)),
      })
    }
  }

  const mountVarRe = /\b(?:this\.)?[A-Za-z_$][\w$]*\.use\s*\(\s*(?:(?:(['"])([^'"$]*?)\1|`([^`]*?)`)\s*,\s*)?([A-Za-z_$][\w$]*)\s*\)/g
  for (const mount of source.matchAll(mountVarRe)) {
    const mountPrefix = normalizeExpressTemplatePath(mount[2] ?? mount[3] ?? '')
    const mountedVar = mount[4]
    const requiredPath = requiredVars.get(mountedVar)
    if (!requiredPath) continue
    const mountedFile = resolveRelativeSourceFile(currentFilePath, requiredPath, input.repoPath, input.graphNodes)
    if (!mountedFile) continue
    for (const targetFile of resolveExpressMountedVariableTargetFiles(mountedFile.filePath, mountedVar, input)) {
      const mountedSource = readFileSync(joinPath(input.repoPath, targetFile), 'utf-8')
      out.push(...extractExpressVariableMountRoutes(
        mountedSource,
        targetFile,
        input,
        joinUrlPath(basePrefix || '/', mountPrefix),
        visited,
        true,
        [...evidenceNodeIds, currentFileNode?.id, mountedFile.id].filter((id): id is string => Boolean(id)),
      ))
    }
  }

  const mountFactoryRe = /\b(?:this\.)?[A-Za-z_$][\w$]*\.use\s*\(\s*(?:(?:(['"])([^'"$]*?)\1|`([^`]*?)`)\s*,\s*)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\)/g
  for (const mount of source.matchAll(mountFactoryRe)) {
    const mountPrefix = normalizeExpressTemplatePath(mount[2] ?? mount[3] ?? '')
    const factoryName = mount[4]
    const requiredPath = requiredVars.get(factoryName)
    if (!requiredPath) continue
    const mountedFile = resolveRelativeSourceFile(currentFilePath, requiredPath, input.repoPath, input.graphNodes)
    if (!mountedFile) continue
    const mountedSource = readFileSync(joinPath(input.repoPath, mountedFile.filePath), 'utf-8')
    out.push(...extractExpressVariableMountRoutes(
      mountedSource,
      mountedFile.filePath,
      input,
      joinUrlPath(basePrefix || '/', mountPrefix),
      visited,
      true,
      [...evidenceNodeIds, currentFileNode?.id, mountedFile.id].filter((id): id is string => Boolean(id)),
    ))
  }

  for (const routeMount of extractExpressRouteArrayMounts(source)) {
    const requiredPath = requiredVars.get(routeMount.routeVar)
    if (!requiredPath) continue
    const mountedFile = resolveRelativeSourceFile(currentFilePath, requiredPath, input.repoPath, input.graphNodes)
    if (!mountedFile) continue
    for (const targetFile of resolveExpressMountedVariableTargetFiles(mountedFile.filePath, routeMount.routeVar, input)) {
      const mountedSource = readFileSync(joinPath(input.repoPath, targetFile), 'utf-8')
      out.push(...extractExpressVariableMountRoutes(
        mountedSource,
        targetFile,
        input,
        joinUrlPath(basePrefix || '/', routeMount.prefix),
        visited,
        true,
      ))
    }
  }

  for (const arrayMount of extractExpressRouterArrayVariableMounts(source)) {
    const requiredPath = requiredVars.get(arrayMount.routeVar)
    if (!requiredPath) continue
    const mountedFile = resolveRelativeSourceFile(currentFilePath, requiredPath, input.repoPath, input.graphNodes)
    if (!mountedFile) continue
    for (const targetFile of resolveExpressMountedVariableTargetFiles(mountedFile.filePath, arrayMount.routeVar, input)) {
      const mountedSource = readFileSync(joinPath(input.repoPath, targetFile), 'utf-8')
      out.push(...extractExpressVariableMountRoutes(
        mountedSource,
        targetFile,
        input,
        basePrefix,
        visited,
        true,
      ))
    }
  }

  return out
}

function normalizeExpressTemplatePath(path: string): string {
  return path.replace(/\$\{\s*version\s*\}/g, 'v1').replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, ':$1')
}

function extractExpressRouteArrayMounts(source: string): Array<{ prefix: string; routeVar: string }> {
  const out: Array<{ prefix: string; routeVar: string }> = []
  const arrayRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*\[([\s\S]*?)\]\s*;?/g

  for (const arrayMatch of source.matchAll(arrayRe)) {
    const arrayName = arrayMatch[1]
    const memberForEachRe = new RegExp(
      `\\b${arrayName}\\.forEach\\s*\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>\\s*\\{?[\\s\\S]*?\\.use\\s*\\(\\s*\\1\\.path\\s*,\\s*\\1\\.route\\s*\\)`,
    )
    const destructuredForEachRe = new RegExp(
      `\\b${arrayName}\\.forEach\\s*\\(\\s*\\(?\\s*\\{[^}]*\\bpath\\b[^}]*\\broute\\b[^}]*\\}\\s*\\)?\\s*=>\\s*\\{?[\\s\\S]*?\\.use\\s*\\(\\s*path\\s*,[\\s\\S]*?\\broute\\b\\s*\\)`,
    )
    if (!memberForEachRe.test(source) && !destructuredForEachRe.test(source)) continue

    for (const item of arrayMatch[2].matchAll(/\{([\s\S]*?)\}/g)) {
      const objectSource = item[1]
      const prefix = /(?:^|[,\s])path\s*:\s*(['"`])([^'"`$]*?)\1/.exec(objectSource)?.[2]
      const routeVar = /(?:^|[,\s])route\s*:\s*([A-Za-z_$][\w$]*)/.exec(objectSource)?.[1]
      if (!prefix || !routeVar) continue
      out.push({ prefix, routeVar })
    }
  }

  return out
}

function extractExpressRouterArrayVariableMounts(source: string): Array<{ routeVar: string }> {
  const out: Array<{ routeVar: string }> = []
  const arrayRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*\[([\s\S]*?)\]\s*;?/g

  for (const arrayMatch of source.matchAll(arrayRe)) {
    const arrayName = arrayMatch[1]
    const appUseRe = new RegExp(`\\bapp\\.use\\s*\\(\\s*${arrayName}\\s*\\)`)
    if (!appUseRe.test(source)) continue
    for (const item of arrayMatch[2].split(',')) {
      const routeVar = item.trim()
      if (!/^[A-Za-z_$][\w$]*$/.test(routeVar)) continue
      out.push({ routeVar })
    }
  }

  return out
}

function resolveExpressMountedVariableTargetFiles(
  mountedFilePath: string,
  exportName: string,
  input: {
    repoPath: string
    graphNodes: Array<typeof codeNodes.$inferSelect>
  },
): string[] {
  const mountedSource = readFileSync(joinPath(input.repoPath, mountedFilePath), 'utf-8')
  if (extractExpressRouterLocalRoutes(mountedSource).length > 0) return [mountedFilePath]

  const out: string[] = []
  const exportStarRe = /\bexport\s+\*\s+from\s+(['"])(.*?)\1/g
  for (const match of mountedSource.matchAll(exportStarRe)) {
    const target = resolveRelativeSourceFile(mountedFilePath, match[2], input.repoPath, input.graphNodes)
    if (!target) continue
    const targetSource = readFileSync(joinPath(input.repoPath, target.filePath), 'utf-8')
    if (new RegExp(`\\b${exportName}\\b`).test(targetSource)) out.push(target.filePath)
  }

  const exportNamedRe = /\bexport\s+\{[^}]*\}\s+from\s+(['"])(.*?)\1/g
  for (const match of mountedSource.matchAll(exportNamedRe)) {
    const target = resolveRelativeSourceFile(mountedFilePath, match[2], input.repoPath, input.graphNodes)
    if (target) out.push(target.filePath)
  }

  const localImports = collectExpressImportSpecifiers(mountedSource)
  const localExportRe = /\bexport\s+\{([^}]+)\}/g
  for (const match of mountedSource.matchAll(localExportRe)) {
    if (/\bfrom\s+['"]/.test(match[0])) continue
    for (const specifier of match[1].split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/)
      const localName = parts[0]?.trim()
      const exportedName = parts.at(-1)?.trim()
      if (exportedName !== exportName || !localName) continue
      const importedPath = localImports.get(localName)
      if (!importedPath) continue
      const target = resolveRelativeSourceFile(mountedFilePath, importedPath, input.repoPath, input.graphNodes)
      if (target) out.push(target.filePath)
    }
  }

  return [...new Set(out.length > 0 ? out : [mountedFilePath])]
}

function extractExpressClassInstanceRoutes(
  source: string,
  currentFilePath: string,
  input: {
    repoPath: string
    graphNodes: Array<typeof codeNodes.$inferSelect>
  },
): ExpressSourceRoute[] {
  const imports = collectExpressImportSpecifiers(source)
  const out: ExpressSourceRoute[] = []
  const directNewRe = /\bnew\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g

  for (const match of source.matchAll(directNewRe)) {
    const importedPath = imports.get(match[1])
    if (!importedPath) continue
    const target = resolveRelativeSourceFile(currentFilePath, importedPath, input.repoPath, input.graphNodes)
    if (!target) continue
    out.push(...extractExpressClassRouterFile(target.filePath, match[1], input, '', new Set<string>()))
  }

  return dedupeExpressSourceRoutes(out)
}

function extractExpressClassRouterFile(
  currentFilePath: string,
  className: string,
  input: {
    repoPath: string
    graphNodes: Array<typeof codeNodes.$inferSelect>
  },
  basePrefix: string,
  visited: Set<string>,
): ExpressSourceRoute[] {
  const visitKey = `${currentFilePath}|${className}|${basePrefix}`
  if (visited.has(visitKey)) return []
  visited.add(visitKey)

  const source = readFileSync(joinPath(input.repoPath, currentFilePath), 'utf-8')
  const imports = collectExpressImportSpecifiers(source)
  const currentFileNode = input.graphNodes.find((node) => node.type === 'file' && node.filePath === currentFilePath)
  const out: ExpressSourceRoute[] = []

  for (const route of extractExpressRouterLocalRoutes(source)) {
    out.push({
      method: route.method,
      path: joinUrlPath(basePrefix || '/', route.path),
      sourceFallback: 'express_class_instance',
      handlerNodeId: findExpressHandlerNodeId(input.graphNodes, currentFilePath, route.handlerName) ?? currentFileNode?.id,
    })
  }

  const propertyClasses = new Map<string, string>()
  const propertyNewRe = /\bthis\.([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g
  for (const match of source.matchAll(propertyNewRe)) {
    propertyClasses.set(match[1], match[2])
  }

  const mountGetRouterRe = /\bthis\.[A-Za-z_$][\w$]*\.use\s*\(\s*(['"`])([^'"`$]*?)\1\s*,\s*this\.([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*\s*\(\s*\)\s*\)/g
  for (const match of source.matchAll(mountGetRouterRe)) {
    const prefix = normalizeExpressTemplatePath(match[2])
    const propertyClass = propertyClasses.get(match[3])
    if (!propertyClass) continue
    const importedPath = imports.get(propertyClass)
    if (!importedPath) continue
    const target = resolveRelativeSourceFile(currentFilePath, importedPath, input.repoPath, input.graphNodes)
    if (!target) continue
    out.push(...extractExpressClassRouterFile(
      target.filePath,
      propertyClass,
      input,
      joinUrlPath(basePrefix || '/', prefix),
      visited,
    ))
  }

  const propertyMethodCallRe = /\bthis\.([A-Za-z_$][\w$]*)\.loadRouters\s*\(\s*\)/g
  for (const match of source.matchAll(propertyMethodCallRe)) {
    const propertyClass = propertyClasses.get(match[1])
    if (!propertyClass) continue
    const importedPath = imports.get(propertyClass)
    if (!importedPath) continue
    const target = resolveRelativeSourceFile(currentFilePath, importedPath, input.repoPath, input.graphNodes)
    if (!target) continue
    out.push(...extractExpressClassRouterFile(target.filePath, propertyClass, input, basePrefix, visited))
  }

  return dedupeExpressSourceRoutes(out)
}

function collectExpressImportSpecifiers(source: string): Map<string, string> {
  const imports = new Map<string, string>()

  const importDefaultRe = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])(.*?)\2/g
  for (const match of source.matchAll(importDefaultRe)) {
    imports.set(match[1], match[3])
  }

  const importNamedRe = /\bimport\s+\{([^}]+)\}\s+from\s+(['"])(.*?)\2/g
  for (const match of source.matchAll(importNamedRe)) {
    for (const specifier of match[1].split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/)
      const localName = parts.at(-1)?.trim()
      if (localName) imports.set(localName, match[3])
    }
  }

  return imports
}

function dedupeExpressSourceRoutes(routes: ExpressSourceRoute[]): ExpressSourceRoute[] {
  const seen = new Set<string>()
  const out: ExpressSourceRoute[] = []
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path} ${route.handlerNodeId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(route)
  }
  return out
}

function extractExpressRouteTableRoutes(
  source: string,
  input: { graphNodes: Array<typeof codeNodes.$inferSelect> },
): ExpressSourceRoute[] {
  const tableRe = /\b(?:export\s+)?const\s+(?:AppRoutes|Routes|routes)\s*=\s*\[([\s\S]*?)\]\s*;/g
  const out: ExpressSourceRoute[] = []

  for (const table of source.matchAll(tableRe)) {
    const body = table[1]
    for (const item of body.matchAll(/\{([\s\S]*?)\}/g)) {
      const objectSource = item[1]
      const path = /(?:^|[,\s])path\s*:\s*(['"])(.*?)\1/.exec(objectSource)?.[2]
      const method = /(?:^|[,\s])method\s*:\s*(['"])(get|post|put|delete|patch|all|head|options)\1/i.exec(objectSource)?.[2]
      if (!path || !method) continue

      const actionName = /(?:^|[,\s])action\s*:\s*([A-Za-z_$][\w$]*)/.exec(objectSource)?.[1]
      out.push({
        method,
        path,
        sourceFallback: 'express_route_table',
        handlerNodeId: actionName ? findFunctionNodeByName(input.graphNodes, actionName) : undefined,
      })
    }
  }

  return out
}

function findFunctionNodeByName(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  functionName: string,
): string | undefined {
  return graphNodes.find((node) => node.type === 'function' && node.name === functionName)?.id
}

function extractExpressAppMapRoutes(source: string): ExpressSourceRoute[] {
  const start = source.indexOf('app.map({')
  if (start < 0) return []
  const end = source.indexOf('\n});', start)
  const block = source.slice(start, end > start ? end : undefined)
  const stack: Array<{ indent: number; path: string }> = []
  const out: ExpressSourceRoute[] = []

  for (const line of block.split(/\r?\n/)) {
    const pathMatch = /^(\s*)['"]([^'"]+)['"]\s*:\s*\{/.exec(line)
    if (pathMatch) {
      const indent = pathMatch[1].length
      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        stack.pop()
      }
      const parent = stack[stack.length - 1]?.path ?? ''
      const path = joinUrlPath(parent, pathMatch[2])
      stack.push({ indent, path })
      continue
    }

    const methodMatch = /^(\s*)(get|post|put|delete|patch|all|head|options)\s*:/.exec(line)
    if (!methodMatch || stack.length === 0) continue
    const indent = methodMatch[1].length
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }
    const currentPath = stack[stack.length - 1]?.path
    if (currentPath) {
      out.push({ method: methodMatch[2], path: currentPath, sourceFallback: 'express_app_map' })
    }
  }

  return out
}

function extractExpressResourceRoutes(source: string): ExpressSourceRoute[] {
  if (!source.includes('app.resource')) return []

  const resourceBody = extractAssignedFunctionBody(source, 'app.resource')
  if (!resourceBody) return []

  const templates: Array<{ method: string; suffix: string }> = []
  const routeCallRe = /\bthis\.(get|post|put|delete|patch|all|head|options)\s*\(\s*path(?:\s*\+\s*(['"])(.*?)\2)?\s*,/g
  for (const match of resourceBody.matchAll(routeCallRe)) {
    templates.push({ method: match[1], suffix: match[3] ?? '' })
  }
  if (templates.length === 0) return []

  const out: ExpressSourceRoute[] = []
  const callRe = /\bapp\.resource\s*\(\s*(['"])(.*?)\1\s*,/g
  for (const call of source.matchAll(callRe)) {
    const basePath = call[2]
    for (const template of templates) {
      out.push({
        method: template.method,
        path: joinUrlPath(basePath, template.suffix),
        sourceFallback: 'express_resource',
      })
    }
  }

  return out
}

function extractExpressRequireMountRoutes(
  source: string,
  currentFilePath: string,
  input: {
    repoPath: string
    graphNodes: Array<typeof codeNodes.$inferSelect>
  },
): ExpressSourceRoute[] {
  const mounts: Array<{ prefix: string; requiredPath: string }> = []
  const mountRe = /\bapp\.use\s*\(\s*(['"])(.*?)\1\s*,\s*require\s*\(\s*(['"])(.*?)\3\s*\)\s*\)/g
  for (const match of source.matchAll(mountRe)) {
    mounts.push({ prefix: match[2], requiredPath: match[4] })
  }
  if (mounts.length === 0) return []

  const out: ExpressSourceRoute[] = []
  for (const mount of mounts) {
    const requiredFile = resolveRelativeSourceFile(
      currentFilePath,
      mount.requiredPath,
      input.repoPath,
      input.graphNodes,
    )
    if (!requiredFile) continue

    const requiredSource = readFileSync(joinPath(input.repoPath, requiredFile.filePath), 'utf-8')
    for (const route of extractExpressRouterLocalRoutes(requiredSource)) {
      out.push({
        method: route.method,
        path: joinUrlPath(mount.prefix, route.path),
        sourceFallback: 'express_require_mount',
        handlerNodeId: findExpressHandlerNodeId(input.graphNodes, requiredFile.filePath, route.handlerName) ?? requiredFile.id,
      })
    }
  }

  return out
}

function extractExpressMvcBootRoutes(
  source: string,
  currentFilePath: string,
  input: {
    repoPath: string
    graphNodes: Array<typeof codeNodes.$inferSelect>
  },
): ExpressSourceRoute[] {
  const bootCallRe = /\brequire\s*\(\s*(['"])(.*?)\1\s*\)\s*\(\s*app\s*,/g
  const bootCalls = [...source.matchAll(bootCallRe)].filter((match) => match[2].includes('boot'))
  if (bootCalls.length === 0) return []

  const out: ExpressSourceRoute[] = []
  for (const call of bootCalls) {
    const bootFile = resolveRelativeSourceFile(currentFilePath, call[2], input.repoPath, input.graphNodes)
    if (!bootFile) continue
    const bootSource = readFileSync(joinPath(input.repoPath, bootFile.filePath), 'utf-8')
    if (!bootSource.includes("path.join(__dirname, '..', 'controllers')")) continue

    const controllersDir = joinPath(dirname(bootFile.filePath), '..', 'controllers')
    const controllerFiles = input.graphNodes.filter(
      (node) =>
        node.type === 'file' &&
        node.filePath.startsWith(`${controllersDir}/`) &&
        node.filePath.endsWith('/index.js'),
    )

    for (const controllerFile of controllerFiles) {
      const controllerSource = readFileSync(joinPath(input.repoPath, controllerFile.filePath), 'utf-8')
      const controllerDirName = dirname(controllerFile.filePath).split('/').pop() ?? ''
      const controllerName = extractStringExport(controllerSource, 'name') ?? controllerDirName
      const prefix = extractStringExport(controllerSource, 'prefix') ?? ''

      for (const exportName of extractCommonJsExportNames(controllerSource)) {
        const route = expressMvcRouteForExport(exportName, controllerName)
        if (!route) continue
        out.push({
          method: route.method,
          path: joinUrlPath(prefix, route.path),
          sourceFallback: 'express_mvc_boot',
          handlerNodeId: controllerFile.id,
        })
      }
    }
  }

  return out
}

function extractStringExport(source: string, exportName: string): string | null {
  const re = new RegExp(`\\bexports\\.${exportName}\\s*=\\s*(['"])(.*?)\\1`)
  return re.exec(source)?.[2] ?? null
}

function extractCommonJsExportNames(source: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of source.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    const name = match[1]
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function expressMvcRouteForExport(
  exportName: string,
  controllerName: string,
): { method: string; path: string } | null {
  switch (exportName) {
    case 'show':
      return { method: 'get', path: `/${controllerName}/:${controllerName}_id` }
    case 'list':
      return { method: 'get', path: `/${controllerName}s` }
    case 'edit':
      return { method: 'get', path: `/${controllerName}/:${controllerName}_id/edit` }
    case 'update':
      return { method: 'put', path: `/${controllerName}/:${controllerName}_id` }
    case 'create':
      return { method: 'post', path: `/${controllerName}` }
    case 'index':
      return { method: 'get', path: '/' }
    default:
      return null
  }
}

function resolveRelativeSourceFile(
  currentFilePath: string,
  requiredPath: string,
  repoPath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): { id: string; filePath: string } | null {
  const base = requiredPath.startsWith('@/')
    ? joinPath('src', requiredPath.slice(2))
    : joinPath(dirname(currentFilePath), requiredPath)
  const extensionlessBase = base.replace(/\.(?:mjs|cjs|js|jsx)$/, '')
  const candidates = [
    base,
    extensionlessBase,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${extensionlessBase}.js`,
    `${extensionlessBase}.jsx`,
    `${extensionlessBase}.ts`,
    `${extensionlessBase}.tsx`,
    joinPath(base, 'index.js'),
    joinPath(base, 'index.jsx'),
    joinPath(base, 'index.ts'),
    joinPath(base, 'index.tsx'),
    joinPath(extensionlessBase, 'index.js'),
    joinPath(extensionlessBase, 'index.jsx'),
    joinPath(extensionlessBase, 'index.ts'),
    joinPath(extensionlessBase, 'index.tsx'),
  ]

  for (const candidate of candidates) {
    const fileNode = graphNodes.find((node) => node.type === 'file' && node.filePath === candidate)
    if (!fileNode) continue
    if (existsSync(joinPath(repoPath, candidate))) return { id: fileNode.id, filePath: candidate }
  }

  return null
}

function extractExpressRouterLocalRoutes(source: string): Array<{ method: string; path: string; handlerName?: string }> {
  const out: Array<{ method: string; path: string; handlerName?: string }> = []
  const routeRe = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\.\s*(get|post|put|delete|patch|all|head|options)\s*\(\s*(['"])(.*?)\2\s*,\s*([A-Za-z_$][\w$]*)?/g
  for (const match of source.matchAll(routeRe)) {
    out.push({ method: match[1], path: match[3], handlerName: match[4] })
  }

  const receiver = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`
  const routeChainRe = new RegExp(
    String.raw`\b${receiver}\s*\.\s*route\s*\(\s*(['"])(.*?)\1\s*\)([\s\S]*?)(?=\n\s*${receiver}\s*\.\s*route\s*\(|\n\s*${receiver}\s*\.\s*param\s*\(|\n\s*(?:module\.exports|export\s+default)\b|$)`,
    'g',
  )
  for (const chain of source.matchAll(routeChainRe)) {
    const path = chain[2]
    const methodRe = /\.(get|post|put|delete|patch|all|head|options)\s*\(/g
    for (const method of chain[3].matchAll(methodRe)) {
      out.push({ method: method[1], path })
    }
  }
  return out
}

function findExpressHandlerNodeId(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
  handlerName: string | undefined,
): string | undefined {
  if (!handlerName) return undefined
  return graphNodes.find((node) => node.filePath === filePath && node.type === 'function' && node.name === handlerName)?.id
}

function extractAssignedFunctionBody(source: string, assignee: string): string | null {
  const start = source.indexOf(`${assignee} = function`)
  if (start < 0) return null
  const open = source.indexOf('{', start)
  if (open < 0) return null

  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }

  return null
}

interface FlutterGoRouteCall {
  start: number
  end: number
  path: string
  fullPath: string
}


export { buildExpressFallbackEntries }
