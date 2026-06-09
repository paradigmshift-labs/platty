import { dartRoleRegistryEntries } from './ecosystems/dart.js'
import { javaRoleRegistryEntries } from './ecosystems/java.js'
import { kotlinRoleRegistryEntries } from './ecosystems/kotlin.js'
import { swiftRoleRegistryEntries } from './ecosystems/swift.js'
import { typescriptRoleRegistryEntries } from './ecosystems/typescript.js'
import type {
  StaticAnalysisEcosystem,
  StaticAnalysisRoleLookupInput,
  StaticAnalysisRoleRegistryEntry,
} from './types.js'

export type * from './types.js'

const REGISTRY: Record<StaticAnalysisEcosystem, StaticAnalysisRoleRegistryEntry[]> = {
  typescript: typescriptRoleRegistryEntries,
  dart: dartRoleRegistryEntries,
  java: javaRoleRegistryEntries,
  kotlin: kotlinRoleRegistryEntries,
  swift: swiftRoleRegistryEntries,
}

export function supportedStaticAnalysisEcosystems(): StaticAnalysisEcosystem[] {
  return Object.keys(REGISTRY) as StaticAnalysisEcosystem[]
}

export function lookupStaticAnalysisRole(
  input: StaticAnalysisRoleLookupInput,
): StaticAnalysisRoleRegistryEntry | null {
  const ecosystem = normalizeEcosystem(input.ecosystem)
  const packageName = normalizePackageName(input.packageName, ecosystem)
  if (!ecosystem || !packageName) return null
  const entry = REGISTRY[ecosystem].find((item) => item.packageName === packageName)
  return entry ? { ...entry, defaultRuleIds: [...(entry.defaultRuleIds ?? [])] } : null
}

export function activateDefaultRuleIds(inputs: StaticAnalysisRoleLookupInput[]): string[] {
  const ids = new Set<string>()
  for (const input of inputs) {
    const entry = lookupStaticAnalysisRole(input)
    if (!entry || entry.curation !== 'official' || entry.confidence !== 'high') continue
    for (const id of entry.defaultRuleIds ?? []) ids.add(id)
  }
  return [...ids].sort()
}

export function normalizeEcosystem(
  value: StaticAnalysisRoleLookupInput['ecosystem'],
): StaticAnalysisEcosystem | null {
  const normalized = value?.toLowerCase()
  if (normalized === 'javascript') return 'typescript'
  if (normalized === 'typescript' || normalized === 'dart' || normalized === 'java' || normalized === 'kotlin' || normalized === 'swift') {
    return normalized
  }
  return null
}

export function normalizePackageName(
  value: StaticAnalysisRoleLookupInput['packageName'],
  ecosystem?: StaticAnalysisEcosystem | null,
): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (ecosystem === 'dart' && trimmed.startsWith('package:')) {
    const withoutScheme = trimmed.slice('package:'.length)
    return withoutScheme.split('/')[0] ?? null
  }
  if (ecosystem === 'typescript') {
    const [first, second] = trimmed.split('/')
    if (first?.startsWith('@')) return first && second ? `${first}/${second}` : trimmed
    return first ?? null
  }
  return trimmed
}
