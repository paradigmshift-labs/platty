import { getReceiverRoot } from '../../../graph_trace/receiver_identity.js'
import type { ExternalServiceExtractionFamily } from './extraction_types.js'
import {
  isRecord,
  normalizeName,
  objectStringValue,
  parseFirstObject,
  parseLiteralArgs,
  readNodeSource,
  unique,
} from './extraction_utils.js'

export const SEARCH_SERVICE_EXTRACTION: ExternalServiceExtractionFamily = {
  services: ['algolia', 'elasticsearch'],
  targetArgs(service, context) {
    if (service === 'algolia') return algoliaTargetArgs(context)
    if (service === 'elasticsearch') return elasticsearchTargetArgs(context)
    return null
  },
  detectServicesForCall(context) {
    if (context.call.targetSymbol == null) return []
    const algoliaMethods = new Set([
      'saveObject',
      'saveObjects',
      'partialUpdateObject',
      'partialUpdateObjects',
      'deleteObject',
      'deleteObjects',
      'search',
      'browseObjects',
      'searchSingleIndex',
    ])
    if (!algoliaMethods.has(context.call.targetSymbol)) return []

    const services: string[] = context.callsInNode
      .filter((edge) => edge.targetSymbol === 'initIndex' && edge.chainPath?.includes('.initIndex'))
      .flatMap((edge) => context.detectImportedReceiverServicesByRoot(getReceiverRoot(edge.chainPath ?? '')))
      .filter((service) => service === 'algolia')

    const binding = localInitIndexBinding(context)
    if (binding) services.push(...context.detectImportedReceiverServicesByRoot(binding.receiver))

    return unique(services)
  },
}

function algoliaTargetArgs(context: Parameters<NonNullable<ExternalServiceExtractionFamily['targetArgs']>>[1]): Array<string | null> {
  const indexName = objectStringValue(context.call.literalArgs, 'indexName')
  if (indexName) return [indexName]

  const multiSearchIndices = algoliaMultiSearchIndexNames(context.call.literalArgs)
  if (multiSearchIndices.length > 0) return multiSearchIndices

  const chainIndex = context.call.chainPath?.match(/\.initIndex\(['"]([^'"]+)['"]\)/)?.[1]
  if (chainIndex) return [chainIndex]

  const initIndexCalls = unique([
    ...context.callsInNode
      .filter((edge) => edge.targetSymbol === 'initIndex' && edge.firstArg)
      .map((edge) => context.resolveStaticArg(edge.firstArg as string))
      .filter((value): value is string => Boolean(value)),
    ...algoliaInitIndexNamesFromSource(context),
  ])
  const matched = algoliaIndexForReceiver(context.call.chainPath, initIndexCalls)
  if (matched) return [matched]
  return new Set(initIndexCalls).size === 1 ? [initIndexCalls[0]] : []
}

function elasticsearchTargetArgs(context: Parameters<NonNullable<ExternalServiceExtractionFamily['targetArgs']>>[1]): Array<string | null> {
  const index = objectStringValue(context.call.literalArgs, 'index')
  if (index) return [index]

  const bulkIndices = elasticsearchBulkIndexNames(context.call.literalArgs)
  if (bulkIndices.length > 0) return bulkIndices

  return []
}

function algoliaInitIndexNamesFromSource(context: Parameters<NonNullable<ExternalServiceExtractionFamily['targetArgs']>>[1]): string[] {
  const bindings = localInitIndexBindings(context)
  if (bindings.length === 0) return []

  const receiverRoot = getReceiverRoot(context.call.chainPath ?? '')
  const relevantBindings = receiverRoot
    ? bindings.filter((binding) => binding.alias === receiverRoot)
    : bindings
  return unique(
    relevantBindings
      .map((binding) => context.resolveStaticArg(binding.indexArg))
      .filter((value): value is string => Boolean(value)),
  )
}

function localInitIndexBinding(
  context: Parameters<NonNullable<ExternalServiceExtractionFamily['targetArgs']>>[1],
): { alias: string; receiver: string; indexArg: string } | null {
  const receiverRoot = getReceiverRoot(context.call.chainPath ?? '')
  if (!receiverRoot) return null
  return localInitIndexBindings(context)
    .find((binding) => binding.alias === receiverRoot) ?? null
}

function localInitIndexBindings(
  context: Parameters<NonNullable<ExternalServiceExtractionFamily['targetArgs']>>[1],
): Array<{ alias: string; receiver: string; indexArg: string }> {
  const loaded = readNodeSource(context.inputs, context.sourceNodeId, context.index)
  if (!loaded) return []

  const bindings: Array<{ alias: string; receiver: string; indexArg: string }> = []
  const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.initIndex\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?|['"][^'"]+['"])\s*\)/g
  for (const match of loaded.source.matchAll(pattern)) {
    const alias = match[1]
    const receiver = match[2]?.split('.')[0]
    const rawArg = match[3]
    if (!alias || !receiver || !rawArg) continue
    bindings.push({
      alias,
      receiver,
      indexArg: rawArg.replace(/^['"]|['"]$/g, ''),
    })
  }
  return bindings
}

function algoliaMultiSearchIndexNames(literalArgs: string | null | undefined): string[] {
  const [first] = parseLiteralArgs(literalArgs)
  if (!Array.isArray(first)) return []

  return unique(
    first
      .map((entry) => isRecord(entry) && typeof entry.indexName === 'string' ? entry.indexName : null)
      .filter((indexName): indexName is string => indexName != null),
  )
}

function algoliaIndexForReceiver(chainPath: string | null, indexNames: string[]): string | null {
  if (!chainPath) return null
  const receiver = normalizeName(chainPath.split('.').at(-1) ?? chainPath)
  const matches = unique(indexNames).filter((indexName) => receiver.includes(normalizeName(indexName)))
  return matches.length === 1 ? matches[0] : null
}

function elasticsearchBulkIndexNames(literalArgs: string | null | undefined): string[] {
  const first = parseFirstObject(literalArgs)
  const operations = first?.operations
  if (!Array.isArray(operations)) return []

  const indices: string[] = []
  for (const operation of operations) {
    if (!isRecord(operation)) continue
    for (const metadata of Object.values(operation)) {
      if (isRecord(metadata) && typeof metadata._index === 'string') indices.push(metadata._index)
    }
  }
  return unique(indices)
}
