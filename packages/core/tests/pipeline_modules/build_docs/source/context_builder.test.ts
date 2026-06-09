import { describe, expect, it } from 'vitest'
import type { BuildDocsGenerationContextResponse } from '@/pipeline_modules/build_docs/runtime/types.js'
import { createViennaChainFixture, getApiContext, leaseApiTask } from '../helpers.js'

describe('build docs SQL source context closure', () => {
  it('includes the controller to response Vienna chain from SQL graph facts', async () => {
    const fixture = createViennaChainFixture()
    try {
      const context = await getApiContext(fixture.runtime)

      expect(sourceSymbols(context)).toEqual(expect.arrayContaining([
        'OrderController.getOrder',
        'OrderService.getOrder',
        'OrderRepository.findById',
        'mapOrderResponse',
        'okResponse',
        'OrderRequestDto',
        'OrderResponseDto',
        'selectFields',
      ]))
      expect(context.content.source_context.every((source) => source.source_excerpt.trim().length > 0)).toBe(true)
    } finally {
      fixture.cleanup()
    }
  })

  it('includes source-backed DTO, body, response, mapper, and return object evidence', async () => {
    const fixture = createViennaChainFixture()
    try {
      const context = await getApiContext(fixture.runtime)
      const source = joinedSource(context)

      expect(source).toContain('class OrderRequestDto')
      expect(source).toContain('orderId')
      expect(source).toContain('includeItems')
      expect(source).toContain('class OrderResponseDto')
      expect(source).toContain('status')
      expect(source).toContain('total')
      expect(source).toContain('return { id, status, total }')
    } finally {
      fixture.cleanup()
    }
  })

  it('returns stable evidence and source ordering for repeated context reads', async () => {
    const fixture = createViennaChainFixture()
    try {
      const task = await leaseApiTask(fixture.runtime)

      const first = await fixture.runtime.getContext({
        taskId: task.task_id,
        leaseToken: task.lease_token,
      })
      const second = await fixture.runtime.getContext({
        taskId: task.task_id,
        leaseToken: task.lease_token,
      })

      expect(first.manifest.evidence_ids).toEqual(second.manifest.evidence_ids)
      expect(first.content.source_context.map((item) => item.node_id))
        .toEqual(second.content.source_context.map((item) => item.node_id))
    } finally {
      fixture.cleanup()
    }
  })
})

function sourceSymbols(context: BuildDocsGenerationContextResponse): string[] {
  return context.content.source_context.map((source) => source.symbol)
}

function joinedSource(context: BuildDocsGenerationContextResponse): string {
  return context.content.source_context.map((source) => source.source_excerpt).join('\n')
}
