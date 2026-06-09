import type { CallArgExpression } from '../../../types.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'])

export function normalizeAuthMethod(method: string | null): string {
  const normalized = method?.trim().toUpperCase()
  return normalized && HTTP_METHODS.has(normalized.toLowerCase()) ? normalized : 'GET'
}

export function staticString(expression: CallArgExpression | undefined): string | null {
  if (!expression) return null
  if (expression.kind === 'string' && expression.value) return expression.value
  if (expression.kind === 'template' && expression.staticPattern && expression.resolution === 'static') {
    return expression.staticPattern
  }
  return null
}

export function parseLiteralArgs(literalArgs: string | null | undefined): unknown[] {
  if (!literalArgs) return []
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
