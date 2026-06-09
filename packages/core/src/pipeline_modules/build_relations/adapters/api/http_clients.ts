import type { CallArgExpression, CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../types.js'
import type { RelationAdapterContext, RelationCandidateAdapter } from '../types.js'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { isApiClientPackage, isApiClientType, isDartApiClientPackage, isJsApiClientPackage, JS_API_CLIENT_PACKAGES } from './packages.js'
import { matchRealtimeAuthApiCandidate } from './realtime_auth.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'])
const INTERNAL_PATH_RE = /^\/[^/]/
const EXTERNAL_URL_RE = /^https?:\/\//
const IDENTIFIER_RE = /^[A-Za-z_$][\w.$]*$/
const API_RECEIVER_RE = /(?:^|[.$_])(api|http|https|client|request|axios)(?:[A-Z_$.\d]|$)/i

export const httpClientApiAdapter: RelationCandidateAdapter = {
  name: 'http_client',
  relationKind: 'api_call',
  matchCall(edge: CodeEdgeLike, sourceNodeId: string, context: RelationAdapterContext): RelationCandidate | null {
    const method = edge.targetSymbol
    if (!method) return null

    if (method === 'fetch' && !edge.chainPath) {
      const rawTarget = edge.firstArg
      if (!rawTarget) return null
      if (!EXTERNAL_URL_RE.test(rawTarget) && !INTERNAL_PATH_RE.test(rawTarget) && !IDENTIFIER_RE.test(rawTarget)) return null
      const fetchMethod = extractFetchMethod(edge.argExpressions)
      return {
        kind: 'api_call',
        sourceNodeId,
        evidenceNodeIds: [`edge:${edge.id}`],
        chainPath: null,
        firstArg: edge.firstArg,
        rawTarget,
        payload: { method: fetchMethod ?? 'GET', protocol: 'rest', anchor: 'global_fetch', adapter: 'fetch' },
      }
    }

    if (isBrowserEventSourceConstructor(method)) {
      const rawTarget = edge.firstArg
      if (!rawTarget || EXTERNAL_URL_RE.test(rawTarget)) return null
      if (!INTERNAL_PATH_RE.test(rawTarget) && !IDENTIFIER_RE.test(rawTarget)) return null
      return {
        kind: 'api_call',
        sourceNodeId,
        evidenceNodeIds: [`edge:${edge.id}`],
        chainPath: edge.chainPath ?? null,
        firstArg: rawTarget,
        rawTarget,
        payload: {
          method: 'GET',
          protocol: 'sse',
          anchor: 'browser_eventsource',
          adapter: 'eventsource',
        },
      }
    }

    const realtimeAuthCandidate = matchRealtimeAuthApiCandidate(edge, sourceNodeId)
    if (realtimeAuthCandidate) return realtimeAuthCandidate

    const localWrapperCandidate = matchBareLocalHttpWrapperCall(edge, sourceNodeId, context)
    if (localWrapperCandidate) return localWrapperCandidate

    if (!HTTP_METHODS.has(method.toLowerCase())) return null

    const chainPath = edge.chainPath ?? ''
    const anchor = detectApiClientAnchor(sourceNodeId, chainPath, edge, context)
    if (!anchor) return null

    const objectConfig = method.toLowerCase() === 'request' ? extractRequestConfig(edge.argExpressions) : null
    const rawTarget = objectConfig?.url ?? edge.firstArg ?? null
    if (!rawTarget) return null
    const normalizedTarget = EXTERNAL_URL_RE.test(rawTarget) ? rawTarget : normalizeApiTarget(rawTarget)
    if (!normalizedTarget && !IDENTIFIER_RE.test(rawTarget)) return null

    return {
      kind: 'api_call',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath,
      firstArg: normalizedTarget ?? rawTarget,
      rawTarget: normalizedTarget ?? rawTarget,
      payload: {
        method: objectConfig?.method?.toUpperCase() ??
          extractFetchMethod(edge.argExpressions) ??
          extractNamedMethodFromLiteralArgs(edge.literalArgs) ??
          method.toUpperCase(),
        protocol: 'rest',
        anchor,
        adapter: 'http_client',
      },
    }
  },
}

