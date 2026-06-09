import type {
  ResolvedRelationFact,
  MatchedServiceMapFact,
  ServiceMapInputIndex,
  ServiceMapNode,
  ServiceMapEdgeKind,
} from './types.js'
import {
  matchApiCanonicalTarget,
  matchBySuffix,
  matchScreenCanonicalTarget,
  deriveTargetNodeType,
  deriveTargetNodeId,
  entryPointKindToNodeType,
} from './matchers.js'
import { eventNodeId } from './normalizers.js'

export function matchFactsToNodes(input: {
  facts: ResolvedRelationFact[]
  serviceMapInput: ServiceMapInputIndex
}): MatchedServiceMapFact[] {
  const { facts, serviceMapInput } = input
  const matched: MatchedServiceMapFact[] = []

  const epMap = new Map(serviceMapInput.entryPoints.map((ep) => [ep.id, ep]))

  for (const fact of facts) {
    // event_listen: reversed direction (event → listener)
    if (fact.kind === 'event_listen') {
      const eventNode: ServiceMapNode = {
        type: 'event',
        id: eventNodeId(fact.canonicalTarget),
        label: fact.canonicalTarget,
      }

      const sourceEp = epMap.get(fact.sourceEntryPointId)
      if (!sourceEp) continue

      const targetNode: ServiceMapNode = {
        type: entryPointKindToNodeType(sourceEp.kind),
        id: fact.sourceEntryPointId,
        label: sourceEp.name ?? sourceEp.path,
        repoId: sourceEp.repoId,
      }

      matched.push({
        ...fact,
        sourceNode: eventNode,
        targetNode,
        edgeKind: 'triggers',
      })
      continue
    }

    const sourceEp = epMap.get(fact.sourceEntryPointId)
    if (!sourceEp) continue

    const sourceNode: ServiceMapNode = {
      type: entryPointKindToNodeType(sourceEp.kind),
      id: fact.sourceEntryPointId,
      label: sourceEp.name ?? sourceEp.path,
      repoId: sourceEp.repoId,
    }

    // Forbidden: web screen → server DB direct. Client DB SDKs and local stores are valid page-owned dependencies.
    if (sourceEp.kind === 'page' && fact.kind === 'db_access' && !isPageOwnedDbFact(fact)) continue

    // Forbidden: job → job direct (only via event)
    if (sourceEp.kind === 'job' && fact.kind === 'api_call') {
      // job → api is allowed, only job → job is forbidden (handled in target resolution)
    }

    const targetResult = resolveTarget(fact, serviceMapInput, sourceEp.repoId, sourceEp.filePath)
    if (!targetResult) continue

    const { targetNode, edgeKind, factPatch } = targetResult

    // Forbidden: job → job direct
    if (sourceNode.type === 'job' && targetNode.type === 'job') continue

    matched.push({
      ...fact,
      ...factPatch,
      sourceNode,
      targetNode,
      edgeKind,
    })
  }

  return matched
}

function isPageOwnedDbFact(fact: ResolvedRelationFact): boolean {
  const orm = typeof fact.payload.orm === 'string' ? fact.payload.orm.toLowerCase() : null
  return orm != null && (LOCAL_CLIENT_STORE_ORMS.has(orm) || CLIENT_DB_SDK_ORMS.has(orm))
}

const LOCAL_CLIENT_STORE_ORMS = new Set([
  'drift',
  'sqflite',
  'hive',
  'isar',
  'realm',
  'shared_preferences',
  'asyncstorage',
  'indexeddb',
])

const CLIENT_DB_SDK_ORMS = new Set([
  'supabase',
])

