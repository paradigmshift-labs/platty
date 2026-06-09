import { describe, expect, it } from 'vitest'
import { mergeSystemDocument } from '@/pipeline_modules/build_docs/source/system_merge.js'
import type { BuildDocsGenerationContextResponse } from '@/pipeline_modules/build_docs/runtime/types.js'

describe('mergeSystemDocument', () => {
  it('merges API narrative drafts with the static envelope and ignores draft overrides for system-owned fields', () => {
    const context = buildApiContext()
    const merged = mergeSystemDocument({
      context,
      draft: {
        title: 'Order detail API',
        summary: 'Returns a source-backed order detail.',
        access: 'Login required: OrderController guard requires an authenticated user.',
        flow: ['OrderController.getOrder calls OrderRepository.findById and returns an order.'],
        rules: ['orderId selects the order record.'],
        source_link_selection: {
          access: ['source_link_candidate:001'],
          input: ['source_link_candidate:002'],
          response: ['source_link_candidate:003'],
        },
        source_links: { input: ['node:invented'] },
        id: 'llm:wrong-id',
        type: 'screen_spec',
        identity: { method: 'POST', path: '/wrong' },
        relations: { tables: [{ table: 'Wrong', operation: 'insert' }] },
        evidence_refs: ['llm:fake'],
        relation_evidence_checked: false,
      },
    })

    expect(merged).toMatchObject({
      title: 'Order detail API',
      summary: 'Returns a source-backed order detail.',
      access: 'Login required: OrderController guard requires an authenticated user.',
      flow: ['OrderController.getOrder calls OrderRepository.findById and returns an order.'],
      rules: ['orderId selects the order record.'],
      source_links: {
        access: ['node:controller:getOrder'],
        input: ['node:dto:OrderQueryDto'],
        response: ['node:dto:OrderResponse'],
      },
      id: 'doc:api:get-order',
      type: 'api_spec',
      identity: expect.objectContaining({
        method: 'GET',
        path: '/orders/:orderId',
      }),
      relations: {
        tables: [{ table: 'Order', operation: 'select' }],
        external_calls: [],
        events: [],
        api_calls: [],
        navigation: [],
        external_links: [],
        related_apis: [],
      },
      evidence_refs: ['ev:manifest:first', 'ev:controller', 'ev:query', 'ev:body', 'ev:response', 'ev:relation'],
      relation_evidence_checked: true,
    })
    expect(merged).not.toHaveProperty('source_link_selection')
    expect(merged).not.toHaveProperty('input')
    expect(merged).not.toHaveProperty('response')
    expect(merged).not.toHaveProperty('contracts')
  })

  it('injects contracts for non-API docs without disturbing narrative draft fields', () => {
    const context = buildScreenContext()
    const merged = mergeSystemDocument({
      context,
      draft: {
        title: 'Orders screen',
        summary: 'Shows the order list.',
        ascii_ui: '[OrdersTable]',
        layout: [{ name: 'results', type: 'table', fields: ['status'] }],
        state: [{ name: 'filters', source: 'route_param' }],
        actions: [{ name: 'open order', trigger: 'click row', result: 'navigate to detail' }],
        flow: ['OrdersPage loads filters before rendering the table.'],
        rules: ['Users only see orders they can access.'],
      },
    })

    expect(merged).toMatchObject({
      title: 'Orders screen',
      summary: 'Shows the order list.',
      ascii_ui: '[OrdersTable]',
      layout: [{ name: 'results', type: 'table', fields: ['status'] }],
      state: [{ name: 'filters', source: 'route_param' }],
      actions: [{ name: 'open order', trigger: 'click row', result: 'navigate to detail' }],
      flow: ['OrdersPage loads filters before rendering the table.'],
      rules: ['Users only see orders they can access.'],
      id: 'doc:screen:orders',
      type: 'screen_spec',
      identity: {
        route_path: '/orders',
        screen_name: 'OrdersPage',
        component: 'OrdersPage',
        file_path: 'web/src/pages/orders.tsx',
        router: 'react-router',
      },
      relations: {
        tables: [],
        external_calls: [],
        events: [],
        api_calls: [],
        navigation: [{ target_path: '/orders/:orderId' }],
        external_links: [],
        related_apis: [],
      },
      evidence_refs: ['ev:screen:manifest', 'ev:screen:component', 'ev:screen:nav'],
      relation_evidence_checked: true,
      contracts: {},
    })
  })
})

