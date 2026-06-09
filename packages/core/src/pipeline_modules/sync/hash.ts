import { createHash } from 'node:crypto'

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStable(value))
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function normalizeStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeStable(item))
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = normalizeStable(record[key])
      return acc
    }, {})
}
