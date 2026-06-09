import type { ReviewableDomain, ReviewableEpic, ValidationIssue } from '@/pipeline_modules/build_epics_core/types.js'
import type { TaxonomyBoundaryNote, TaxonomyConsolidationAlias } from './types.js'

export type TaxonomyConsolidationEpic = Pick<ReviewableEpic, 'tempEpicId' | 'stableKey' | 'name' | 'abbr' | 'summary'> & {
  domainId: string
}

export interface TaxonomyConsolidationSubmission {
  domains: Array<Omit<ReviewableDomain, 'epicIds'> & { epicIds?: string[] }>
  epics: TaxonomyConsolidationEpic[]
  aliases?: TaxonomyConsolidationAlias[]
  boundaryNotes?: TaxonomyBoundaryNote[]
}

export interface NormalizedTaxonomyConsolidationSubmission {
  domains: Array<Omit<ReviewableDomain, 'epicIds'> & { epicIds: string[] }>
  epics: TaxonomyConsolidationEpic[]
  aliases: TaxonomyConsolidationAlias[]
  boundaryNotes: TaxonomyBoundaryNote[]
}

export function normalizeConsolidatedTaxonomySubmission(input: TaxonomyConsolidationSubmission): NormalizedTaxonomyConsolidationSubmission {
  const domains = [
    ...new Map(
      (input.domains ?? []).map((domain) => [
        normalizeKey(domain.stableKey),
        { ...domain, stableKey: normalizeKey(domain.stableKey), epicIds: [...new Set(domain.epicIds ?? [])] },
      ]),
    ).values(),
  ]
  const canonicalDomainIdsByStableKey = new Map(domains.map((domain) => [domain.stableKey, domain.domainId]))
  const canonicalDomainIdsByDomainId = new Map(
    (input.domains ?? []).map((domain) => [
      domain.domainId,
      canonicalDomainIdsByStableKey.get(normalizeKey(domain.stableKey)) ?? domain.domainId,
    ]),
  )
  const epics = [
    ...new Map(
      (input.epics ?? []).map((epic) => [
        normalizeKey(epic.stableKey),
        { ...epic, domainId: canonicalDomainIdsByDomainId.get(epic.domainId) ?? epic.domainId, stableKey: normalizeKey(epic.stableKey) },
      ]),
    ).values(),
  ]
  const epicIdsByDomainId = new Map<string, string[]>()
  for (const epic of epics) {
    epicIdsByDomainId.set(epic.domainId, [...(epicIdsByDomainId.get(epic.domainId) ?? []), epic.tempEpicId])
  }

  return {
    domains: domains.map((domain) => ({ ...domain, epicIds: [...new Set(epicIdsByDomainId.get(domain.domainId) ?? [])] })),
    epics,
    aliases: (input.aliases ?? []).map((alias) => ({
      fromStableKey: normalizeKey(alias.fromStableKey),
      toStableKey: normalizeKey(alias.toStableKey),
      reason: String(alias.reason ?? ''),
    })),
    boundaryNotes: (input.boundaryNotes ?? []).map((note) => ({
      stableKey: normalizeKey(note.stableKey),
      includes: [...new Set((note.includes ?? []).map(String).filter(Boolean))],
      excludes: [...new Set((note.excludes ?? []).map(String).filter(Boolean))],
    })),
  }
}

export function validateConsolidatedTaxonomySubmission(input: TaxonomyConsolidationSubmission): ValidationIssue[] {
  const normalized = normalizeConsolidatedTaxonomySubmission(input)
  const errors: ValidationIssue[] = []
  const domainIds = new Set(normalized.domains.map((domain) => domain.domainId))
  const epicKeys = new Set(normalized.epics.map((epic) => epic.stableKey))
  const rawEpicKeys = new Set((input.epics ?? []).map((epic) => normalizeKey(epic.stableKey)))

  if (normalized.domains.length === 0) {
    errors.push({
      severity: 'fatal',
      code: 'EMPTY_CONSOLIDATED_DOMAINS',
      message: 'Consolidated taxonomy must include at least one domain.',
    })
  }
  if (normalized.epics.length === 0) {
    errors.push({
      severity: 'fatal',
      code: 'EMPTY_CONSOLIDATED_EPICS',
      message: 'Consolidated taxonomy must include at least one EPIC.',
    })
  }

  for (const epic of normalized.epics) {
    if (!domainIds.has(epic.domainId)) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_CONSOLIDATED_EPIC_DOMAIN',
        message: `EPIC ${epic.stableKey} references unknown domain ${epic.domainId}`,
        tempEpicId: epic.tempEpicId,
      })
    }
  }

  for (const alias of normalized.aliases) {
    if (!rawEpicKeys.has(alias.fromStableKey)) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_ALIAS_SOURCE',
        message: `Alias source ${alias.fromStableKey} is not present in taxonomy candidates.`,
        stableKey: alias.fromStableKey,
      } as ValidationIssue & { stableKey: string })
    }
    if (!epicKeys.has(alias.toStableKey)) {
      errors.push({
        severity: 'fatal',
        code: 'UNKNOWN_ALIAS_TARGET',
        message: `Alias target ${alias.toStableKey} is not present in consolidated epics.`,
        stableKey: alias.toStableKey,
      } as ValidationIssue & { stableKey: string })
    }
  }

  return errors
}

function normalizeKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