function buildApiContext(): BuildDocsGenerationContextResponse {
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
      evidence_ids: ['ev:manifest:first', 'ev:controller', 'ev:query', 'ev:body', 'ev:response', 'ev:relation'],
    },
    content: {
      target: {
        document_id: 'doc:api:get-order',
        document_type: 'api_spec',
        target_key: 'GET /orders/:orderId',
        primary_entry_point_id: 'node:controller:getOrder',
        seed_node_ids: ['node:controller:getOrder'],
        entry_point_ids: ['node:controller:getOrder'],
        repository_id: 'repo:1',
        method: 'GET',
        path: '/orders/:orderId',
        handler: 'OrderController.getOrder',
        file_path: 'src/orders/order.controller.ts',
        framework_hint: 'nestjs',
      },
      source_context: [
        sourceContext({
          evidence_id: 'ev:controller',
          node_id: 'node:controller:getOrder',
          node_type: 'method',
          dep_type: 'entrypoint',
          hop: 0,
          file_path: 'src/orders/order.controller.ts',
          symbol: 'OrderController.getOrder',
          line_start: 10,
          line_end: 18,
          signature: 'getOrder(orderId: string)',
          source_missing: false,
          source_excerpt: 'async getOrder(orderId: string) { return service.getOrder(orderId) }',
        }),
        sourceContext({
          evidence_id: 'ev:query',
          node_id: 'node:dto:OrderQueryDto',
          node_type: 'class',
          dep_type: 'dependency',
          hop: 1,
          file_path: 'src/orders/order-query.dto.ts',
          symbol: 'OrderQueryDto',
          line_start: 1,
          line_end: 5,
          signature: 'class OrderQueryDto',
          source_missing: false,
          source_excerpt: 'export class OrderQueryDto { includeItems?: boolean }',
        }),
        sourceContext({
          evidence_id: 'ev:body',
          node_id: 'node:dto:UpdateOrderRequest',
          node_type: 'class',
          dep_type: 'dependency',
          hop: 1,
          file_path: 'src/orders/update-order.request.ts',
          symbol: 'UpdateOrderRequestDto',
          line_start: 1,
          line_end: 6,
          signature: 'class UpdateOrderRequestDto',
          source_missing: false,
          source_excerpt: 'export class UpdateOrderRequestDto { status!: string }',
        }),
        sourceContext({
          evidence_id: 'ev:response',
          node_id: 'node:dto:OrderResponse',
          node_type: 'class',
          dep_type: 'dependency',
          hop: 1,
          file_path: 'src/orders/order-response.dto.ts',
          symbol: 'OrderResponseDto',
          line_start: 1,
          line_end: 8,
          signature: 'class OrderResponseDto',
          source_missing: false,
          source_excerpt: 'export class OrderResponseDto { id!: string }',
        }),
      ],
      source_link_candidates: [
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
        allowed_evidence_ids: ['ev:manifest:first', 'ev:controller', 'ev:query', 'ev:body', 'ev:response', 'ev:relation'],
        required: true,
      },
      source_excerpts: [],
      relation_facts: [],
    },
  }
}

function buildScreenContext(): BuildDocsGenerationContextResponse {
  return {
    metadata: {
      run_id: 'run:2',
      task_id: 'task:2',
      schema_version: 'build_docs_cli_generation_v1',
      source_commit: 'commit:2',
      generated_at: '2026-06-05T00:00:00.000Z',
      evidence_id_namespace: 'evidence:ns',
    },
    manifest: {
      context_handle: 'ctx:2',
      task_id: 'task:2',
      schema_version: 'build_docs_cli_generation_v1',
      required_pages: ['target', 'source_context'],
      optional_pages: ['code_relation_facts', 'service_map_facts'],
      evidence_ids: ['ev:screen:manifest', 'ev:screen:component', 'ev:screen:nav'],
    },
    content: {
      target: {
        document_id: 'doc:screen:orders',
        document_type: 'screen_spec',
        target_key: '/orders',
        primary_entry_point_id: 'node:screen:OrdersPage',
        seed_node_ids: ['node:screen:OrdersPage'],
        entry_point_ids: ['node:screen:OrdersPage'],
        repository_id: 'repo:web',
        method: null,
        path: '/orders',
        handler: 'OrdersPage',
        file_path: 'web/src/pages/orders.tsx',
        framework_hint: 'react-router',
      },
      source_context: [],
      code_relation_facts: [],
      service_map_facts: [
        {
          evidence_id: 'ev:screen:nav',
          relation_id: 'edge:screen:orders:detail',
          repo_id: 'repo:web',
          source_node_id: 'node:screen:OrdersPage',
          kind: 'navigation',
          target: '/orders/:orderId',
          canonical_target: 'nav:/orders/:orderId',
          operation: null,
          confidence: 'high',
          source: 'service_map',
          evidence_node_ids: ['node:screen:OrdersPage'],
          payload: { to: '/orders/:orderId', trigger: 'click' },
          unresolved_reason: null,
        },
      ],
      related_edges: [],
      schema: {
        schema_name: 'screen_spec',
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
        allowed_evidence_ids: ['ev:screen:manifest', 'ev:screen:component', 'ev:screen:nav'],
        required: true,
      },
      source_excerpts: [],
      relation_facts: [],
    },
  }
}

function sourceContext(
  input: BuildDocsGenerationContextResponse['content']['source_context'][number],
): BuildDocsGenerationContextResponse['content']['source_context'][number] {
  return input
}
