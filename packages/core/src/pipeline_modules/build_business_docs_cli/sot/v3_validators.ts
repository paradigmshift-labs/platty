import type { BusinessDocument, BusinessDocumentType } from './types.js'
import { resolveBusinessDocumentItems } from './business_doc_item_resolver.js'
import { stableKeyPart } from './utils.js'

export type BusinessLanguageValidationIssue = {
  ruleId: string
  fieldPath: string
  matchedText: string
}

export type BusinessLanguageValidationResult = {
  passed: boolean
  issues: BusinessLanguageValidationIssue[]
}

export type LinkCoverageCoreItem = {
  itemId: string
  linkedDocumentIds: string[]
}

export type LinkCoverageValidationResult = {
  passed: boolean
  linkedCoreItemCount: number
  totalCoreItemCount: number
  coverageRatio: number
  threshold: number
}

export type BusinessDocumentValidationIssue = {
  code: string
  severity: 'fatal' | 'warning'
  message: string
  fieldPath?: string
}

export type BusinessDocumentValidationResult = {
  passed: boolean
  issues: BusinessDocumentValidationIssue[]
}

const contaminationRules: Array<{ ruleId: string; pattern: RegExp }> = [
  { ruleId: 'TECH_API_PATH', pattern: /\/api\/[^\s"')]+/i },
  { ruleId: 'TECH_CLASS_NAME', pattern: /\b[A-Z][A-Za-z0-9]+(?:Controller|UseCase|Usecase|Service|Repository)\b/ },
  { ruleId: 'TECH_DECORATOR', pattern: /@[A-Za-z][A-Za-z0-9_]+/ },
  { ruleId: 'TECH_GUARD_NAME', pattern: /\b[A-Z][A-Za-z0-9]*Guard\b|\b가드\b/ },
  { ruleId: 'TECH_DTO_NAME', pattern: /\b[A-Z][A-Za-z0-9]*DTO\b|\b[A-Z][A-Za-z0-9]*Dto\b/ },
  { ruleId: 'TECH_REPOSITORY_NAME', pattern: /\bRepository\b|\b리포지토리\b/ },
  { ruleId: 'TECH_RAW_SQL', pattern: /\bSELECT\b.+\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\b.+\bSET\b/i },
  { ruleId: 'TECH_RAW_CRON', pattern: /\b(?:\*|\d+)\s+(?:\*|\d+)\s+(?:\*|\d+)\s+(?:\*|\d+)\s+(?:\*|\d+)\b/ },
]

export function validateBusinessLanguage(input: {
  documentType: BusinessDocumentType
  content: unknown
  allowlist?: string[]
}): BusinessLanguageValidationResult {
  const allowlist = new Set(input.allowlist ?? [])
  const issues: BusinessLanguageValidationIssue[] = []
  for (const { path, value } of collectStrings(input.content)) {
    if (isTechnicalMetadataPath(input.documentType, path)) continue
    for (const rule of contaminationRules) {
      const match = value.match(rule.pattern)
      if (!match?.[0]) continue
      if (allowlist.has(match[0])) continue
      issues.push({ ruleId: rule.ruleId, fieldPath: path, matchedText: match[0] })
    }
  }
  return { passed: issues.length === 0, issues }
}

export function validateLinkCoverage(input: {
  documentType: BusinessDocumentType
  coreItems: LinkCoverageCoreItem[]
  threshold?: number
}): LinkCoverageValidationResult {
  const threshold = input.threshold ?? 0.8
  const totalCoreItemCount = input.coreItems.length
  const linkedCoreItemCount = input.coreItems.filter((item) => item.linkedDocumentIds.length > 0).length
  const coverageRatio = totalCoreItemCount === 0 ? 1 : linkedCoreItemCount / totalCoreItemCount
  return {
    passed: totalCoreItemCount > 0 && linkedCoreItemCount > 0 && coverageRatio >= threshold,
    linkedCoreItemCount,
    totalCoreItemCount,
    coverageRatio,
    threshold,
  }
}

export function validateBusinessDocumentV3(input: {
  document: BusinessDocument
  documentId?: string
  systemSourceDocIds?: string[]
  linkCoverageThreshold?: number
}): BusinessDocumentValidationResult {
  const issues: BusinessDocumentValidationIssue[] = []
  const languageValidation = validateBusinessLanguage({
    documentType: input.document.type,
    content: input.document,
  })
  for (const issue of languageValidation.issues) {
    issues.push({
      code: 'BUSINESS_LANGUAGE_CONTAMINATION',
      severity: 'fatal',
      fieldPath: issue.fieldPath,
      message: `${issue.matchedText} (${issue.ruleId})`,
    })
  }

  issues.push(...requiredFieldIssues(input.document))
  issues.push(...emptyCoreItemIssues(input.document))

  const items = resolveBusinessDocumentItems(
    input.documentId ?? `validation:${input.document.type}:${input.document.scope}:${input.document.scope_id}`,
    input.document,
    input.systemSourceDocIds ?? [],
  )
  for (const key of duplicateStableKeys(documentStableKeys(input.document))) {
    issues.push({
      code: 'DUPLICATE_STABLE_KEY',
      severity: 'fatal',
      message: `Duplicate business document item key: ${key}`,
    })
  }

  if (items.length > 0 && (input.systemSourceDocIds?.length ?? 0) > 0) {
    const coverage = validateLinkCoverage({
      documentType: input.document.type,
      coreItems: items.map((item) => ({ itemId: item.id, linkedDocumentIds: item.sourceDocumentIds })),
      threshold: input.linkCoverageThreshold ?? 0.8,
    })
    if (!coverage.passed && input.document.evidence_gaps.length === 0) {
      issues.push({
        code: 'LINK_COVERAGE_BELOW_THRESHOLD',
        severity: 'fatal',
        message: `${coverage.linkedCoreItemCount}/${coverage.totalCoreItemCount} core items have system-derived source links.`,
      })
    }
  }

  return {
    passed: !issues.some((issue) => issue.severity === 'fatal'),
    issues,
  }
}

function documentStableKeys(document: BusinessDocument): string[] {
  if (document.type === 'br') {
    return document.rules
      .filter((rule) => typeof rule.statement === 'string' && rule.statement.trim().length > 0)
      .map((rule) => `br_rule:br:${rule.pattern ?? 'rule'}:${stableKeyPart(rule.statement)}`)
  }
  if (document.type === 'ucl') return document.use_cases.map((useCase) => `use_case:uc:${stableKeyPart(`${useCase.title}:${useCase.actor}:${useCase.goal}`)}`)
  if (document.type === 'data_dictionary') {
    return document.entities.flatMap((entity) => entity.fields.map((field) => `dd_field:field:${stableKeyPart(entity.name)}:${stableKeyPart(field.name)}`))
  }
  if (document.type === 'system_design') {
    return [
      ...document.flow_groups.map((group) => `sd_flow_group:flow:${stableKeyPart(group.name)}`),
      ...document.sequence_diagrams.map((diagram) => `sd_sequence:sequence:${stableKeyPart(diagram.title)}`),
      ...document.navigation_hints.map((hint) => `sd_navigation_hint:nav:${stableKeyPart(hint.label)}`),
    ]
  }
  if (document.type === 'glossary') return document.terms.map((term) => `glossary_term:term:${stableKeyPart(term.canonical_term ?? term.term)}`)
  return []
}

function requiredFieldIssues(document: BusinessDocument): BusinessDocumentValidationIssue[] {
  const issues: BusinessDocumentValidationIssue[] = []
  for (const [field, value] of [
    ['title', document.title],
    ['summary', document.summary],
    ['scope_id', document.scope_id],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      issues.push({
        code: 'MISSING_REQUIRED_FIELD',
        severity: 'fatal',
        fieldPath: field,
        message: `${field} is required.`,
      })
    }
  }
  if (document.type === 'system_design' && !document.overview.trim()) {
    issues.push({
      code: 'MISSING_REQUIRED_FIELD',
      severity: 'fatal',
      fieldPath: 'overview',
      message: 'overview is required.',
    })
  }
  if (document.type === 'br') {
    document.rules.forEach((rule, index) => {
      if (typeof rule.statement !== 'string' || rule.statement.trim().length === 0) {
        issues.push({
          code: 'MISSING_REQUIRED_FIELD',
          severity: 'fatal',
          fieldPath: `rules[${index}].statement`,
          message: 'rule statement is required.',
        })
      }
    })
  }
  return issues
}

function emptyCoreItemIssues(document: BusinessDocument): BusinessDocumentValidationIssue[] {
  if (document.evidence_gaps.length > 0) return []
  if (document.type === 'br' && document.rules.length === 0) return [emptyCoreItemIssue('rules')]
  if (document.type === 'ucl' && document.use_cases.length === 0) return [emptyCoreItemIssue('use_cases')]
  if (document.type === 'data_dictionary' && document.entities.length === 0) return [emptyCoreItemIssue('entities')]
  if (document.type === 'glossary' && document.terms.length === 0) return [emptyCoreItemIssue('terms')]
  if (document.type === 'system_design' && (document.flow_groups.length === 0 || document.navigation_hints.length === 0)) {
    return [emptyCoreItemIssue(document.flow_groups.length === 0 ? 'flow_groups' : 'navigation_hints')]
  }
  return []
}

function emptyCoreItemIssue(fieldPath: string): BusinessDocumentValidationIssue {
  return {
    code: 'EMPTY_CORE_ITEMS',
    severity: 'fatal',
    fieldPath,
    message: `${fieldPath} must include at least one item or explain the gap in evidence_gaps.`,
  }
}

function duplicateStableKeys(keys: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return [...duplicates].sort()
}

function collectStrings(value: unknown, path = '$'): Array<{ path: string; value: string }> {
  if (typeof value === 'string') return [{ path, value }]
  if (Array.isArray(value)) return value.flatMap((item, index) => collectStrings(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectStrings(child, `${path}.${key}`))
}

function isTechnicalMetadataPath(documentType: BusinessDocumentType, path: string): boolean {
  if (/\.(?:id|api_id|source_refs|source_doc_ids|method|path|column_name|table_name|type|code_term|code_value)$/.test(path)) return true
  if (documentType === 'data_dictionary' && /\.name$/.test(path)) return true
  return false
}
