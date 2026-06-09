import { describe, expect, it } from 'vitest'
import type { BusinessDocContextPage } from '../../../src/db/schema/build_business_docs_generation.js'
import { validateBusinessDocumentSotQuality } from '../../../src/pipeline_modules/build_business_docs_cli/quality.js'
import type {
  BusinessDocsStoredDocumentType,
  BusinessDocsSubmittedDocumentItem,
  BusinessDocsValidationError,
} from '../../../src/pipeline_modules/build_business_docs_cli/types.js'

describe('build_business_docs_cli SOT quality validation', () => {
  it('rejects JSON schema fragments inside evidence gaps', () => {
    const errors = validate('ucs', [
      item('use_case', 'uc:detail-engagement', {
        actor: 'User',
        trigger: 'User opens a detail page.',
        preconditions: ['The detail page is available.'],
        main_success_flow: ['User reads the detail.', 'User reacts to the content.'],
        alternatives: [],
        exceptions: [],
        business_rules: ['Only supported actions are available.'],
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
      }),
    ], {
      evidence_gaps: ['use_cases":[{'],
    })

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'DOCUMENT_QUALITY_INSUFFICIENT',
      path: '$.content.evidence_gaps',
    }))
  })

  it('rejects business rules without EARS pattern and ownership', () => {
    const errors = validate('br', [
      item('business_rule', 'rule:missing-ears', {
        condition: 'When an order is submitted',
        rule: 'the system shall validate the order',
        outcome: 'invalid orders are rejected',
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
      }),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'BR_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects design items without relation confidence', () => {
    const errors = validate('design', [
      item('design_component', 'design:orders', {
        component: 'Orders',
        responsibility: 'Coordinate order submission.',
        flow: ['receive request'],
        integration_points: ['source_document_1'],
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
      }),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'DESIGN_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects duplicated glossary terms after normalization', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:order', {
        term: 'Order',
        definition: 'A submitted commerce request.',
        termType: 'domain',
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
      }),
      item('glossary_term', 'term:order-copy', {
        term: ' order ',
        definition: 'A duplicated commerce order term.',
        termType: 'domain',
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
      }),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })

  it('accepts glossary registry terms with canonical aliases signals and ambiguity metadata', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', {
        term: '쇼핑일기',
        canonical_term: '쇼핑일기',
        definition: 'A user-authored post created from a purchased store item.',
        termType: 'domain',
        aliases: ['구매일기', '쇼핑후기'],
        synonyms: ['shopping diary'],
        candidate_aliases: ['후기 있는 다이어리'],
        antonyms: [],
        contrast_terms: [],
        related_terms: ['상품 리뷰'],
        signals: ['orderGoodStockId', '반려', '이미지', '리워드'],
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'Defines the user flow.' }],
        ambiguity: {
          status: 'none',
          candidates: [],
        },
      }),
    ])

    expect(errors).toEqual([])
  })

  it('accepts data dictionary field source mappings without item evidence ids', () => {
    const errors = validate('data_dictionary', [
      {
        itemType: 'data_entity',
        stableKey: 'dd:order',
        ordinal: 1,
        title: 'Order',
        summary: 'Order model.',
        content: {
          entity: 'Order',
          fields: [
            {
              name: 'id',
              type: 'String',
              meaning: 'Order id.',
              source_mapping: ['source_document_1'],
            },
          ],
        },
      },
    ])

    expect(errors).toEqual([])
  })

  it('rejects glossary alias collisions across canonical terms', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', {
        term: '쇼핑일기',
        canonical_term: '쇼핑일기',
        definition: 'A store purchase diary.',
        termType: 'domain',
        aliases: ['후기'],
        synonyms: [],
        candidate_aliases: [],
        antonyms: [],
        contrast_terms: [],
        related_terms: [],
        signals: ['orderGoodStockId'],
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
        ambiguity: { status: 'none', candidates: [] },
      }),
      item('glossary_term', 'term:product-review', {
        term: '상품 리뷰',
        canonical_term: '상품 리뷰',
        definition: 'A review for a product.',
        termType: 'domain',
        aliases: ['후기'],
        synonyms: [],
        candidate_aliases: [],
        antonyms: [],
        contrast_terms: [],
        related_terms: [],
        signals: ['rating'],
        source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
        ambiguity: { status: 'ambiguous', candidates: [{ meaning: 'Could mean shopping diary or product review.', epic_ids: [], source_doc_ids: ['doc:orders-api'] }] },
      }),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_ALIAS_COLLISION',
    }))
  })

  it('rejects glossary synonym collisions across canonical terms', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', glossaryContent({
        term: '쇼핑일기',
        canonical_term: '쇼핑일기',
        synonyms: ['후기'],
      })),
      item('glossary_term', 'term:product-review', glossaryContent({
        term: '상품 리뷰',
        canonical_term: '상품 리뷰',
        synonyms: ['후기'],
      })),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_ALIAS_COLLISION',
    }))
  })

  it.each([
    ['alias', { aliases: ['Refund'] }],
    ['synonym', { synonyms: ['Refund'] }],
  ])('rejects glossary %s collisions with another canonical term', (_label, collisionFields) => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:return-request', glossaryContent({
        term: 'Return Request',
        canonical_term: 'Return Request',
        ...collisionFields,
      })),
      item('glossary_term', 'term:refund', glossaryContent({
        term: 'Refund',
        canonical_term: 'Refund',
      })),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_ALIAS_COLLISION',
    }))
  })

  it('rejects ambiguous glossary terms without candidates', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:review', glossaryContent({
        term: '후기',
        canonical_term: '후기',
        ambiguity: { status: 'ambiguous', candidates: [] },
      })),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects glossary terms missing required registry arrays', () => {
    const content = glossaryContent({
      term: '쇼핑일기',
      canonical_term: '쇼핑일기',
    })
    delete content.signals

    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', content),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects glossary terms missing canonical_term', () => {
    const content = glossaryContent({
      term: '쇼핑일기',
    })
    delete content.canonical_term

    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', content),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects glossary candidate alias collisions across canonical terms', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', glossaryContent({
        term: '쇼핑일기',
        canonical_term: '쇼핑일기',
        candidate_aliases: ['후기 있는 다이어리'],
      })),
      item('glossary_term', 'term:product-review', glossaryContent({
        term: '상품 리뷰',
        canonical_term: '상품 리뷰',
        candidate_aliases: ['후기 있는 다이어리'],
      })),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_ALIAS_COLLISION',
    }))
  })

  it('allows glossary search signals to be shared across canonical terms', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:kakao-login', glossaryContent({
        term: '카카오 로그인 연계',
        canonical_term: '카카오 로그인 연계',
        signals: ['카카오', '로그인'],
      })),
      item('glossary_term', 'term:kakao-code', glossaryContent({
        term: '카카오 인가 코드',
        canonical_term: '카카오 인가 코드',
        signals: ['카카오', '토큰 교환'],
      })),
    ])

    expect(errors).not.toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_ALIAS_COLLISION',
    }))
  })

  it('allows related_terms to point at another canonical term without alias collision', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', glossaryContent({
        term: '쇼핑일기',
        canonical_term: '쇼핑일기',
        related_terms: ['상품 리뷰'],
        signals: ['shoppingDiarySignal'],
      })),
      item('glossary_term', 'term:product-review', glossaryContent({
        term: '상품 리뷰',
        canonical_term: '상품 리뷰',
        signals: ['productReviewSignal'],
      })),
    ])

    expect(errors).not.toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_ALIAS_COLLISION',
    }))
  })

  it.each(['candidate_aliases', 'antonyms'])('rejects glossary terms missing %s', (field) => {
    const content = glossaryContent({
      term: '쇼핑일기',
      canonical_term: '쇼핑일기',
    })
    delete content[field]

    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', content),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects glossary terms missing ambiguity metadata', () => {
    const content = glossaryContent({
      term: '쇼핑일기',
      canonical_term: '쇼핑일기',
    })
    delete content.ambiguity

    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', content),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects glossary terms with unknown ambiguity status', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:shopping-diary', glossaryContent({
        term: '쇼핑일기',
        canonical_term: '쇼핑일기',
        ambiguity: { status: 'pending', candidates: [] },
      })),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })

  it('rejects ambiguous glossary terms with malformed candidates', () => {
    const errors = validate('glossary', [
      item('glossary_term', 'term:review', glossaryContent({
        term: '후기',
        canonical_term: '후기',
        ambiguity: { status: 'ambiguous', candidates: [{ meaning: '', epic_ids: [], source_doc_ids: [] }] },
      })),
    ])

    expect(errors).toContainEqual(expect.objectContaining({
      code: 'GLOSSARY_QUALITY_INSUFFICIENT',
    }))
  })
})

