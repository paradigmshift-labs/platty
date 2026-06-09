import type { EntryPointDraft } from '@/pipeline_modules/build_route/types.js'

export interface RouteOracleItem {
  kind: 'api' | 'page' | 'job' | 'event'
  method?: string
  path: string
  handler: string
}

export interface RouteOracleDiff {
  missing: RouteOracleItem[]
  unexpected: RouteOracleItem[]
}

export function diffRouteOracle(actual: EntryPointDraft[], expected: RouteOracleItem[]): RouteOracleDiff {
  const actualItems = actual.map((entry) => ({
    kind: entry.kind,
    method: entry.httpMethod,
    path: entry.fullPath ?? entry.path ?? '',
    handler: entry.handlerNodeId,
  }))

  return {
    missing: expected.filter((item) => !actualItems.some((actualItem) => routeKey(actualItem) === routeKey(item))),
    unexpected: actualItems.filter((item) => !expected.some((expectedItem) => routeKey(expectedItem) === routeKey(item))),
  }
}

export function expectRouteOracle(actual: EntryPointDraft[], expected: RouteOracleItem[]): void {
  const diff = diffRouteOracle(actual, expected)
  if (diff.missing.length > 0 || diff.unexpected.length > 0) {
    throw new Error([
      'Route oracle mismatch',
      `missing:\n${formatItems(diff.missing)}`,
      `unexpected:\n${formatItems(diff.unexpected)}`,
    ].join('\n\n'))
  }
}

function routeKey(item: RouteOracleItem): string {
  return [
    item.kind,
    item.method ?? '',
    item.path,
    item.handler,
  ].join('|')
}

function formatItems(items: RouteOracleItem[]): string {
  if (items.length === 0) return '- none'
  return items.map((item) => `- ${item.kind} ${item.method ?? ''} ${item.path} ${item.handler}`.trim()).join('\n')
}
