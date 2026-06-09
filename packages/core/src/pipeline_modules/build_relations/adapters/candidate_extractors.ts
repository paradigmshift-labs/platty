import type { RelationCandidateExtractorAdapter } from './types.js'
import { extractApiCallCandidates } from '../candidates/api_call.js'
import { extractDbAccessCandidates } from '../candidates/db_access.js'
import { extractNavigationCandidates } from '../candidates/navigation.js'
import { eventBrokerAdapter } from './event/brokers.js'
import { urlLauncherExternalLinkAdapter } from './external/links.js'
import { externalServiceAdapter } from './external/services.js'
import { flutterRouteNavigationAdapter } from './navigation/flutter_routes.js'
import { extractPatternProfileRelationCandidates } from './profile_dsl.js'
import { linkRenderNavigationAdapter } from './navigation/link_renders.js'
import { nestScheduleAdapter } from './schedule/nest_schedule.js'

export const relationCandidateExtractorAdapters: RelationCandidateExtractorAdapter[] = [
  {
    name: 'profile_dsl',
    relationKinds: ['db_access', 'api_call'],
    extractCandidates: extractPatternProfileRelationCandidates,
  },
  {
    name: 'db_access',
    relationKinds: ['db_access'],
    extractCandidates: extractDbAccessCandidates,
  },
  {
    name: 'api_call',
    relationKinds: ['api_call'],
    extractCandidates: extractApiCallCandidates,
  },
  linkRenderNavigationAdapter,
  flutterRouteNavigationAdapter,
  {
    name: 'external_link',
    relationKinds: ['external_link'],
    extractCandidates: urlLauncherExternalLinkAdapter.extractCandidates,
  },
  {
    name: 'navigation',
    relationKinds: ['navigation'],
    extractCandidates: extractNavigationCandidates,
  },
  {
    name: 'event',
    relationKinds: ['event'],
    extractCandidates: eventBrokerAdapter.extractCandidates,
  },
  {
    name: 'schedule_trigger',
    relationKinds: ['schedule_trigger'],
    extractCandidates: nestScheduleAdapter.extractCandidates,
  },
  {
    name: 'external_service',
    relationKinds: ['external_service'],
    extractCandidates: externalServiceAdapter.extractCandidates,
  },
]