function validate(
  documentType: BusinessDocsStoredDocumentType,
  items: BusinessDocsSubmittedDocumentItem[],
  content: Record<string, unknown> = { evidence_gaps: [] },
): BusinessDocsValidationError[] {
  const errors: BusinessDocsValidationError[] = []
  validateBusinessDocumentSotQuality({
    documentType,
    content,
    items,
    pages: sourcePages(),
    errors,
  })
  return errors
}

function item(
  itemType: string,
  stableKey: string,
  content: Record<string, unknown>,
): BusinessDocsSubmittedDocumentItem {
  return {
    itemType,
    stableKey,
    ordinal: 1,
    title: stableKey,
    summary: `${stableKey} summary`,
    content,
    evidenceIds: ['evidence:source_document_1'],
  }
}

function glossaryContent(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    term: '쇼핑일기',
    canonical_term: '쇼핑일기',
    definition: 'A user-authored post created from a purchased store item.',
    termType: 'domain',
    aliases: [],
    synonyms: [],
    candidate_aliases: [],
    antonyms: [],
    contrast_terms: [],
    related_terms: [],
    signals: ['orderGoodStockId'],
    source_mapping: [{ sourceRef: 'source_document_1', role: 'primary', reason: 'source' }],
    ambiguity: { status: 'none', candidates: [] },
    ...overrides,
  }
}

function sourcePages(): BusinessDocContextPage[] {
  return [
    {
      contextHandle: 'ctx:test',
      pageToken: 'source_document_cards',
      pageKind: 'source_document_cards',
      pageOrder: 1,
      summary: 'Source document cards',
      evidenceIdsJson: ['evidence:source_document_1'],
      contentJson: {
        cards: [
          {
            evidenceId: 'evidence:source_document_1',
            sourceRef: 'source_document_1',
            documentId: 'doc:orders-api',
            epicLink: { role: 'primary' },
          },
        ],
      },
      contentHash: 'hash:source',
      createdAt: '2026-06-07T00:00:00.000Z',
    },
  ]
}
