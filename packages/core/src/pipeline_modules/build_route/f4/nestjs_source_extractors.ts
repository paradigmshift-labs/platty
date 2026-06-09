import { existsSync, readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { codeNodes } from '@/db/schema/code_graph.js'
import { derivePrimitiveAliases } from '../f3/primitive_aliases.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
  SourceRouteContext,
  StackInfoForBuildRoute,
} from '../types.js'
import { stripJsLikeComments } from './source_fallback_shared.js'
import type { LegacyFallbackInput, NestExtractor } from './source_fallback_types.js'

function buildNestScheduleAliasEntries(ctx: SourceRouteContext): EntryPointDraft[] {
  const aliasResult = derivePrimitiveAliases({
    graphNodes: ctx.graphNodes,
    graphEdges: ctx.graphEdges,
    primitiveSymbols: ['Cron', 'Interval', 'Timeout'],
    maxDepth: 3,
  })
  const scheduleDecorators = new Set([
    'Cron',
    'Interval',
    'Timeout',
    ...Object.keys(aliasResult.aliases),
  ])
  const nodeById = new Map(ctx.graphNodes.map((node) => [node.id, node]))
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const edge of ctx.graphEdges) {
    if (edge.relation !== 'decorates' || !edge.targetSymbol || !scheduleDecorators.has(edge.targetSymbol)) continue
    const node = nodeById.get(edge.sourceId)
    if (!node || node.type !== 'method') continue

    const alias = aliasResult.aliases[edge.targetSymbol]
    const primitive = alias?.primitive ?? edge.targetSymbol
    const fullPath = `schedule:${edge.targetSymbol}:${node.name}`
    const key = `${fullPath}:${node.id}`
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      framework: 'nestjs',
      kind: 'job',
      httpMethod: 'SCHEDULE',
      path: fullPath,
      fullPath,
      handlerNodeId: node.id,
      metadata: {
        sourceFallback: 'nestjs_schedule_alias',
        primitive,
        decoratorName: edge.targetSymbol,
        aliasChain: alias?.chain ?? [edge.targetSymbol],
      },
      detectionSource: 'source:nestjs_schedule',
      confidence: alias || primitive === edge.targetSymbol ? 'high' : 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_schedule_alias',
        matchedNodeIds: [node.id],
        matchedEdgeIds: typeof edge.id === 'number' ? [edge.id] : [],
        aliasChain: alias?.chain,
      },
    })
  }

  return out
}

function buildNestFallbackEntries(input: {
  repoPath: string
  repoId: string
  stackInfo: StackInfoForBuildRoute
  detections: FrameworkDetectionResult[]
  graphNodes: Array<typeof codeNodes.$inferSelect>
}): EntryPointDraft[] {
  return buildNestFallbackEntriesWithExtractors(input, [
    extractNestRestControllerEntries,
    extractNestGraphqlEntries,
    extractNestGraphqlSdlEntries,
    extractNestBullProcessorEntries,
    extractNestEventEmitterEntries,
    extractNestCqrsEntries,
    extractNestWebSocketEntries,
    extractNestMicroserviceEntries,
    extractNestGrpcEntries,
  ])
}

