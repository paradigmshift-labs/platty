// F4: resolveCandidates — resolver 별 확정 (스텁)
// SOT: specs/build_relations/architecture.md §4 F4

import type { RelationCandidate, SemanticIndex, SourceFallback, ExtractedRelation } from '../types.js'
import { resolveDbAccessCandidate } from './db_access.js'
import { resolveApiCallCandidate } from './api_call.js'
import { resolveNavigationCandidate } from './navigation.js'
import { resolveEventCandidate } from './event.js'
import { resolveScheduleTriggerCandidate } from './schedule_trigger.js'
import { resolveExternalLinkCandidate } from './external_link.js'
import { resolveExternalServiceCandidate } from './external_service.js'

export function resolveCandidates(
  candidates: RelationCandidate[],
  index: SemanticIndex,
  sourceFallback: SourceFallback,
): ExtractedRelation[] {
  const results: ExtractedRelation[] = []

  for (const candidate of candidates) {
    let resolved: ExtractedRelation | null = null

    switch (candidate.kind) {
      case 'db_access':
        resolved = resolveDbAccessCandidate(candidate, index, sourceFallback)
        break
      case 'api_call':
        resolved = resolveApiCallCandidate(candidate, index, sourceFallback)
        break
      case 'navigation':
        resolved = resolveNavigationCandidate(candidate, index, sourceFallback)
        break
      case 'event':
        resolved = resolveEventCandidate(candidate, index, sourceFallback)
        break
      case 'schedule_trigger':
        resolved = resolveScheduleTriggerCandidate(candidate, index)
        break
      case 'external_link':
        resolved = resolveExternalLinkCandidate(candidate, index, sourceFallback)
        break
      case 'external_service':
        resolved = resolveExternalServiceCandidate(candidate, index)
        break
    }

    if (resolved) results.push(resolved)
  }

  return results
}