function resolveTarget(
  fact: ResolvedRelationFact,
  input: ServiceMapInputIndex,
  sourceRepoId: string,
  sourceFilePath: string | null | undefined,
): {
  targetNode: ServiceMapNode
  edgeKind: ServiceMapEdgeKind
  factPatch?: Pick<ResolvedRelationFact, 'canonicalTarget' | 'source' | 'confidence' | 'suffixMatch'>
} | null {
  const canonical = fact.canonicalTarget

  // API matching
  if (fact.kind === 'api_call') {
    const procedureCanonical = extractProcedureCanonical(canonical)
    if (procedureCanonical) {
      const targetRepoHint = findApiTargetRepoHint(sourceRepoId, procedureCanonical, input)
      const matchResult = matchApiCanonicalTarget(procedureCanonical, input.entryPoints, targetRepoHint)
      if (matchResult) {
        return {
          targetNode: {
            type: 'api',
            id: matchResult.entryPoint.id,
            label: matchResult.entryPoint.name ?? matchResult.entryPoint.path,
            repoId: matchResult.entryPoint.repoId,
          },
          edgeKind: 'calls_api',
          factPatch: {
            canonicalTarget: procedureCanonical,
            source: 'deterministic',
            confidence: matchResult.confidence,
          },
        }
      }
      const eventMatch = matchProcedureEventTarget(procedureCanonical, input.entryPoints)
      if (eventMatch) {
        return {
          targetNode: {
            type: 'event',
            id: eventMatch.id,
            label: eventMatch.name ?? eventMatch.path,
            repoId: eventMatch.repoId,
          },
          edgeKind: 'calls_api',
          factPatch: {
            canonicalTarget: procedureCanonical,
            source: 'deterministic',
            confidence: 'high',
          },
        }
      }
    }

    const targetType = deriveTargetNodeType(canonical)

    if (targetType === 'api') {
      // try to match internal entry_point
      const targetRepoHint = findApiTargetRepoHint(sourceRepoId, canonical, input)
      const matchResult = matchApiCanonicalTarget(canonical, input.entryPoints, targetRepoHint)
      if (matchResult) {
        const canonicalTarget = matchResult.canonicalTarget ?? canonicalForApiEntryPoint(matchResult.entryPoint)
        return {
          targetNode: {
            type: 'api',
            id: matchResult.entryPoint.id,
            label: matchResult.entryPoint.name ?? matchResult.entryPoint.path,
            repoId: matchResult.entryPoint.repoId,
          },
          edgeKind: 'calls_api',
          factPatch: canonicalTarget && canonicalTarget !== canonical
            ? {
                canonicalTarget,
                source: 'suffix_match',
                confidence: matchResult.confidence,
              }
            : undefined,
        }
      }
      const suffixTarget = parseHttpCanonical(canonical)
      if (suffixTarget) {
        const suffixEntryPoints = targetRepoHint
          ? input.entryPoints.filter((entryPoint) => entryPoint.repoId === targetRepoHint)
          : input.entryPoints
        const suffixMatch = matchBySuffix(suffixTarget.path, suffixTarget.method, suffixEntryPoints, sourceFilePath)
        if (suffixMatch) {
          const epPath = suffixMatch.entryPoint.fullPath ?? suffixMatch.entryPoint.path ?? suffixTarget.path
          const method = suffixTarget.method !== 'UNKNOWN'
            ? suffixTarget.method
            : (suffixMatch.entryPoint.httpMethod ?? 'UNKNOWN')
          const canonicalTarget = method !== 'UNKNOWN' ? `${method} ${epPath}` : epPath
          return {
            targetNode: {
              type: 'api',
              id: suffixMatch.entryPoint.id,
              label: suffixMatch.entryPoint.name ?? suffixMatch.entryPoint.path,
              repoId: suffixMatch.entryPoint.repoId,
            },
            edgeKind: 'calls_api',
            factPatch: {
              canonicalTarget,
              source: 'suffix_match',
              confidence: suffixMatch.confidence,
              suffixMatch: {
                rawSuffix: suffixTarget.path,
                proximityScore: suffixMatch.proximityScore,
              },
            },
          }
        }
      }
      // no internal match — check if external (full URL) or procedure
      if (canonical.startsWith('graphql:') || canonical.startsWith('trpc:')) {
        return {
          targetNode: { type: 'external_service', id: `external_service:${canonical}`, label: canonical },
          edgeKind: 'uses_external_service',
        }
      }
      // unresolvable internal API
      return null
    }

    if (targetType === 'external_service') {
      return {
        targetNode: { type: 'external_service', id: canonical, label: canonical },
        edgeKind: 'uses_external_service',
      }
    }

    return null
  }

  // Navigation
  if (fact.kind === 'navigation') {
    const targetType = deriveTargetNodeType(canonical)
    if (targetType === 'external_link') {
      return {
        targetNode: { type: 'external_link', id: canonical, label: canonical },
        edgeKind: 'opens_external_link',
      }
    }
    // screen match
    const matchResult = matchScreenCanonicalTarget(canonical, input.entryPoints, sourceFilePath)
    if (matchResult) {
      if (matchResult.entryPoint.id === fact.sourceEntryPointId) return null
      return {
        targetNode: {
          type: 'screen',
          id: matchResult.entryPoint.id,
          label: matchResult.entryPoint.name ?? matchResult.entryPoint.path,
          repoId: matchResult.entryPoint.repoId,
        },
        edgeKind: 'navigates',
      }
    }
    return null
  }

  // DB access
  if (fact.kind === 'db_access') {
    const tableNodeId = deriveTargetNodeId(canonical, 'db')
    return {
      targetNode: { type: 'db', id: tableNodeId, label: tableNodeId },
      edgeKind: 'accesses_db',
    }
  }

  // Event publish
  if (fact.kind === 'event_publish') {
    const nodeId = eventNodeId(canonical)
    return {
      targetNode: { type: 'event', id: nodeId, label: canonical },
      edgeKind: 'publishes_event',
    }
  }

  // External service
  if (fact.kind === 'external_service') {
    return {
      targetNode: { type: 'external_service', id: canonical, label: canonical },
      edgeKind: 'uses_external_service',
    }
  }

  // External link
  if (fact.kind === 'external_link') {
    return {
      targetNode: { type: 'external_link', id: canonical, label: canonical },
      edgeKind: 'opens_external_link',
    }
  }

  return null
}

