import { describe, expect, it } from 'vitest'
import { buildDocsAgentWorkPacket } from '@/pipeline_modules/build_docs/source/agent_packet.js'
import { draftSchemaFor } from '@/pipeline_modules/build_docs/runtime/draft_contract.js'

describe('buildDocsAgentWorkPacket output schema', () => {
  it('defines screen layout and state item fields for strict JSON schema consumers', () => {
    const packet = buildDocsAgentWorkPacket({
      task: {
        task_id: 'task:screen',
        lease_token: 'lease:screen',
        document_type: 'screen_spec',
        target_summary: 'SCREEN /',
        lease_expires_at: '2026-06-08T00:00:00.000Z',
      } as any,
      context: {
        metadata: {
          run_id: 'gen:test',
          task_id: 'task:screen',
          schema_version: 'build_docs_cli_generation_v2',
          source_commit: 'commit:test',
          generated_at: '2026-06-08T00:00:00.000Z',
          evidence_id_namespace: 'platty:gen:test:task:screen',
        },
        manifest: {
          context_handle: 'ctx:screen',
          task_id: 'task:screen',
          schema_version: 'build_docs_cli_generation_v2',
          required_pages: [],
          optional_pages: [],
          evidence_ids: [],
        },
        content: {
          target: {},
          source_context: [],
          code_relation_facts: [],
          service_map_facts: [],
          related_edges: [],
          schema: draftSchemaFor('screen_spec'),
          rules: [],
        },
      } as any,
    })

    expect(packet.agentInput.outputSchema).toMatchObject({
      properties: {
        layout: {
          items: {
            additionalProperties: false,
            required: ['name', 'type', 'fields'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        state: {
          items: {
            additionalProperties: false,
            required: ['name', 'source'],
            properties: {
              name: { type: 'string' },
              source: { type: 'string' },
            },
          },
        },
      },
    })
  })
})