function matchBareLocalHttpWrapperCall(
  edge: CodeEdgeLike,
  sourceNodeId: string,
  context: RelationAdapterContext,
): RelationCandidate | null {
  if (edge.chainPath || !edge.targetId) return null
  const rawTarget = edge.firstArg
  if (!rawTarget || EXTERNAL_URL_RE.test(rawTarget)) return null
  if (!INTERNAL_PATH_RE.test(rawTarget) && !IDENTIFIER_RE.test(rawTarget)) return null
  if (!importedTargetHasHttpEvidence(context.index, edge.targetId, 0, new Set())) return null

  return {
    kind: 'api_call',
    sourceNodeId,
    evidenceNodeIds: [`edge:${edge.id}`],
    chainPath: null,
    firstArg: rawTarget,
    rawTarget,
    payload: {
      method: extractFetchMethod(edge.argExpressions) ??
        extractNamedMethodFromLiteralArgs(edge.literalArgs) ??
        inferHttpMethodFromSymbol(edge.targetSymbol) ??
        'UNKNOWN',
      protocol: 'rest',
      anchor: 'local_http_wrapper',
      adapter: 'local_http_wrapper',
    },
  }
}

function isBrowserEventSourceConstructor(method: string): boolean {
  return method === 'EventSource' || method.endsWith('.EventSource')
}

function inferHttpMethodFromSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null
  const lower = symbol.toLowerCase()
  if (!HTTP_METHODS.has(lower) || lower === 'request') return null
  return lower.toUpperCase()
}

function extractFetchMethod(argExpressions: unknown): string | null {
  if (!Array.isArray(argExpressions)) return null
  const expressions = argExpressions as CallArgExpression[]
  const secondArg = expressions.find((arg) => arg.index === 1)
  const config = secondArg?.kind === 'object' ? secondArg : secondArg?.resolved
  if (config?.kind !== 'object' || !config.properties) return null
  return staticString(config.properties.method)?.toUpperCase() ?? null
}

function extractNamedMethodFromLiteralArgs(literalArgs: string | null | undefined): string | null {
  if (!literalArgs) return null
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    if (!Array.isArray(parsed)) return null
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const method = (item as Record<string, unknown>).method
      if (typeof method === 'string' && method.trim()) return method.toUpperCase()
    }
  } catch {
    return null
  }
  return null
}

function extractRequestConfig(
  argExpressions: unknown,
): { url: string | null; method: string | null } | null {
  if (!Array.isArray(argExpressions)) return null
  const expressions = argExpressions as CallArgExpression[]
  const firstArg = expressions.find((arg) => arg.index === 0)
  const first = firstArg?.kind === 'object' ? firstArg : firstArg?.resolved
  if (first?.kind !== 'object' || !first.properties) return null
  const url = staticString(first.properties.url)
  const method = staticString(first.properties.method)
  return url || method ? { url, method } : null
}

function staticString(expression: CallArgExpression | undefined): string | null {
  if (!expression) return null
  if (expression.kind === 'string' && expression.value) return expression.value
  if (expression.kind === 'template' && expression.staticPattern && expression.resolution === 'static') {
    return expression.staticPattern
  }
  return null
}

