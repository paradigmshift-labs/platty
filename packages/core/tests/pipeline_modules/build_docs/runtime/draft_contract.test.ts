import { describe, expect, it } from 'vitest'
import { draftSchemaFor, validateDraft } from '@/pipeline_modules/build_docs/runtime/draft_contract.js'

describe('build docs draft contract', () => {
  it('accepts narrative-only api drafts', () => {
    expect(validateDraft(validApiDraft(), 'api_spec')).toEqual([])
  })

  it('accepts v2 API drafts with one-line access and optional source link selection', () => {
    const draft = {
      title: 'Verification API',
      summary: 'Reviews a purchase campaign submission.',
      access: 'Admin-only: AdminGuard is applied.',
      flow: ['The handler loads the submission and records the verification result.'],
      rules: ['Already processed submissions should not be verified twice.'],
      source_link_selection: {
        access: ['source_link_candidate:001'],
        input: ['source_link_candidate:002'],
        response: [],
      },
    }

    expect(validateDraft(draft, 'api_spec')).toEqual([])
  })

  it('accepts API drafts with partial source link selection sections', () => {
    expect(validateDraft({
      title: 'Verification API',
      summary: 'Reviews a submission.',
      access: 'Admin-only: AdminGuard is applied.',
      flow: ['The handler verifies the submission.'],
      rules: [],
      source_link_selection: {
        input: ['source_link_candidate:001'],
      },
    }, 'api_spec')).toEqual([])
  })

  it('rejects API drafts that output source links or detailed input and response fields', () => {
    const errors = validateDraft({
      title: 'Verification API',
      summary: 'Reviews a submission.',
      access: 'Admin-only: AdminGuard is applied.',
      flow: ['The handler verifies the submission.'],
      rules: [],
      input: { body: { status: 'string' } },
      response: { ok: true },
      contracts: { request: {} },
      source_links: {
        input: ['node:invented'],
      },
    }, 'api_spec')

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.input' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.response' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.contracts' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.source_links' }),
    ]))
  })

  it('rejects multiline API access text', () => {
    const errors = validateDraft({
      title: 'Verification API',
      summary: 'Reviews a submission.',
      access: 'Admin-only:\nAdminGuard is applied.',
      flow: ['The handler verifies the submission.'],
      rules: [],
    }, 'api_spec')

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'QUALITY_FIELD_SHAPE', path: '$.access' }),
    ]))
  })

  it('rejects source link selections that contain direct source objects', () => {
    const errors = validateDraft({
      title: 'Verification API',
      summary: 'Reviews a submission.',
      access: 'Admin-only: AdminGuard is applied.',
      flow: ['The handler verifies the submission.'],
      rules: [],
      source_link_selection: {
        input: [{ node_id: 'node:invented', file_path: 'src/x.ts' }],
      },
    }, 'api_spec')

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'QUALITY_FIELD_SHAPE', path: '$.source_link_selection.input[0]' }),
    ]))
  })

  it('rejects source link selections with unknown role keys', () => {
    const errors = validateDraft({
      title: 'Verification API',
      summary: 'Reviews a submission.',
      access: 'Admin-only: AdminGuard is applied.',
      flow: ['The handler verifies the submission.'],
      rules: [],
      source_link_selection: {
        headers: ['source_link_candidate:001'],
      },
    }, 'api_spec')

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FORBIDDEN_DRAFT_FIELD', path: '$.source_link_selection.headers' }),
    ]))
  })

  it('rejects any non-narrative API draft keys even when they are aliases', () => {
    const errors = validateDraft({
      ...validApiDraft(),
      method: 'GET',
      request: { query: { includeItems: 'boolean' } },
      tables: [{ table: 'orders', operation: 'select' }],
    }, 'api_spec')

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FORBIDDEN_DRAFT_FIELD', path: '$.method' }),
      expect.objectContaining({ code: 'FORBIDDEN_DRAFT_FIELD', path: '$.request' }),
      expect.objectContaining({ code: 'FORBIDDEN_DRAFT_FIELD', path: '$.tables' }),
    ]))
  })

  it('rejects system-owned and raw evidence fields in LLM drafts', () => {
    const errors = validateDraft({
      ...validApiDraft(),
      id: 'llm:wrong-id',
      type: 'screen_spec',
      identity: { method: 'POST', path: '/made-up' },
      input: { body: { orderId: 'string' } },
      response: { id: 'string' },
      contracts: [{ kind: 'request' }],
      relation_evidence_checked: true,
      relations: { tables: [{ table: 'llm_guess', operation: 'select' }] },
      relation_facts: [{ relation_id: 'llm:invented' }],
      evidence_refs: ['llm:invented'],
      raw_evidence_pages: [{ page: 'source_context', content: 'raw source' }],
    }, 'api_spec')

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.id' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.type' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.identity' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.input' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.response' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.contracts' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.relation_evidence_checked' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.relations' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.relation_facts' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.evidence_refs' }),
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.raw_evidence_pages' }),
    ]))
  })

  it('api schema exposes only narrative fields to the LLM', () => {
    const schema = draftSchemaFor('api_spec')

    expect(schema.required_fields).toEqual(['title', 'summary', 'access', 'flow', 'rules'])
    expect(schema.required_fields).not.toEqual(expect.arrayContaining(['input', 'response']))
    expect(schema.system_injected_fields).toEqual(expect.arrayContaining([
      'id',
      'type',
      'identity',
      'source_links',
      'relations',
      'evidence_refs',
      'relation_evidence_checked',
    ]))
    expect(schema.llm_output_shape).toEqual({
      title: 'string',
      summary: 'string',
      access: 'one-line access/auth summary from source-backed evidence',
      flow: ['source-backed execution step'],
      rules: ['source-backed durable rule; [] when none is explicit'],
      source_link_selection: {
        access: ['source_link_candidate id from content.source_link_candidates'],
        input: ['source_link_candidate id from content.source_link_candidates'],
        response: ['source_link_candidate id from content.source_link_candidates'],
      },
    })
    expect(schema.output_rules.join('\n')).toMatch(/write draft explanation fields only/i)
    expect(schema.output_rules.join('\n')).toMatch(/do not output id, type, identity, input, response/i)
    expect(schema.output_rules.join('\n')).toMatch(/write access as one line only/i)
    expect(schema.output_rules.join('\n')).toMatch(/choose source_link_selection ids only from content\.source_link_candidates/i)
    expect(schema.output_rules.join('\n')).toMatch(/never invent node_id, file_path, line_start, line_end, or evidence_id/i)
  })

  it('draft schema includes v2 API quality rules for source-backed generation', () => {
    const rules = draftSchemaFor('api_spec').quality_rules.join('\n')

    expect(rules).toMatch(/one api_spec is exactly one HTTP method\/path/i)
    expect(rules).toMatch(/write access as a single line/i)
    expect(rules).toMatch(/do not write detailed input, response, or contracts schemas/i)
    expect(rules).toMatch(/content\.source_link_candidates/i)
    expect(rules).toMatch(/flow is observed execution sequence/i)
    expect(rules).toMatch(/rules are durable constraints or decisions/i)
    expect(rules).toMatch(/relations are system-injected/i)
  })

  it('screen schema no longer asks the LLM for separate action arrays', () => {
    const schema = draftSchemaFor('screen_spec')

    expect(schema.required_fields).toEqual(['title', 'summary', 'ascii_ui', 'layout', 'state', 'flow', 'rules'])
    expect(schema.llm_output_shape).not.toHaveProperty('actions')
  })

  it('accepts screen drafts without actions while preserving backward compatibility when actions are present', () => {
    const draft = {
      title: 'Orders screen',
      summary: 'Shows orders.',
      ascii_ui: '+ Orders',
      layout: [],
      state: [],
      flow: ['Loads orders and opens detail routes from relation evidence.'],
      rules: [],
    }

    expect(validateDraft(draft, 'screen_spec')).toEqual([])
    expect(validateDraft({ ...draft, actions: [{ name: 'open order', trigger: 'click', result: 'navigate' }] }, 'screen_spec')).toEqual([])
  })

  it('event schema omits target-owned event and producer fields', () => {
    const schema = draftSchemaFor('event_spec')

    expect(schema.required_fields).toEqual(['title', 'summary', 'payload', 'consumers'])
    expect(schema.llm_output_shape).not.toHaveProperty('event')
    expect(schema.llm_output_shape).not.toHaveProperty('producers')
  })

  it('accepts event drafts without event and producers while preserving backward compatibility when present', () => {
    const draft = {
      title: 'Order paid event',
      summary: 'Handles order payment events.',
      payload: {},
      consumers: [{ handler: 'OrderPaidHandler.handle', flow: ['Updates the order.'], rules: [] }],
    }

    expect(validateDraft(draft, 'event_spec')).toEqual([])
    expect(validateDraft({ ...draft, event: 'order.paid', producers: [{ source: 'OrderService' }] }, 'event_spec')).toEqual([])
  })

  it('schedule schema omits target-owned schedule while keeping trigger and input evidence', () => {
    const schema = draftSchemaFor('schedule_spec')

    expect(schema.required_fields).toEqual(['title', 'summary', 'trigger', 'input', 'flow', 'rules'])
    expect(schema.llm_output_shape).not.toHaveProperty('schedule')
  })

  it('accepts schedule drafts without schedule while preserving backward compatibility when present', () => {
    const draft = {
      title: 'Daily settlement job',
      summary: 'Runs daily settlement processing.',
      trigger: { type: 'cron', expression: '0 0 * * *' },
      input: {},
      flow: ['Loads settlement targets and writes settlement records.'],
      rules: [],
    }

    expect(validateDraft(draft, 'schedule_spec')).toEqual([])
    expect(validateDraft({ ...draft, schedule: '0 0 * * *' }, 'schedule_spec')).toEqual([])
  })

  it('rejects runtime source link candidate context in non-API drafts', () => {
    const errors = validateDraft({
      title: 'Orders screen',
      summary: 'Shows orders.',
      ascii_ui: '+ Orders',
      layout: [],
      state: [],
      flow: ['Loads orders.'],
      rules: [],
      source_link_candidates: [{ candidate_id: 'source_link_candidate:001' }],
    }, 'screen_spec')

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FORBIDDEN_SYSTEM_FIELD', path: '$.source_link_candidates' }),
    ]))
  })

  it('draft schema includes legacy screen quality rules for source-backed UI drafts', () => {
    const rules = draftSchemaFor('screen_spec').quality_rules.join('\n')

    expect(rules).toMatch(/ascii_ui must be non-empty/i)
    expect(rules).toMatch(/copy visible literals exactly/i)
    expect(rules).toMatch(/include loading\/empty\/auth\/tabs\/conditional\/error states when source-backed/i)
    expect(rules).toMatch(/do not document child internals unless child source is included/i)
  })
})

function validApiDraft(): Record<string, unknown> {
  return {
    title: 'Order detail API',
    summary: 'Returns a source-backed order detail.',
    access: 'Authenticated users can access orders they are allowed to view.',
    flow: ['OrderController.getOrder calls OrderRepository.findById and maps OrderResponseDto.'],
    rules: ['orderId selects the order record.'],
  }
}
