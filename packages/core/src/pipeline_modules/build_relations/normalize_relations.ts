// F5: normalizeRelations — canonical target + dedupe key 정규화
// SOT: specs/build_relations/architecture.md §4 F5

import { createHash } from 'node:crypto'
import type { ExtractedRelation, NormalizedCodeRelation } from './types.js'

export function normalizeRelations(relations: ExtractedRelation[]): NormalizedCodeRelation[] {
  const dedupeMap = new Map<string, NormalizedCodeRelation>()

  for (const rel of relations) {
    const canonicalTarget = rel.canonicalTarget ?? computeCanonicalTarget(rel)
    const dedupeKey = makeDedupeKey(rel, canonicalTarget)

    const existing = dedupeMap.get(dedupeKey)
    if (existing) {
      // evidence 병합 (중복 제거)
      const merged = [...new Set([...existing.evidenceNodeIds, ...rel.evidenceNodeIds])]
      dedupeMap.set(dedupeKey, { ...existing, evidenceNodeIds: merged })
    } else {
      dedupeMap.set(dedupeKey, { ...rel, canonicalTarget, dedupeKey })
    }
  }

  return [...dedupeMap.values()]
}

function computeCanonicalTarget(rel: ExtractedRelation): string | null {
  if (rel.kind === 'schedule_trigger') return null

  switch (rel.kind) {
    case 'api_call':
      if (!rel.target) return null
      return `${rel.operation ?? 'UNKNOWN'} ${rel.target}`

    case 'navigation':
      if (!rel.target) return null
      return `screen:${normalizeRoutePath(rel.target)}`

    case 'db_access':
      if (!rel.target || !rel.operation) return null
      return `db:${rel.target}:${rel.operation}`

    case 'event_publish':
    case 'event_listen': {
      const broker = (rel.payload.broker as string | undefined) ?? 'node_event'
      if (!rel.target) return null
      return `${broker}:${rel.target}`
    }

    case 'external_link':
      if (!rel.target) return null
      return `external:${rel.target}`

    case 'external_service':
      if (!rel.target) return null
      return `external_service:${rel.target}`

    default:
      return rel.target
  }
}

export function normalizeRoutePath(path: string): string {
  // /users/${id} → /users/:id
  // /users/[id] → /users/:id
  // /users/{id} → /users/:id
  return path
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\[([^\]]+)\]/g, ':$1')
    .replace(/\{([^}]+)\}/g, ':$1')
    .replace(/:[^/]+/g, (m) => {
      // normalize already-colon params to :id placeholder for canonical
      return m
    })
}

function makeDedupeKey(rel: ExtractedRelation, canonicalTarget: string | null): string {
  if (rel.kind === 'schedule_trigger') {
    const schedType = rel.payload.schedule_type as string | undefined
    const schedVal = (rel.payload.cron ?? rel.payload.interval_ms ?? rel.payload.timeout_ms) as string | number | undefined
    return `${rel.sourceNodeId}:schedule_trigger:${schedType ?? ''}:${schedVal ?? ''}`
  }
  return `${rel.sourceNodeId}:${rel.kind}:${canonicalTarget ?? ''}:${rel.operation ?? ''}`
}

export function makeRelationId(repoId: string, rel: NormalizedCodeRelation): string {
  const hash = createHash('sha256')
    .update(`${repoId}:${rel.dedupeKey}`)
    .digest('base64url')
    .slice(0, 24)
  return `cr:${hash}`
}
