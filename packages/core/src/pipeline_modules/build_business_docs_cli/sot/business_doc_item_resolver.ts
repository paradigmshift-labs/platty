import type { BusinessDocument } from './types.js'
import { contentHash, stableBusinessDocumentItemId, stableKeyPart } from './utils.js'

export type BusinessDocumentItemDraft = {
  itemType: string
  stableKey: string
  title: string
  summary: string | null
  content: Record<string, unknown>
  sourceDocumentIds: string[]
}

export type ResolvedBusinessDocumentItem = BusinessDocumentItemDraft & {
  id: string
  ordinal: number
  contentHash: string
}

export function resolveBusinessDocumentItems(documentId: string, document: BusinessDocument, fallbackSourceDocumentIds: string[] = []): ResolvedBusinessDocumentItem[] {
  return extractBusinessDocumentItems(document).map((item, ordinal) => {
    const sourceDocumentIds = [...new Set(fallbackSourceDocumentIds)].sort()
    const content = withProvenanceHash(item.content, sourceDocumentIds)
    return {
      ...item,
      sourceDocumentIds,
      id: stableBusinessDocumentItemId(documentId, item.itemType, item.stableKey),
      ordinal,
      content,
      contentHash: contentHash(content),
    }
  })
}

function withProvenanceHash(content: Record<string, unknown>, sourceDocumentIds: string[]): Record<string, unknown> {
  return {
    ...content,
    provenance_hash: contentHash({
      source_document_ids: sourceDocumentIds.slice().sort(),
    }),
  }
}

function extractBusinessDocumentItems(document: BusinessDocument): BusinessDocumentItemDraft[] {
  switch (document.type) {
    case 'br':
      return dedupeItems(document.rules
        .filter((rule) => typeof rule.statement === 'string' && rule.statement.trim().length > 0)
        .map((rule) => ({
          itemType: 'br_rule',
          stableKey: `br:${rule.pattern ?? 'rule'}:${stableKeyPart(rule.statement)}`,
          title: rule.statement,
          summary: rule.rationale ?? null,
          content: {
            statement: rule.statement,
            pattern: rule.pattern ?? null,
            rationale: rule.rationale ?? null,
            status: rule.status ?? null,
          },
          sourceDocumentIds: rule.source_refs ?? [],
        })))
    case 'ucl':
      return dedupeItems(document.use_cases.map((useCase) => ({
        itemType: 'use_case',
        stableKey: `uc:${stableKeyPart(`${useCase.title}:${useCase.actor}:${useCase.goal}`)}`,
        title: useCase.title,
        summary: useCase.goal,
        content: {
          actor: useCase.actor,
          goal: useCase.goal,
          trigger: useCase.trigger ?? null,
          business_event: useCase.business_event ?? null,
          priority: useCase.priority ?? null,
        },
        sourceDocumentIds: (useCase.coverage ?? []).map((coverage) => coverage.source_document_id),
      })))
    case 'data_dictionary':
      // Gap entities (gapType: missing_model_evidence) carry no fields; guard so
      // a fields-less entity does not crash the field projection.
      return dedupeItems(document.entities.flatMap((entity) => (entity.fields ?? []).map((field) => ({
        itemType: 'dd_field',
        stableKey: `field:${stableKeyPart(entity.name)}:${stableKeyPart(field.name)}`,
        title: `${entity.name}.${field.name}`,
        summary: field.description ?? null,
        content: {
          entity: entity.name,
          field: field.name,
          meaning: field.description ?? null,
          description_source: field.description_source ?? null,
        },
        sourceDocumentIds: [...(entity.source_refs ?? []), ...(field.source_refs ?? [])],
      }))))
    case 'system_design':
      return dedupeItems([
        ...document.flow_groups.map((group) => ({
          itemType: 'sd_flow_group',
          stableKey: `flow:${stableKeyPart(group.name)}`,
          title: group.name,
          summary: group.purpose,
          content: {
            purpose: group.purpose,
            steps: group.steps,
          },
          sourceDocumentIds: document.source_doc_ids ?? [],
        })),
        ...document.sequence_diagrams.map((diagram) => ({
          itemType: 'sd_sequence',
          stableKey: `sequence:${stableKeyPart(diagram.title)}`,
          title: diagram.title,
          summary: null,
          content: {
            mermaid: diagram.mermaid,
          },
          sourceDocumentIds: document.source_doc_ids ?? [],
        })),
        ...document.navigation_hints.map((hint) => ({
          itemType: 'sd_navigation_hint',
          stableKey: `nav:${stableKeyPart(hint.label)}`,
          title: hint.label,
          summary: hint.reason,
          content: {
            reason: hint.reason,
            go_to: hint.go_to,
          },
          sourceDocumentIds: document.source_doc_ids ?? [],
        })),
      ])
    case 'design':
      return dedupeItems(document.sequence_diagrams.map((diagram) => ({
        itemType: 'design_flow',
        stableKey: `flow:${stableKeyPart(diagram.title)}`,
        title: diagram.title,
        summary: diagram.uc_hint ?? null,
        content: {
          mermaid: diagram.mermaid,
          uc_hint: diagram.uc_hint ?? null,
        },
        sourceDocumentIds: document.source_doc_ids ?? [],
      })))
    case 'glossary':
      return dedupeItems(document.terms.map((term) => ({
        itemType: 'glossary_term',
        stableKey: `term:${stableKeyPart(term.canonical_term ?? term.term)}`,
        title: term.term,
        summary: term.definition,
        content: {
          canonical_term: term.canonical_term ?? null,
          definition: term.definition,
          aliases: term.aliases ?? [],
          synonyms: term.synonyms,
          candidate_aliases: term.candidate_aliases ?? [],
          antonyms: term.antonyms,
          contrast_terms: term.contrast_terms ?? [],
          related_terms: term.related_terms,
          signals: term.signals ?? [],
          code_term: term.code_term ?? null,
          trigger: term.trigger ?? null,
          caution: term.caution ?? null,
          ambiguity: term.ambiguity ?? null,
        },
        sourceDocumentIds: term.source_doc_ids,
      })))
    case 'ucs':
      return []
  }
}

function dedupeItems(items: BusinessDocumentItemDraft[]): BusinessDocumentItemDraft[] {
  const byIdentity = new Map<string, BusinessDocumentItemDraft>()
  for (const item of items) {
    const key = `${item.itemType}:${item.stableKey}`
    const existing = byIdentity.get(key)
    if (!existing) {
      byIdentity.set(key, {
        ...item,
        sourceDocumentIds: [...new Set(item.sourceDocumentIds)].sort(),
      })
      continue
    }
    existing.sourceDocumentIds = [...new Set([...existing.sourceDocumentIds, ...item.sourceDocumentIds])].sort()
  }
  return [...byIdentity.values()]
}
