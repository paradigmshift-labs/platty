import { EXTERNAL_SERVICE_FAMILY_DEFINITIONS } from './families/index.js'
import type { ExternalServiceDefinition } from './families/types.js'

export type { ExternalServiceDefinition } from './families/types.js'

export const EXTERNAL_SERVICE_DEFINITIONS = {
  ...EXTERNAL_SERVICE_FAMILY_DEFINITIONS,
} satisfies Record<string, ExternalServiceDefinition>

export type ExternalService = keyof typeof EXTERNAL_SERVICE_DEFINITIONS

export const EXTERNAL_SERVICE_PACKAGE_SET = new Set(
  Object.values(EXTERNAL_SERVICE_DEFINITIONS).flatMap((definition) => definition.packages),
)

export function serviceForPackage(pkg: string | null | undefined): ExternalService | null {
  if (!pkg) return null
  return (Object.entries(EXTERNAL_SERVICE_DEFINITIONS) as Array<[ExternalService, ExternalServiceDefinition]>)
    .find(([, definition]) => packageMatchesDefinition(pkg, definition))
    ?.[0] ?? null
}

export function isExternalServiceMethod(service: ExternalService, method: string | null): boolean {
  if (!method) return false
  const methods = EXTERNAL_SERVICE_DEFINITIONS[service].methods
  return methods === 'any' || methods.includes(method)
}

function packageMatchesDefinition(pkg: string, definition: ExternalServiceDefinition): boolean {
  return definition.packages.includes(pkg)
    || (definition.packagePrefixes ?? []).some((prefix) => pkg.startsWith(prefix))
}
