import { describe, expect, it } from 'vitest'
import { buildStaticDocumentEnvelope, extractRoutePathParams } from '@/pipeline_modules/build_docs/source/static_envelope.js'
import type { BuildDocsGenerationContextResponse } from '@/pipeline_modules/build_docs/runtime/types.js'

describe('extractRoutePathParams', () => {
  it('extracts express params including modifiers', () => {
    expect(extractRoutePathParams('/orders/:orderNumber/confirm/:path*')).toEqual(['orderNumber', 'path'])
  })

  it('extracts mixed brace and express params in first-seen order', () => {
    expect(extractRoutePathParams('/users/{userId}/posts/:postId')).toEqual(['userId', 'postId'])
  })

  it('preserves first-seen unique order for mixed duplicate syntax', () => {
    expect(extractRoutePathParams('/{id}/:other/:id')).toEqual(['id', 'other'])
  })
})

describe('buildStaticDocumentEnvelope', () => {
  it('injects deterministic API identity, relations, evidence refs, and resolved source links', () => {
    const context = buildApiContext({
      manifestEvidenceIds: ['ev:manifest:first', 'ev:controller', 'ev:response', 'ev:relation'],
    })
    const draft = {
      source_link_selection: {
        access: ['source_link_candidate:001'],
        input: ['source_link_candidate:002'],
        response: ['source_link_candidate:003'],
      },
    }

    const envelope = buildStaticDocumentEnvelope(context, draft)

    expect(envelope).toEqual({
      id: 'doc:api:get-order',
      type: 'api_spec',
      identity: {
        method: 'GET',
        path: '/orders/:orderId',
        handler: 'OrderController.getOrder',
        file_path: 'src/orders/order.controller.ts',
      },
      relations: {
        tables: [{ table: 'Order', operation: 'select' }],
        external_calls: [],
        events: [],
        api_calls: [],
        navigation: [],
        external_links: [],
        related_apis: [],
      },
      evidence_refs: ['ev:manifest:first', 'ev:controller', 'ev:response', 'ev:relation'],
      relation_evidence_checked: true,
      source_links: {
        access: ['node:controller:getOrder'],
        input: ['node:dto:OrderQueryDto'],
        response: ['node:dto:OrderResponse'],
      },
    })
    expect(envelope).not.toHaveProperty('access')
    expect(envelope).not.toHaveProperty('input')
    expect(envelope).not.toHaveProperty('response')
    expect(envelope).not.toHaveProperty('contracts')
  })

  it('uses empty source links when API draft selects an unknown candidate', () => {
    const context = buildApiContext({
      sourceLinkCandidates: [],
    })
    const envelope = buildStaticDocumentEnvelope(context, {
      source_link_selection: {
        input: ['source_link_candidate:999'],
      },
    })

    expect(envelope.source_links).toEqual({
      access: [],
      input: [],
      response: [],
    })
  })

  it('uses empty source links when API draft selection has malformed entries', () => {
    const context = buildApiContext()
    const envelope = buildStaticDocumentEnvelope(context, {
      source_link_selection: {
        input: [123, 'source_link_candidate:002'],
      },
    })

    expect(envelope.source_links).toEqual({
      access: [],
      input: [],
      response: [],
    })
  })
})

function buildApiContext(input?: {
  manifestEvidenceIds?: string[]
  sourceLinkCandidates?: BuildDocsGenerationContextResponse['content']['source_link_candidates']
  entryPointIds?: string[]
}): BuildDocsGenerationContextResponse {
  return {
    metadata: {
      run_id: 'run:1',
      task_id: 'task:1',
      schema_version: 'build_docs_cli_generation_v1',
      source_commit: 'commit:1',
      generated_at: '2026-06-05T00:00:00.000Z',
      evidence_id_namespace: 'evidence:ns',
    },
    manifest: {
      context_handle: 'ctx:1',
      task_id: 'task:1',
      schema_version: 'build_docs_cli_generation_v1',
      required_pages: ['target', 'source_context'],
      optional_pages: ['code_relation_facts', 'service_map_facts'],
      evidence_ids: input?.manifestEvidenceIds ?? ['ev:manifest:first', 'ev:controller', 'ev:response', 'ev:relation'],
    },
    content: {
      target: {
        document_id: 'doc:api:get-order',
        document_type: 'api_spec',
        target_key: 'GET /orders/:orderId',
        primary_entry_point_id: 'node:controller:getOrder',
        seed_node_ids: ['node:controller:getOrder'],
        entry_point_ids: input?.entryPointIds ?? ['node:controller:getOrder'],
        repository_id: 'repo:1',
        method: 'GET',
        path: '/orders/:orderId',
        handler: 'OrderController.getOrder',
        file_path: 'src/orders/order.controller.ts',
        framework_hint: 'nestjs',
      },
      source_context: [],
      source_link_candidates: input?.sourceLinkCandidates ?? [
        {
          candidate_id: 'source_link_candidate:001',
          node_id: 'node:controller:getOrder',
          symbol: 'OrderController.getOrder',
          node_type: 'method',
          file_path: 'src/orders/order.controller.ts',
          line_start: 10,
          line_end: 18,
          evidence_id: 'ev:controller',
          role_hints: ['entrypoint', 'response'],
        },
        {
          candidate_id: 'source_link_candidate:002',
          node_id: 'node:dto:OrderQueryDto',
          symbol: 'OrderQueryDto',
          node_type: 'class',
          file_path: 'src/orders/order-query.dto.ts',
          line_start: 1,
          line_end: 5,
          evidence_id: 'ev:query',
          role_hints: ['input', 'type-definition'],
        },
        {
          candidate_id: 'source_link_candidate:003',
          node_id: 'node:dto:OrderResponse',
          symbol: 'OrderResponseDto',
          node_type: 'class',
          file_path: 'src/orders/order-response.dto.ts',
          line_start: 1,
          line_end: 8,
          evidence_id: 'ev:response',
          role_hints: ['response', 'type-definition'],
        },
      ],
      code_relation_facts: [
        {
          evidence_id: 'ev:relation',
          relation_id: 'rel:1',
          repo_id: 'repo:1',
          source_node_id: 'node:controller:getOrder',
          kind: 'db_access',
          target: 'Order',
          canonical_target: 'db:Order:select',
          operation: 'select',
          confidence: 'high',
          source: 'deterministic',
          evidence_node_ids: ['node:repository:findOrder'],
          payload: { table: 'Order', operation: 'select' },
          unresolved_reason: null,
        },
      ],
      service_map_facts: [],
      related_edges: [],
      schema: {
        schema_name: 'api_spec',
        schema_version: '1',
        llm_output_shape: {},
        system_injected_fields: [],
        required_fields: [],
        output_rules: [],
        quality_rules: [],
      },
      rules: [],
      evidence_gaps: [],
      evidence_reference_rules: {
        allowed_evidence_ids: ['ev:manifest:first', 'ev:controller', 'ev:response', 'ev:relation'],
        required: true,
      },
      source_excerpts: [],
      relation_facts: [],
    },
  }
}
