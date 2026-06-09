import { describe, expect, it } from 'vitest'
import { validateAssignmentSubmission } from '@/pipeline_modules/build_epics/runtime/assignment_validation.js'
import type { BuildEpicsDocumentCard } from '@/pipeline_modules/build_epics/runtime/types.js'

const cards: BuildEpicsDocumentCard[] = [
  { documentId: 'api:1', type: 'api_spec', title: 'Create order', summary: 'Creates an order', actorHints: [], domainHints: [], relationHints: [] },
  { documentId: 'api:2', type: 'api_spec', title: 'Pay order', summary: 'Pays an order', actorHints: [], domainHints: [], relationHints: [] },
  { documentId: 'screen:1', type: 'screen_spec', title: 'Order screen', summary: 'Order screen', actorHints: [], domainHints: [], relationHints: [] },
]

describe('assignment validation quality gates', () => {
  it('requests repair when too many assignments are review-only', () => {
    const errors = validateAssignmentSubmission({
      cards,
      epics: [{ stableKey: 'commerce_order' }],
      submission: {
        assignments: [
          { documentId: 'api:1', epicKey: 'commerce_order', role: 'review', confidence: 'low', reason: 'unclear enough' },
          { documentId: 'api:2', epicKey: 'commerce_order', role: 'review', confidence: 'low', reason: 'unclear enough' },
          { documentId: 'screen:1', epicKey: 'commerce_order', role: 'review', confidence: 'low', reason: 'unclear enough' },
        ],
      },
    })

    expect(errors.map((error) => error.code)).toContain('ASSIGNMENT_REVIEW_COLLAPSE')
  })

  it('counts structurally invalid review assignments toward review collapse', () => {
    const errors = validateAssignmentSubmission({
      cards: [cards[0]!, cards[2]!],
      epics: [{ stableKey: 'commerce_order' }],
      submission: {
        assignments: [
          { documentId: 'missing:1', epicKey: 'commerce_order', role: 'review', confidence: 'low', reason: 'unclear enough' },
          { documentId: 'screen:1', epicKey: 'commerce_order', role: 'review', confidence: 'low', reason: 'unclear enough' },
          { documentId: 'api:1', epicKey: 'commerce_order', role: 'owner', confidence: 'high', reason: 'clear owner' },
        ],
      },
    })

    const codes = errors.map((error) => error.code)
    expect(codes).toContain('UNKNOWN_ASSIGNMENT_DOCUMENT')
    expect(codes).toContain('ASSIGNMENT_REVIEW_COLLAPSE')
  })

  it('requests repair when owner assignment reason is empty', () => {
    const errors = validateAssignmentSubmission({
      cards: [cards[0]!],
      epics: [{ stableKey: 'commerce_order' }],
      submission: {
        assignments: [{ documentId: 'api:1', epicKey: 'commerce_order', role: 'owner', confidence: 'high', reason: '' }],
      },
    })

    expect(errors.map((error) => error.code)).toContain('ASSIGNMENT_REASON_REQUIRED')
  })
})
