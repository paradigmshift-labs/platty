import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuildRelationsInputs, SemanticIndex } from '../../../types.js'

export function readNodeSource(
  inputs: BuildRelationsInputs,
  sourceNodeId: string,
  index: SemanticIndex,
): { filePath: string; source: string } | null {
  if (!inputs.repoPath) return null

  const node = index.nodesById.get(sourceNodeId)
  if (!node?.filePath) return null

  const sourcePath = join(inputs.repoPath, node.filePath)
  if (!existsSync(sourcePath)) return null

  return { filePath: node.filePath, source: readFileSync(sourcePath, 'utf-8') }
}

export function readFileNodeSource(
  inputs: BuildRelationsInputs,
  filePath: string,
): string | null {
  if (!inputs.repoPath) return null

  const sourcePath = join(inputs.repoPath, filePath)
  if (!existsSync(sourcePath)) return null

  return readFileSync(sourcePath, 'utf-8')
}

export function collectStringConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>()
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g)) {
    if (match[1] && match[2]) constants.set(match[1], match[2])
  }
  return constants
}

export function resolveObjectStringProperty(
  objectBody: string,
  property: string,
  constants: Map<string, string>,
): string | null {
  const literal = objectBody.match(new RegExp(`\\b${property}\\s*:\\s*['"]([^'"]+)['"]`))?.[1]
  if (literal) return literal

  const identifier = objectBody.match(new RegExp(`\\b${property}\\s*:\\s*([A-Za-z_$][\\w$]*)\\b`))?.[1]
  return identifier ? constants.get(identifier) ?? null : null
}

export function objectStringValue(literalArgs: string | null | undefined, key: string): string | null {
  const first = parseFirstObject(literalArgs)
  const value = first?.[key]
  return typeof value === 'string' ? value : null
}

export function parseFirstObject(literalArgs: string | null | undefined): Record<string, unknown> | null {
  const args = parseLiteralArgs(literalArgs)
  const first = args[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null
  return first as Record<string, unknown>
}

export function parseLiteralArgs(literalArgs: string | null | undefined): unknown[] {
  if (!literalArgs) return []
  try {
    const args = JSON.parse(literalArgs) as unknown
    return Array.isArray(args) ? args : []
  } catch {
    return []
  }
}

export function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)]
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