function detectApiClientAnchor(
  nodeId: string,
  chainPath: string,
  edge: CodeEdgeLike,
  context: RelationAdapterContext,
): string | null {
  if (!chainPath) return null

  const { index } = context
  const receiver = chainPath.replace(/^this\./, '').split('.')[0]
  if (edge.targetSpecifier && isInternalModuleSpecifier(edge.targetSpecifier) && isApiLikeReceiver(receiver)) {
    return 'local_http_wrapper'
  }

  // R1: DI-injected field receiver (`this.httpService` typed `HttpService` / `@nestjs/axios`). Resolve the field
  // to its declared type/package — receiver-NAME-independent: `this.anyName.post()` resolves iff its field type
  // is a known http client. Two real graph shapes: (a) classFieldOrigins (constructor `uses_type` DI), and
  // (b) a class FIELD node `<Class>.<receiver>` carrying a `type_ref` edge (TS parameter-property
  // `constructor(private readonly httpService: HttpService)` — the dominant NestJS form; classFieldOrigins does
  // NOT capture TS type_ref). See specs/refactor/r1-api-call-di-receiver.md.
  if (chainPath.startsWith('this.')) {
    const diAnchor = resolveDiFieldApiAnchor(nodeId, receiver, index)
    if (diAnchor) return diAnchor
  }

  const imports = index.importsBySource.get(nodeId) ?? []
  for (const imp of imports) {
    if (imp.targetSymbol === receiver && isJsApiClientPackage(imp.targetSpecifier)) {
      return imp.targetSpecifier
    }
    if (imp.targetSymbol === receiver && isDartApiClientPackage(imp.targetSpecifier)) {
      return imp.targetSpecifier
    }
    if (imp.targetSymbol === receiver && isLocalHttpWrapperImport(imp, receiver, index)) {
      return 'local_http_wrapper'
    }
  }

  const node = index.nodesById.get(nodeId)
  if (node) {
    const fileNodes = index.nodesByFile.get(node.filePath) ?? []
    for (const fileNode of fileNodes) {
      const fileImports = index.importsBySource.get(fileNode.id) ?? []
      for (const imp of fileImports) {
        if (imp.targetSymbol === receiver && isJsApiClientPackage(imp.targetSpecifier)) {
          return imp.targetSpecifier
        }
        if (imp.targetSymbol === receiver && isDartApiClientPackage(imp.targetSpecifier)) {
          return imp.targetSpecifier
        }
        if (imp.targetSymbol === receiver && isLocalHttpWrapperImport(imp, receiver, index)) {
          return 'local_http_wrapper'
        }
      }
    }
    const dartAnchor = detectDartHttpPackageAnchor(node.id, context)
    if (dartAnchor) return dartAnchor
    const sourceImportAnchor = detectSourceImportAnchor(node.filePath, receiver, context)
    if (sourceImportAnchor) return sourceImportAnchor
  }

  for (const [wrapperNodeId, wrapper] of index.wrapperFunctions) {
    if (wrapper.kind !== 'api_client') continue
    const wrapperNode = index.nodesById.get(wrapperNodeId)
    if (wrapperNode?.name === receiver) return wrapper.targetPackage ?? 'unknown'
  }

  return null
}

/**
 * Resolve a `this.<receiver>` DI/field receiver to its http-client anchor by its DECLARED TYPE (package or type
 * name), not its name. Covers both real graph shapes: classFieldOrigins (constructor `uses_type` DI) and a class
 * field node `<Class>.<receiver>` with a `type_ref` edge (TS parameter-property, e.g. NestJS
 * `constructor(private readonly httpService: HttpService)`). Returns the package (or `type:<Type>`) or null.
 */
function resolveDiFieldApiAnchor(nodeId: string, receiver: string, index: SemanticIndex): string | null {
  const parentClassId = index.containsParentByChild.get(nodeId)
  if (!parentClassId) return null

  // (a) classFieldOrigins — constructor `uses_type` DI param the index already summarizes.
  const origin = index.classFieldOrigins.get(parentClassId)?.get(receiver)
  if (origin && (isApiClientPackage(origin.packageName) || isApiClientType(origin.typeName))) {
    return origin.packageName ?? `type:${origin.typeName}`
  }

  // (b) the class field declaration node `<Class>.<receiver>` and its `type_ref` (TS parameter-property).
  const cls = index.nodesById.get(parentClassId)
  if (cls?.name) {
    const fieldName = `${cls.name}.${receiver}`
    for (const fieldNode of index.nodesByFile.get(cls.filePath) ?? []) {
      if (fieldNode.name !== fieldName || index.containsParentByChild.get(fieldNode.id) !== parentClassId) continue
      for (const ref of index.typeRefsBySource.get(fieldNode.id) ?? []) {
        if (isApiClientPackage(ref.targetSpecifier) || isApiClientType(ref.targetSymbol)) {
          return ref.targetSpecifier ?? `type:${ref.targetSymbol}`
        }
      }
    }
  }
  return null
}

function isLocalHttpWrapperImport(
  imp: CodeEdgeLike,
  receiver: string,
  index: SemanticIndex,
): boolean {
  if (imp.targetId && importedTargetHasHttpEvidence(index, imp.targetId, 0, new Set())) return true
  if (!isApiLikeReceiver(receiver)) return false
  if (imp.targetId) return true
  const specifier = imp.targetSpecifier
  if (!specifier) return false
  return isInternalModuleSpecifier(specifier)
}