function canonicalForApiEntryPoint(entryPoint: ServiceMapInputIndex['entryPoints'][number]): string | null {
  const method = (entryPoint.httpMethod ?? 'UNKNOWN').toUpperCase()
  if (method === 'UNKNOWN') return null
  const path = entryPoint.fullPath ?? entryPoint.path
  return path ? `${method} ${path}` : null
}

function parseHttpCanonical(canonical: string): { method: string; path: string } | null {
  const match = canonical.match(/^([A-Z]+|UNKNOWN)\s+(\/.*)$/)
  if (!match) return null
  return { method: match[1], path: match[2] }
}

function findApiTargetRepoHint(
  sourceRepoId: string,
  canonical: string,
  input: ServiceMapInputIndex,
): string | null {
  const parsed = parseHttpCanonical(canonical)
  if (!parsed) return null
  const method = parsed.method.toUpperCase()
  const path = normalizeHintPath(parsed.path)
  const matches = input.apiTargetRepoHints.filter((hint) =>
    hint.sourceRepoId === sourceRepoId &&
    hint.method.toUpperCase() === method &&
    normalizeHintPath(hint.path) === path,
  )
  const targetRepoIds = [...new Set(matches.map((hint) => hint.targetRepoId))]
  return targetRepoIds.length === 1 ? targetRepoIds[0] : null
}

function normalizeHintPath(path: string): string {
  return (path.replace(/\?.*$/, '').replace(/\/+$/, '') || '/').toLowerCase()
}

function extractProcedureCanonical(canonical: string): string | null {
  if (canonical.startsWith('graphql:') || canonical.startsWith('trpc:') || canonical.startsWith('orpc:')) return canonical
  const match = canonical.match(/^(?:[A-Z_]+)\s+((?:graphql|trpc|orpc):.+)$/)
  return match?.[1] ?? null
}

function matchProcedureEventTarget(
  canonical: string,
  entryPoints: ServiceMapInputIndex['entryPoints'],
): ServiceMapInputIndex['entryPoints'][number] | null {
  return entryPoints.find((entryPoint) => (
    entryPoint.kind === 'event' && entryPoint.metadata?.['canonicalTarget'] === canonical
  )) ?? null
}
