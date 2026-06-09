import type { RelationCandidate, SemanticIndex, ExtractedRelation } from '../types.js'
import { EXTERNAL_SERVICE_FAMILY_RESOLVERS } from './external_service_families/index.js'
import type { ServiceResolver } from './external_service_families/types.js'

export const SERVICE_RESOLVER_REGISTRY: Record<string, ServiceResolver> = {
  ...EXTERNAL_SERVICE_FAMILY_RESOLVERS,
}

export function resolveExternalServiceCandidate(
  candidate: RelationCandidate,
  _index: SemanticIndex,
): ExtractedRelation | null {
  const service = candidate.payload.service as string | undefined
  if (!service) return null

  const target = buildTarget(service, candidate)
  if (!target) return null

  const resolver = serviceFamilyResolverFor(service)
  const payload: Record<string, unknown> = {
    ...candidate.payload,
    service,
    ...(resolver?.payloadFor?.(candidate, service) ?? {}),
  }

  return {
    sourceNodeId: candidate.sourceNodeId,
    kind: 'external_service',
    target,
    operation: operationFor(candidate),
    canonicalTarget: `external_service:${target}`,
    payload,
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence: 'high',
  }
}

function buildTarget(service: string, candidate: RelationCandidate): string | null {
  const familyResolver = serviceFamilyResolverFor(service)
  if (familyResolver) {
    const target = familyResolver.targetFor?.(candidate, service)
    if (target) return target
    const resource = familyResolver.resourceFor(candidate)
    return resource ? `${service}:${resource}` : null
  }

  return null
}

function operationFor(candidate: RelationCandidate): string {
  const familyOperation = serviceFamilyResolverFor(candidate.payload.service as string | undefined)?.operationFor(candidate)
  if (familyOperation) return familyOperation

  return 'unknown'
}

function serviceFamilyResolverFor(service: string | null | undefined): ServiceResolver | null {
  return service ? SERVICE_RESOLVER_REGISTRY[service] ?? null : null
}