function importedTargetHasHttpEvidence(
  index: SemanticIndex,
  nodeId: string,
  depth: number,
  visited: Set<string>,
): boolean {
  if (depth > 5 || visited.has(nodeId)) return false
  visited.add(nodeId)
  const directImports = index.importsBySource.get(nodeId) ?? []
  if (directImports.some((imp) => isKnownHttpPackage(imp.targetSpecifier))) return true
  const directCalls = index.callsBySource.get(nodeId) ?? []
  if (directCalls.some((call) => isDirectHttpEvidenceCall(call))) return true
  const node = index.nodesById.get(nodeId)
  if (node) {
    for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
      const fileImports = index.importsBySource.get(fileNode.id) ?? []
      if (fileImports.some((imp) => isKnownHttpPackage(imp.targetSpecifier))) return true
      const fileCalls = index.callsBySource.get(fileNode.id) ?? []
      if (fileCalls.some((call) => isDirectHttpEvidenceCall(call))) return true
    }
  }
  for (const edge of index.edgesBySource.get(nodeId) ?? []) {
    if (!edge.targetId) continue
    if (!['imports', 'calls', 'contains'].includes(edge.relation)) continue
    if (importedTargetHasHttpEvidence(index, edge.targetId, depth + 1, visited)) return true
  }
  return false
}

function isDirectHttpEvidenceCall(edge: CodeEdgeLike): boolean {
  if (edge.targetSymbol === 'fetch') return true
  if (!edge.targetSymbol || !edge.firstArg) return false
  return HTTP_METHODS.has(edge.targetSymbol.toLowerCase()) &&
    Boolean(edge.chainPath) &&
    (INTERNAL_PATH_RE.test(edge.firstArg) || IDENTIFIER_RE.test(edge.firstArg))
}

function detectDartHttpPackageAnchor(nodeId: string, context: RelationAdapterContext): string | null {
  const node = context.index.nodesById.get(nodeId)
  if (!node?.filePath.endsWith('.dart')) return null
  for (const id of nodeAndFileNodeIds(nodeId, context.index)) {
    const found = (context.index.importsBySource.get(id) ?? []).find((imp) =>
      isDartApiClientPackage(imp.targetSpecifier),
    )
    if (found?.targetSpecifier) return found.targetSpecifier
  }
  return null
}

function nodeAndFileNodeIds(nodeId: string, index: SemanticIndex): string[] {
  const ids = [nodeId]
  const node = index.nodesById.get(nodeId)
  if (!node) return ids
  for (const fileNode of index.nodesByFile.get(node.filePath) ?? []) {
    if (fileNode.id !== nodeId) ids.push(fileNode.id)
  }
  return ids
}

function isKnownHttpPackage(specifier: string | null | undefined): boolean {
  if (!specifier) return false
  return isApiClientPackage(specifier)
}

function isApiLikeReceiver(receiver: string): boolean {
  return API_RECEIVER_RE.test(receiver)
}

function isInternalModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('~/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('src/')
}

function normalizeApiTarget(rawTarget: string): string | null {
  if (INTERNAL_PATH_RE.test(rawTarget)) return rawTarget
  if (/^(?:v\d+(?:\.\d+)?|api|graphql|rest)(?:\/|$)/.test(rawTarget)) {
    return `/${rawTarget.replace(/^\/+/, '')}`
  }
  return null
}

function detectSourceImportAnchor(
  filePath: string,
  receiver: string | undefined,
  context: RelationAdapterContext,
): string | null {
  if (!receiver || !context.inputs?.repoPath) return null
  const root = resolve(context.inputs.repoPath)
  const fullPath = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath)
  const rel = relative(root, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(fullPath)) return null

  let source = ''
  try {
    source = readFileSync(fullPath, 'utf8')
  } catch {
    return null
  }

  for (const pkg of JS_API_CLIENT_PACKAGES) {
    const escapedPkg = escapeRegExp(pkg)
    const defaultImport = new RegExp(String.raw`\bimport\s+${escapeRegExp(receiver)}(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]${escapedPkg}['"]`)
    const namespaceImport = new RegExp(String.raw`\bimport\s+\*\s+as\s+${escapeRegExp(receiver)}\s+from\s+['"]${escapedPkg}['"]`)
    const requireImport = new RegExp(String.raw`\b(?:const|let|var)\s+${escapeRegExp(receiver)}\s*=\s*require\(\s*['"]${escapedPkg}['"]\s*\)`)
    if (defaultImport.test(source) || namespaceImport.test(source) || requireImport.test(source)) return pkg
  }

  return null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
