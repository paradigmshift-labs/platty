import { createHash } from 'node:crypto'
import { extractJsonValue } from '@/pipeline_infra/index.js'
import type { BusinessDocument, BusinessDocumentType, ConfirmedEpic, UseCaseListDocument } from './types.js'

export function stableBusinessDocumentId(projectId: string, type: BusinessDocumentType, scope: string, scopeId: string): string {
  return `${projectId}:business:${type}:${scope}:${scopeId}`
}

export function stableBusinessDocumentItemId(documentId: string, itemType: string, stableKey: string): string {
  return `${documentId}:item:${itemType}:${stableKey}`
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function stableKeyPart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'unknown'
}

export function epicAbbr(epic: Pick<ConfirmedEpic, 'abbr' | 'name'>): string {
  const raw = epic.abbr?.trim() || epic.name
  const slug = raw
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return slug || 'EPIC'
}

export function contentHash(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

export function parseBusinessDocument<T extends BusinessDocument>(raw: string): T {
  const parsed = extractJsonValue(raw) as T
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('LLM output is not a business document JSON object')
  }
  if (!parsed.scope_id) throw new Error('LLM output missing scope_id')
  return parsed
}

export function extractExistingUseCases(existingUcl: BusinessDocument | null): UseCaseListDocument['use_cases'] {
  if (!existingUcl || existingUcl.type !== 'ucl') return []
  return existingUcl.use_cases
}

export function assignStableUseCaseIds(
  epic: ConfirmedEpic,
  useCases: Array<Omit<UseCaseListDocument['use_cases'][number], 'use_case_id'> & { use_case_id?: string }>,
  existing: UseCaseListDocument['use_cases'],
): UseCaseListDocument['use_cases'] {
  const existingByIdentity = new Map<string, string>()
  const usedNumbers = new Set<number>()
  for (const item of existing) {
    const primary = (item.coverage ?? [])
      .filter((coverage) => coverage.role === 'primary')
      .map((coverage) => coverage.source_document_id)
      .sort()
      .join('|')
    existingByIdentity.set(`${normalizeTitle(item.title)}::${primary}`, item.use_case_id)
    const match = item.use_case_id.match(/-(\d+)$/)
    if (match) usedNumbers.add(Number(match[1]))
  }

  let next = 1
  const nextId = () => {
    while (usedNumbers.has(next)) next++
    usedNumbers.add(next)
    return `UC-${epicAbbr(epic)}-${String(next).padStart(3, '0')}`
  }

  return useCases.map((item) => {
    const primary = (item.coverage ?? [])
      .filter((coverage) => coverage.role === 'primary')
      .map((coverage) => coverage.source_document_id)
      .sort()
      .join('|')
    const preserved = existingByIdentity.get(`${normalizeTitle(item.title)}::${primary}`)
    const assigned = preserved ?? (item.use_case_id?.startsWith(`UC-${epicAbbr(epic)}-`) ? item.use_case_id : nextId())
    return {
      ...item,
      use_case_id: assigned,
      coverage: (item.coverage ?? []).map((coverage) => ({ ...coverage, use_case_id: assigned })),
    }
  })
}
