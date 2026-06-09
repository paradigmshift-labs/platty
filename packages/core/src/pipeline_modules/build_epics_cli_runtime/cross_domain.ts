import type {
  BuildEpicsCrossDomainKind,
  BuildEpicsCrossDomainRole,
  Confidence,
  EpicCrossDomainLink,
  EpicDependencyKind,
  ReviewableEpic,
  ValidationIssue,
} from '@/pipeline_modules/build_epics_core/types.js'
import type { BuildEpicsDocumentCard } from './types.js'

export interface CrossDomainSubmission {
  links: EpicCrossDomainLink[]
}

export interface CrossDomainValidationInput {
  cards: BuildEpicsDocumentCard[]
  epics: ReviewableEpic[]
  ownerByDocumentId: Map<string, string>
  submission: CrossDomainSubmission
  maxCrossLinksPerDocument: number
}

export function validateCrossDomainSubmission(input: CrossDomainValidationInput): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  const cardIds = new Set(input.cards.map((card) => card.documentId))
  const epicIds = new Set(input.epics.map((epic) => epic.tempEpicId))
  const perDocCount = new Map<string, number>()

  for (const link of input.submission.links) {
    if (!cardIds.has(link.sourceDocumentId)) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_CROSS_LINK_SOURCE',
        message: `Unknown cross-link source ${link.sourceDocumentId}`,
        documentId: link.sourceDocumentId,
      })
      continue
    }
    if (!epicIds.has(link.targetTempEpicId)) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_CROSS_LINK_TARGET',
        message: `Unknown cross-link target ${link.targetTempEpicId}`,
        documentId: link.sourceDocumentId,
        tempEpicId: link.targetTempEpicId,
      })
      continue
    }
    if (input.ownerByDocumentId.get(link.sourceDocumentId) === link.targetTempEpicId) {
      errors.push({
        severity: 'fatal',
        code: 'SELF_CROSS_LINK',
        message: `Cross-link target is the owner EPIC for ${link.sourceDocumentId}`,
        documentId: link.sourceDocumentId,
        tempEpicId: link.targetTempEpicId,
      })
      continue
    }
    const nextCount = (perDocCount.get(link.sourceDocumentId) ?? 0) + 1
    perDocCount.set(link.sourceDocumentId, nextCount)
    if (nextCount > input.maxCrossLinksPerDocument) {
      errors.push({
        severity: 'fatal',
        code: 'MAX_CROSS_LINKS_EXCEEDED',
        message: `Too many cross-links for ${link.sourceDocumentId}`,
        documentId: link.sourceDocumentId,
      })
    }
  }

  return errors
}

export function attachCrossDomainSubmissions(epics: ReviewableEpic[], submissions: CrossDomainSubmission[]): ReviewableEpic[] {
  const next = epics.map((epic) => ({
    ...epic,
    crossLinks: [...epic.crossLinks],
    dependencies: [...epic.dependencies],
  }))
  const ownerByDocumentId = buildOwnerMap(next)
  const epicById = new Map(next.map((epic) => [epic.tempEpicId, epic]))

  for (const link of dedupeLinks(submissions.flatMap((submission) => submission.links))) {
    const ownerEpic = epicById.get(ownerByDocumentId.get(link.sourceDocumentId) ?? '')
    if (!ownerEpic) continue
    if (ownerEpic.tempEpicId === link.targetTempEpicId) continue
    ownerEpic.crossLinks.push(link)
    const dependency = { targetTempEpicId: link.targetTempEpicId, kind: toDependencyKind(link.kind), reason: link.reason }
    if (!ownerEpic.dependencies.some((existing) => existing.targetTempEpicId === dependency.targetTempEpicId && existing.kind === dependency.kind)) {
      ownerEpic.dependencies.push(dependency)
    }
  }

  return next
}

export function buildOwnerMap(epics: ReviewableEpic[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const epic of epics) {
    for (const link of epic.apiLinks) map.set(link.apiDocId, epic.tempEpicId)
    for (const link of epic.screenLinks) map.set(link.screenDocId, epic.tempEpicId)
    for (const link of epic.eventLinks) map.set(link.eventDocId, epic.tempEpicId)
    for (const link of epic.scheduleLinks) map.set(link.scheduleDocId, epic.tempEpicId)
  }
  return map
}

function toDependencyKind(kind: BuildEpicsCrossDomainKind): EpicDependencyKind {
  if (kind === 'event_flow') return 'event_flow'
  if (kind === 'operational_dependency') return 'external_call'
  if (kind === 'shared_user_journey') return 'cross_screen'
  return 'cross_domain_state_change'
}

function dedupeLinks(links: EpicCrossDomainLink[]): EpicCrossDomainLink[] {
  const seen = new Set<string>()
  const output: EpicCrossDomainLink[] = []
  for (const link of links) {
    const normalized = normalizeLink(link)
    const key = `${normalized.sourceDocumentId}:${normalized.targetTempEpicId}:${normalized.kind}:${normalized.role}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function normalizeLink(link: EpicCrossDomainLink): EpicCrossDomainLink {
  return {
    sourceDocumentId: link.sourceDocumentId,
    targetTempEpicId: link.targetTempEpicId,
    kind: parseKind(link.kind),
    role: parseRole(link.role),
    confidence: parseConfidence(link.confidence),
    reason: String(link.reason ?? ''),
  }
}

function parseKind(value: unknown): BuildEpicsCrossDomainKind {
  return value === 'reward_or_coupon_effect'
    || value === 'state_change'
    || value === 'event_flow'
    || value === 'shared_user_journey'
    || value === 'operational_dependency'
    ? value
    : 'cross_domain_policy'
}

function parseRole(value: unknown): BuildEpicsCrossDomainRole {
  return value === 'supporting' || value === 'reference' ? value : 'impact'
}

function parseConfidence(value: unknown): Confidence {
  return value === 'high' || value === 'low' ? value : 'medium'
}
