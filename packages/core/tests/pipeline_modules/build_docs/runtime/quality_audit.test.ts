import { describe, expect, it } from 'vitest'
import { auditDraftQuality } from '@/pipeline_modules/build_docs/runtime/quality_audit.js'
import { createViennaChainFixture, getApiContext } from '../helpers.js'

describe('build docs deterministic quality audit', () => {
  it('accepts a narrative-only API draft without static input or response fields', async () => {
    const fixture = createViennaChainFixture()
    try {
      const context = await getApiContext(fixture.runtime)
      const errors = auditDraftQuality({
        document: narrativeOnlyApiDraft(),
        context,
      })

      expect(errors).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects generic flow when source or relation behavior exists', async () => {
    const fixture = createViennaChainFixture()
    try {
      const context = await getApiContext(fixture.runtime)
      const errors = auditDraftQuality({
        document: {
          ...narrativeOnlyApiDraft(),
          flow: [
            'Handles GET /api/orders/:orderId.',
            'Calls the handler.',
            'Returns a response.',
          ],
        },
        context,
      })

      expect(errors).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'GENERIC_FLOW',
          path: '$.flow',
          message: expect.stringMatching(/orders|OrderRepository\.findById/),
        }),
      ]))
    } finally {
      fixture.cleanup()
    }
  })

})

function narrativeOnlyApiDraft(): Record<string, unknown> {
  return {
    title: 'Order detail API',
    summary: 'Reads orders through OrderRepository.findById and returns a source-backed detail.',
    flow: [
      'OrderController.getOrder reads orderId and includeItems.',
      'OrderRepository.findById selects orders and mapOrderResponse builds OrderResponseDto.',
    ],
    rules: ['orderId selects the orders record.'],
  }
}
