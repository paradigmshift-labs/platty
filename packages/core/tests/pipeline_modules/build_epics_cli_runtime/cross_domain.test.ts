import { describe, expect, it } from 'vitest'
import type { EpicCrossDomainLink, ReviewableEpic } from '@/pipeline_modules/build_epics_core/types.js'
import { validateCrossDomainSubmission } from '@/pipeline_modules/build_epics_cli_runtime/cross_domain.js'
import type { BuildEpicsDocumentCard } from '@/pipeline_modules/build_epics_cli_runtime/types.js'

describe('validateCrossDomainSubmission', () => {
  it('does not block missing keyword-derived expected cross-links', () => {
    const card = makeCard({
      documentId: 'api:completion',
      title: 'Complete task reward',
      summary: 'Grants points after completion.',
    })
    const ownerEpic = makeEpic({ tempEpicId: 'epic:completion', stableKey: 'completion', name: 'Completion' })
    const rewardEpic = makeEpic({
      tempEpicId: 'epic:reward',
      stableKey: 'reward',
      name: 'Reward',
      summary: 'Reward points and coupon benefits.',
    })

    const errors = validateCrossDomainSubmission({
      cards: [card],
      epics: [ownerEpic, rewardEpic],
      ownerByDocumentId: new Map([[card.documentId, ownerEpic.tempEpicId]]),
      submission: { links: [] },
      maxCrossLinksPerDocument: 3,
    })

    expect(errors).toEqual([])
  })

  it('accepts a valid non-owner cross-link', () => {
    const card = makeCard({ documentId: 'api:completion' })
    const ownerEpic = makeEpic({ tempEpicId: 'epic:completion', stableKey: 'completion', name: 'Completion' })
    const rewardEpic = makeEpic({ tempEpicId: 'epic:reward', stableKey: 'reward', name: 'Reward' })

    const errors = validateCrossDomainSubmission({
      cards: [card],
      epics: [ownerEpic, rewardEpic],
      ownerByDocumentId: new Map([[card.documentId, ownerEpic.tempEpicId]]),
      submission: { links: [makeLink({ sourceDocumentId: card.documentId, targetTempEpicId: rewardEpic.tempEpicId })] },
      maxCrossLinksPerDocument: 3,
    })

    expect(errors).toEqual([])
  })

  it('rejects unknown cross-link sources and targets', () => {
    const card = makeCard({ documentId: 'api:completion' })
    const ownerEpic = makeEpic({ tempEpicId: 'epic:completion', stableKey: 'completion', name: 'Completion' })

    const errors = validateCrossDomainSubmission({
      cards: [card],
      epics: [ownerEpic],
      ownerByDocumentId: new Map([[card.documentId, ownerEpic.tempEpicId]]),
      submission: {
        links: [
          makeLink({ sourceDocumentId: 'api:missing', targetTempEpicId: ownerEpic.tempEpicId }),
          makeLink({ sourceDocumentId: card.documentId, targetTempEpicId: 'epic:missing' }),
        ],
      },
      maxCrossLinksPerDocument: 3,
    })

    expect(errors).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_CROSS_LINK_SOURCE', documentId: 'api:missing' }),
      expect.objectContaining({ code: 'UNKNOWN_CROSS_LINK_TARGET', documentId: card.documentId, tempEpicId: 'epic:missing' }),
    ])
  })

  it('rejects self cross-links to the owner EPIC', () => {
    const card = makeCard({ documentId: 'api:completion' })
    const ownerEpic = makeEpic({ tempEpicId: 'epic:completion', stableKey: 'completion', name: 'Completion' })

    const errors = validateCrossDomainSubmission({
      cards: [card],
      epics: [ownerEpic],
      ownerByDocumentId: new Map([[card.documentId, ownerEpic.tempEpicId]]),
      submission: { links: [makeLink({ sourceDocumentId: card.documentId, targetTempEpicId: ownerEpic.tempEpicId })] },
      maxCrossLinksPerDocument: 3,
    })

    expect(errors).toEqual([expect.objectContaining({
      code: 'SELF_CROSS_LINK',
      documentId: card.documentId,
      tempEpicId: ownerEpic.tempEpicId,
    })])
  })

  it('rejects submitted links over the per-document cap', () => {
    const card = makeCard({ documentId: 'api:completion' })
    const ownerEpic = makeEpic({ tempEpicId: 'epic:completion', stableKey: 'completion', name: 'Completion' })
    const targetEpics = [
      makeEpic({ tempEpicId: 'epic:a', stableKey: 'a', name: 'A' }),
      makeEpic({ tempEpicId: 'epic:b', stableKey: 'b', name: 'B' }),
      makeEpic({ tempEpicId: 'epic:c', stableKey: 'c', name: 'C' }),
    ]

    const errors = validateCrossDomainSubmission({
      cards: [card],
      epics: [ownerEpic, ...targetEpics],
      ownerByDocumentId: new Map([[card.documentId, ownerEpic.tempEpicId]]),
      submission: { links: targetEpics.map((epic) => makeLink({ sourceDocumentId: card.documentId, targetTempEpicId: epic.tempEpicId })) },
      maxCrossLinksPerDocument: 2,
    })

    expect(errors).toEqual([expect.objectContaining({
      code: 'MAX_CROSS_LINKS_EXCEEDED',
      documentId: card.documentId,
    })])
  })
})

function makeCard(overrides: Partial<BuildEpicsDocumentCard> = {}): BuildEpicsDocumentCard {
  return {
    documentId: 'api:test',
    type: 'api_spec',
    title: 'Test API',
    summary: 'Test summary.',
    path: '/test',
    actorHints: [],
    domainHints: [],
    relationHints: [],
    ...overrides,
  }
}

function makeEpic(overrides: Partial<ReviewableEpic> = {}): ReviewableEpic {
  return {
    tempEpicId: 'epic:test',
    stableKey: 'test',
    name: 'Test',
    abbr: 'TST',
    summary: 'Test epic.',
    status: 'reviewable',
    confidence: 'high',
    apiLinks: [],
    screenLinks: [],
    eventLinks: [],
    scheduleLinks: [],
    crossLinks: [],
    dependencies: [],
    sourceCandidateKeys: [],
    ...overrides,
  }
}

function makeLink(overrides: Partial<EpicCrossDomainLink> = {}): EpicCrossDomainLink {
  return {
    sourceDocumentId: 'api:test',
    targetTempEpicId: 'epic:target',
    kind: 'reward_or_coupon_effect',
    role: 'impact',
    confidence: 'high',
    reason: 'Document has a real cross-EPIC reward effect.',
    ...overrides,
  }
}