function buildNestFallbackEntriesWithExtractors(
  input: LegacyFallbackInput,
  extractors: NestExtractor[],
): EntryPointDraft[] {
  const nestActive = input.detections.some((d) => d.framework === 'nestjs' && d.active)
  if (!nestActive) return []

  const tsFiles = input.graphNodes.filter(
    (node) => node.type === 'file' && /\.(ts|tsx)$/.test(node.filePath),
  )
  const out: EntryPointDraft[] = []
  const seen = new Set<string>()

  for (const fileNode of tsFiles) {
    const abs = joinPath(input.repoPath, fileNode.filePath)
    if (!existsSync(abs)) continue
    const source = stripJsLikeComments(readFileSync(abs, 'utf-8'))
    for (const entry of extractors.flatMap((extract) => extract(source, fileNode.filePath, input.graphNodes))) {
      const key = `${entry.kind}:${entry.httpMethod ?? ''}:${entry.fullPath}:${entry.handlerNodeId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }

  return out
}

function extractNestRestControllerEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@Controller') || !/@(?:Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(/.test(source)) {
    return []
  }

  const out: EntryPointDraft[] = []
  const controllerRe = /@Controller\s*\(([\s\S]*?)\)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/g
  for (const controllerMatch of source.matchAll(controllerRe)) {
    const controllerArg = controllerMatch[1] ?? ''
    const className = controllerMatch[2]
    const classBodyStart = controllerMatch.index! + controllerMatch[0].length
    const classBodyEnd = findMatchingBrace(source, classBodyStart - 1)
    if (classBodyEnd === -1) continue

    const controllerPaths = extractNestControllerPaths(controllerArg)
    // NestJS @Controller({ version: '1', path: 'users' }) — version prefix 자동 추가.
    // Versioning이 'URI' 타입일 때 fullPath = /v{version}/{path} 형태가 됨.
    const controllerVersion = extractNestControllerVersion(controllerArg)
    const body = source.slice(classBodyStart, classBodyEnd)
    const methodRe = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(([^)]*)\)((?:\s*@[A-Za-z_$][\w$.]*\s*\([^)]*\)\s*)*)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g

    for (const methodMatch of body.matchAll(methodRe)) {
      const method = methodMatch[1]
      const routeArg = methodMatch[2] ?? ''
      const decoratorsAfterRoute = methodMatch[3] ?? ''
      const methodName = methodMatch[4]
      const routePaths = extractNestRoutePaths(routeArg)
      const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName)
        ?? findFileNodeId(graphNodes, filePath)
      if (!handlerNodeId) continue

      const decoratorsBeforeRoute = extractContiguousDecoratorPrefix(body, methodMatch.index ?? 0)
      const methodVersion = extractNestMethodVersion(decoratorsBeforeRoute, decoratorsAfterRoute)
      const effectiveVersion = methodVersion ?? controllerVersion
      for (const controllerPath of controllerPaths) {
        for (const routePath of routePaths) {
          const baseFullPath = normalizeNestSourcePath(controllerPath, routePath)
          const fullPath = effectiveVersion
            ? normalizeNestSourcePath(`/v${effectiveVersion}`, baseFullPath)
            : baseFullPath

          out.push({
            framework: 'nestjs',
            kind: 'api',
            fullPath,
            path: routePath === '/' ? undefined : routePath,
            httpMethod: method === 'All' ? 'ALL' : method.toUpperCase(),
            handlerNodeId,
            metadata: {
              sourceFallback: 'nestjs_controller',
              controllerPath,
              routePath,
              ...(effectiveVersion ? { version: effectiveVersion } : {}),
              ...(methodVersion ? { versionSource: 'method' } : controllerVersion ? { versionSource: 'controller' } : {}),
            },
            detectionSource: 'source:nestjs_controller',
            confidence: 'high',
            detectionEvidence: {
              matchedRuleId: 'source_nestjs_controller',
              matchedNodeIds: [handlerNodeId],
              matchedEdgeIds: [],
            },
          })
        }
      }
    }
  }

  return out
}

function extractNestiaControllerEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@Controller') || !source.includes('@TypedRoute.')) return []

  const out: EntryPointDraft[] = []
  const controllerRe = /@Controller\s*\(([\s\S]*?)\)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/g
  for (const controllerMatch of source.matchAll(controllerRe)) {
    const controllerArg = controllerMatch[1] ?? ''
    const classBodyStart = controllerMatch.index! + controllerMatch[0].length
    const classBodyEnd = findMatchingBrace(source, classBodyStart - 1)
    if (classBodyEnd === -1) continue

    const controllerPaths = extractNestControllerPaths(controllerArg)
    const controllerVersion = extractNestControllerVersion(controllerArg)
    const body = source.slice(classBodyStart, classBodyEnd)
    const methodRe = /@TypedRoute\.(Get|Post|Put|Patch|Delete|Options|Head)\s*\(([^)]*)\)((?:\s*@[A-Za-z_$][\w$.]*\s*\([^)]*\)\s*)*)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g

    for (const methodMatch of body.matchAll(methodRe)) {
      const method = methodMatch[1]
      const routeArg = methodMatch[2] ?? ''
      const decoratorsAfterRoute = methodMatch[3] ?? ''
      const methodName = methodMatch[4]
      const routePaths = extractNestRoutePaths(routeArg)
      const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName)
        ?? findFileNodeId(graphNodes, filePath)
      if (!handlerNodeId) continue

      const decoratorsBeforeRoute = extractContiguousDecoratorPrefix(body, methodMatch.index ?? 0)
      const methodVersion = extractNestMethodVersion(decoratorsBeforeRoute, decoratorsAfterRoute)
      const effectiveVersion = methodVersion ?? controllerVersion
      for (const controllerPath of controllerPaths) {
        for (const routePath of routePaths) {
          const baseFullPath = normalizeNestSourcePath(controllerPath, routePath)
          const fullPath = effectiveVersion
            ? normalizeNestSourcePath(`/v${effectiveVersion}`, baseFullPath)
            : baseFullPath
          out.push({
            framework: 'nestjs',
            kind: 'api',
            httpMethod: method.toUpperCase(),
            path: routePath || '/',
            parentPath: controllerPath || '/',
            fullPath,
            handlerNodeId,
            metadata: {
              sourceFallback: 'nestjs_nestia_typed_route',
              decoratorName: `TypedRoute.${method}`,
              controllerPath,
              routePath,
              ...(effectiveVersion ? { version: effectiveVersion } : {}),
              ...(methodVersion ? { versionSource: 'method' } : controllerVersion ? { versionSource: 'controller' } : {}),
            },
            detectionSource: 'source:nestjs_nestia',
            confidence: 'high',
            detectionEvidence: {
              matchedRuleId: 'source_nestjs_nestia_typed_route',
              matchedNodeIds: [handlerNodeId],
              matchedEdgeIds: [],
            },
          })
        }
      }
    }
  }

  return out
}

function extractNestControllerPaths(arg: string): string[] {
  // 1. object form: @Controller({ path: 'cats', version: '1' })
  //    또는 @Controller({ path: ['users','profiles'], version: '1' })
  const objectPath = /(?:^|[,{]\s*)path\s*:\s*(['"])(.*?)\1/.exec(arg)
  if (objectPath) return [objectPath[2] || '/']
  const objectPathArray = /(?:^|[,{]\s*)path\s*:\s*\[\s*(['"])(.*?)\1/.exec(arg)
  if (objectPathArray) {
    const paths = extractNamedArrayStringLiterals(arg, 'path').map((path) => path || '/')
    return paths.length > 0 ? paths : ['/']
  }
  // 2. string form: @Controller('cats')
  const stringArg = /^\s*(['"])(.*?)\1/.exec(arg)
  if (stringArg) return [stringArg[2] || '/']
  // 3. array form: @Controller(['users','profiles']) — 첫 prefix 사용
  const arrayArg = /^\s*\[\s*(['"])(.*?)\1/.exec(arg)
  if (arrayArg) {
    const paths = extractStringLiterals(arg).map((path) => path || '/')
    return paths.length > 0 ? paths : ['/']
  }
  return ['/']
}

/**
 * @Controller({ version: '1', ... }) 또는 @Controller({ ..., version: '1' }) 에서
 * version 문자열을 추출. 배열/식별자/없음 모두 null.
 */
function extractNestControllerVersion(arg: string): string | null {
  const m = /(?:^|[,{]\s*)version\s*:\s*(['"])(.*?)\1/.exec(arg)
  return m ? m[2] : null
}

function extractNestMethodVersion(...decoratorSources: string[]): string | null {
  const source = decoratorSources.join('\n')
  const m = /@Version\s*\(\s*(['"])(.*?)\1\s*\)/.exec(source)
  return m ? m[2] : null
}

function extractContiguousDecoratorPrefix(source: string, decoratorIndex: number): string {
  const prefix = source.slice(0, decoratorIndex)
  const m = /((?:\s*@[A-Za-z_$][\w$.]*\s*\([^)]*\)\s*)+)$/m.exec(prefix)
  return m ? m[1] : ''
}

function extractNestRoutePaths(arg: string): string[] {
  const stringArg = /^\s*(['"])(.*?)\1/.exec(arg)
  if (stringArg) return [stringArg[2] || '/']
  if (/^\s*\[/.test(arg)) {
    const paths = extractStringLiterals(arg).map((path) => path || '/')
    return paths.length > 0 ? paths : ['/']
  }
  return ['/']
}

function extractStringLiterals(source: string): string[] {
  return [...source.matchAll(/(['"])(.*?)\1/g)].map((match) => match[2])
}

function extractNamedArrayStringLiterals(source: string, key: string): string[] {
  const match = new RegExp(`(?:^|[,{]\\s*)${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(source)
  return match ? extractStringLiterals(match[1]) : []
}

function normalizeNestSourcePath(controllerPath: string, routePath: string): string {
  const combined = `${controllerPath}/${routePath}`
  return `/${combined.split('/').filter(Boolean).join('/')}` || '/'
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function extractNestWebSocketEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@WebSocketGateway') || !source.includes('@SubscribeMessage')) return []

  const gatewayMatch = /@WebSocketGateway\s*\(\s*([^)]*)\)/.exec(source)
  const gatewayArg = gatewayMatch?.[1]?.trim()
  const namespaceMatch = /namespace\s*:\s*(['"])(.*?)\1/.exec(gatewayArg ?? '')
  const portMatch = gatewayArg && /^\d+$/.test(gatewayArg) ? gatewayArg : null
  const out: EntryPointDraft[] = []
  const messageRe = /@SubscribeMessage\s*\(\s*(['"])(.*?)\1\s*\)\s*(?:\r?\n\s*)+(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g

  for (const match of source.matchAll(messageRe)) {
    const messageName = match[2]
    const methodName = match[3]
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName) ?? findFileNodeId(graphNodes, filePath)
    if (!handlerNodeId) continue
    const fullPath = namespaceMatch
      ? `websocket:${namespaceMatch[2]}#${messageName}`
      : portMatch
        ? `websocket:${portMatch}#${messageName}`
        : `websocket:${messageName}`
    out.push({
      framework: 'nestjs',
      kind: 'event',
      httpMethod: 'WS',
      path: fullPath,
      fullPath,
      handlerNodeId,
      metadata: {
        sourceFallback: 'nestjs_websocket_gateway',
        messageName,
        ...(namespaceMatch ? { namespace: namespaceMatch[2] } : {}),
        ...(portMatch ? { port: portMatch } : {}),
      },
      detectionSource: 'source:nestjs',
      confidence: 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_websocket_gateway',
        matchedNodeIds: [handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return out
}

function extractNestMicroserviceEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@MessagePattern') && !source.includes('@EventPattern')) return []

  const out: EntryPointDraft[] = []
  const messageRe = /@(MessagePattern|EventPattern)\s*\(\s*([\s\S]*?)\s*\)\s*(?:\r?\n\s*)+(?:@\w+(?:\.[\w$]+)?(?:\s*\([\s\S]*?\))?\s*(?:\r?\n\s*)+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g
  for (const match of source.matchAll(messageRe)) {
    const decoratorName = match[1]
    const patternArg = match[2]
    const methodName = match[3]
    const pattern = extractNestMessagePattern(patternArg)
    if (!pattern) continue
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName) ?? findFileNodeId(graphNodes, filePath)
    if (!handlerNodeId) continue
    const protocol = decoratorName === 'EventPattern' ? 'event' : 'message'
    const fullPath = `${protocol}:${pattern}`
    out.push({
      framework: 'nestjs',
      kind: 'event',
      httpMethod: decoratorName === 'EventPattern' ? 'EVENT' : 'MESSAGE',
      path: fullPath,
      fullPath,
      handlerNodeId,
      metadata: {
        sourceFallback: 'nestjs_microservice_pattern',
        decoratorName,
        pattern,
      },
      detectionSource: 'source:nestjs',
      confidence: 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_microservice_pattern',
        matchedNodeIds: [handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return out
}

function extractNestMessagePattern(patternArg: string): string | undefined {
  const stringMatch = /^\s*(['"])(.*?)\1\s*$/.exec(patternArg)
  if (stringMatch) return stringMatch[2]

  const objectMatch = /(?:cmd|pattern)\s*:\s*(['"])(.*?)\1/.exec(patternArg)
  if (objectMatch) return objectMatch[2]

  return undefined
}

function extractNestGrpcEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@GrpcMethod') && !source.includes('@GrpcStreamMethod')) return []

  const out: EntryPointDraft[] = []
  const grpcRe = /@(GrpcMethod|GrpcStreamMethod)\s*\(([^)]*)\)\s*(?:\r?\n\s*)+(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g
  for (const match of source.matchAll(grpcRe)) {
    const decoratorName = match[1]
    const decoratorArg = match[2]
    const methodName = match[3]
    const args = [...decoratorArg.matchAll(/(['"])(.*?)\1/g)].map((argMatch) => argMatch[2])
    const serviceName = args[0]
    if (!serviceName) continue
    const rpcName = args[1] ?? methodName
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName) ?? findFileNodeId(graphNodes, filePath)
    if (!handlerNodeId) continue
    const fullPath = `grpc:${serviceName}/${rpcName}`
    out.push({
      framework: 'nestjs',
      kind: 'api',
      httpMethod: decoratorName === 'GrpcStreamMethod' ? 'GRPC_STREAM' : 'GRPC',
      path: fullPath,
      fullPath,
      handlerNodeId,
      metadata: {
        sourceFallback: 'nestjs_grpc_method',
        decoratorName,
        serviceName,
        rpcName,
      },
      detectionSource: 'source:nestjs',
      confidence: 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_grpc_method',
        matchedNodeIds: [handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return out
}

function extractNestGraphqlEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@Resolver')) return []

  const out: EntryPointDraft[] = []
  for (const operation of findNestGraphqlOperations(source)) {
    const operationType = operation.type.toUpperCase()
    const methodName = operation.methodName
    const operationName = extractNestGraphqlOperationName(operation.args) || methodName
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName) ?? findFileNodeId(graphNodes, filePath)
    if (!handlerNodeId) continue
    const kind = operationType === 'SUBSCRIPTION' ? 'event' : 'api'
    const fullPath = `/graphql#${operationType.toLowerCase()}.${operationName}`
    out.push({
      framework: 'nestjs',
      kind,
      httpMethod: operationType,
      path: fullPath,
      fullPath,
      handlerNodeId,
      metadata: {
        sourceFallback: 'nestjs_graphql_resolver',
        operationType,
        operationName,
        canonicalTarget: `graphql:${operationName}`,
      },
      detectionSource: 'source:nestjs',
      confidence: 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_graphql_resolver',
        matchedNodeIds: [handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return out
}

function extractNestGraphqlSdlEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('type Query') && !source.includes('type Mutation') && !source.includes('type Subscription')) {
    return []
  }

  const handlerNodeId = findFileNodeId(graphNodes, filePath)
  if (!handlerNodeId) return []

  const out: EntryPointDraft[] = []
  const rootTypeRe = /type\s+(Query|Mutation|Subscription)\s*\{([\s\S]*?)\}/g
  for (const match of source.matchAll(rootTypeRe)) {
    const operationType = match[1].toUpperCase()
    const body = match[2]
    for (const line of body.split(/\r?\n/)) {
      const fieldMatch = /^\s*([A-Za-z_$][\w$]*)\s*(?:\(|:)/.exec(line)
      if (!fieldMatch) continue
      const operationName = fieldMatch[1]
      const kind = operationType === 'SUBSCRIPTION' ? 'event' : 'api'
      const fullPath = `/graphql#${operationType.toLowerCase()}.${operationName}`
      out.push({
        framework: 'nestjs',
        kind,
        httpMethod: operationType,
        path: fullPath,
        fullPath,
        handlerNodeId,
        metadata: {
          sourceFallback: 'nestjs_graphql_sdl',
          operationType,
          operationName,
          canonicalTarget: `graphql:${operationName}`,
        },
        detectionSource: 'source:nestjs',
        confidence: 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_nestjs_graphql_sdl',
          matchedNodeIds: [handlerNodeId],
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function findNestGraphqlOperations(source: string): Array<{
  type: 'Query' | 'Mutation' | 'Subscription'
  args: string
  methodName: string
}> {
  const out: Array<{
    type: 'Query' | 'Mutation' | 'Subscription'
    args: string
    methodName: string
  }> = []
  const opRe = /@(Query|Mutation|Subscription)\b/g

  for (const match of source.matchAll(opRe)) {
    const type = match[1] as 'Query' | 'Mutation' | 'Subscription'
    const decorator = readDecoratorCall(source, match.index + match[0].length)
    if (!decorator) continue

    let cursor = decorator.end
    while (true) {
      cursor = skipWhitespace(source, cursor)
      if (source[cursor] !== '@') break
      const decoratorNameMatch = /^@[\w$.]+/.exec(source.slice(cursor))
      if (!decoratorNameMatch) break
      const nested = readDecoratorCall(source, cursor + decoratorNameMatch[0].length)
      if (!nested) break
      cursor = nested.end
    }

    const methodMatch = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(skipWhitespace(source, cursor)))
    if (!methodMatch) continue
    out.push({ type, args: decorator.args, methodName: methodMatch[1] })
  }

  return out
}

function readDecoratorCall(source: string, start: number): { args: string; end: number } | undefined {
  let cursor = skipWhitespace(source, start)
  if (source[cursor] !== '(') return { args: '', end: cursor }

  const argsStart = cursor + 1
  let depth = 0
  let quote: '"' | "'" | '`' | undefined
  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    const prev = source[cursor - 1]
    if (quote) {
      if (char === quote && prev !== '\\') quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(') {
      depth += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth === 0) return { args: source.slice(argsStart, cursor), end: cursor + 1 }
    }
  }

  return undefined
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
  return cursor
}

function extractNestGraphqlOperationName(source: string): string | undefined {
  const match = /^\s*(['"])(.*?)\1/.exec(source)
  if (match) return match[2]

  const nameMatch = /(?:^|[,{]\s*)name\s*:\s*(['"])(.*?)\1/.exec(source)
  return nameMatch?.[2]
}

function extractNestBullProcessorEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  const processorMatch = /@Processor\s*\(\s*(['"])(.*?)\1\s*\)/.exec(source)
  if (!processorMatch) return []

  const queueName = processorMatch[2]
  const out: EntryPointDraft[] = []
  const processRe = /@Process(?:\s*\(\s*(?:(['"])(.*?)\1)?\s*\))?\s*(?:\r?\n\s*)+(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g
  for (const match of source.matchAll(processRe)) {
    const jobName = match[2] || '*'
    const methodName = match[3]
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName) ?? findFileNodeId(graphNodes, filePath)
    if (!handlerNodeId) continue
    const fullPath = `${queueName}/${jobName}`
    out.push({
      framework: 'nestjs',
      kind: 'job',
      path: fullPath,
      fullPath,
      handlerNodeId,
      metadata: { sourceFallback: 'nestjs_bull_processor', queueName, jobName },
      detectionSource: 'source:nestjs',
      confidence: 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_bull_processor',
        matchedNodeIds: [handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  if (out.length === 0 && /\bWorkerHost\b/.test(source)) {
    const methodName = 'process'
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName) ?? findFileNodeId(graphNodes, filePath)
    if (handlerNodeId) {
      const fullPath = `${queueName}/*`
      out.push({
        framework: 'nestjs',
        kind: 'job',
        path: fullPath,
        fullPath,
        handlerNodeId,
        metadata: { sourceFallback: 'nestjs_bullmq_worker', queueName, jobName: '*' },
        detectionSource: 'source:nestjs',
        confidence: 'medium',
        detectionEvidence: {
          matchedRuleId: 'source_nestjs_bullmq_worker',
          matchedNodeIds: [handlerNodeId],
          matchedEdgeIds: [],
        },
      })
    }
  }

  return out
}

function extractNestEventEmitterEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@OnEvent')) return []

  const out: EntryPointDraft[] = []
  const eventRe = /@OnEvent\s*\(\s*(['"])(.*?)\1(?:\s*,[\s\S]*?)?\)\s*(?:\r?\n\s*)+(?:@\w+(?:\.[\w$]+)?(?:\s*\([\s\S]*?\))?\s*(?:\r?\n\s*)+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g
  for (const match of source.matchAll(eventRe)) {
    const eventName = match[2]
    const methodName = match[3]
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName) ?? findFileNodeId(graphNodes, filePath)
    if (!handlerNodeId) continue
    out.push({
      framework: 'nestjs',
      kind: 'event',
      httpMethod: 'EVENT',
      path: eventName,
      fullPath: eventName,
      handlerNodeId,
      metadata: { sourceFallback: 'nestjs_event_emitter', eventName },
      detectionSource: 'source:nestjs',
      confidence: 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_event_emitter',
        matchedNodeIds: [handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return out
}

function extractNestCqrsEntries(
  source: string,
  filePath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): EntryPointDraft[] {
  if (!source.includes('@EventsHandler') && !source.includes('@CommandHandler') && !source.includes('@QueryHandler')) {
    return []
  }

  const out: EntryPointDraft[] = []
  const handlerRe = /@(EventsHandler|CommandHandler|QueryHandler)\s*\(\s*([^)]+?)\s*\)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/g
  for (const match of source.matchAll(handlerRe)) {
    const decoratorName = match[1]
    const targetName = normalizeCqrsHandlerTarget(match[2])
    const className = match[3]
    if (!targetName) continue

    const classBodyStart = match.index! + match[0].length
    const classBodyEnd = findMatchingBrace(source, classBodyStart - 1)
    if (classBodyEnd === -1) continue
    const body = source.slice(classBodyStart, classBodyEnd)
    const handlerMethod = /(?:async\s+)?(execute|handle)\s*\(/.exec(body)
    const methodName = handlerMethod?.[1] ?? className
    const handlerNodeId = findMethodNodeId(graphNodes, filePath, methodName)
      ?? graphNodes.find((node) => node.filePath === filePath && node.type === 'class' && node.name.endsWith(className))?.id
      ?? findFileNodeId(graphNodes, filePath)
    if (!handlerNodeId) continue

    const protocol = decoratorName === 'CommandHandler'
      ? 'command'
      : decoratorName === 'QueryHandler'
        ? 'query'
        : 'event'
    const fullPath = `${protocol}:${targetName}`
    out.push({
      framework: 'nestjs',
      kind: 'event',
      httpMethod: `CQRS_${protocol.toUpperCase()}`,
      path: fullPath,
      fullPath,
      handlerNodeId,
      metadata: { sourceFallback: 'nestjs_cqrs_handler', decoratorName, targetName },
      detectionSource: 'source:nestjs',
      confidence: 'medium',
      detectionEvidence: {
        matchedRuleId: 'source_nestjs_cqrs_handler',
        matchedNodeIds: [handlerNodeId],
        matchedEdgeIds: [],
      },
    })
  }

  return out
}

function normalizeCqrsHandlerTarget(raw: string): string | undefined {
  const stringMatch = /^\s*(['"])(.*?)\1\s*$/.exec(raw)
  if (stringMatch) return stringMatch[2]
  const identifierMatch = /^\s*([A-Za-z_$][\w$]*)(?:\.name)?\s*$/.exec(raw)
  return identifierMatch?.[1]
}

function findMethodNodeId(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
  methodName: string,
): string | undefined {
  return graphNodes.find(
    (node) =>
      node.filePath === filePath &&
      node.type === 'method' &&
      (node.name === methodName || node.name.endsWith(`.${methodName}`)),
  )?.id
}

function findFileNodeId(
  graphNodes: Array<typeof codeNodes.$inferSelect>,
  filePath: string,
): string | undefined {
  return graphNodes.find((node) => node.filePath === filePath && node.type === 'file')?.id
}


export {
  buildNestFallbackEntriesWithExtractors,
  buildNestScheduleAliasEntries,
  extractNestBullProcessorEntries,
  extractNestCqrsEntries,
  extractNestEventEmitterEntries,
  extractNestGraphqlEntries,
  extractNestGraphqlSdlEntries,
  extractNestGrpcEntries,
  extractNestMicroserviceEntries,
  extractNestRestControllerEntries,
  extractNestWebSocketEntries,
  extractNestiaControllerEntries,
}
