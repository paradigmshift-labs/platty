import { describe, expect, it } from 'vitest'
import {
  buildSourceLinkCandidates,
  resolveSourceLinkSelection,
  stripSourceLinkSelection,
} from '@/pipeline_modules/build_docs_generation/source_links.js'
import type { SourceContext } from '@/pipeline_modules/build_docs_generation/types.js'

describe('buildSourceLinkCandidates', () => {
  it('creates deterministic candidates from source context with useful role hints', () => {
    const candidates = buildSourceLinkCandidates([
      source({
        evidence_id: 'ev:handler',
        node_id: 'node:handler',
        node_type: 'method',
        dep_type: 'entrypoint',
        symbol: 'AdminController.verify',
        source_excerpt:
          '@UseGuards(AdminGuard) async verify(@Body() body: VerifyBody) { return res.json({ ok: true }) }',
      }),
      source({
        evidence_id: 'ev:body',
        node_id: 'node:body',
        node_type: 'type',
        dep_type: 'dependency',
        symbol: 'VerifyBody',
        source_excerpt: 'export type VerifyBody = { status: string }',
      }),
    ])

    expect(candidates).toEqual([
      expect.objectContaining({
        candidate_id: 'source_link_candidate:001',
        node_id: 'node:handler',
        evidence_id: 'ev:handler',
        role_hints: expect.arrayContaining(['access', 'input', 'response', 'entrypoint']),
      }),
      expect.objectContaining({
        candidate_id: 'source_link_candidate:002',
        node_id: 'node:body',
        evidence_id: 'ev:body',
        role_hints: expect.arrayContaining(['input', 'type-definition']),
      }),
    ])
  })
})

describe('resolveSourceLinkSelection', () => {
  it('resolves selected candidate ids to node id arrays', () => {
    const candidates = buildSourceLinkCandidates([
      source({
        evidence_id: 'ev:handler',
        node_id: 'node:handler',
        node_type: 'method',
        dep_type: 'entrypoint',
        symbol: 'AdminController.verify',
      }),
      source({
        evidence_id: 'ev:body',
        node_id: 'node:body',
        node_type: 'type',
        dep_type: 'dependency',
        symbol: 'VerifyBody',
      }),
    ])

    expect(resolveSourceLinkSelection({
      access: ['source_link_candidate:001'],
      input: ['source_link_candidate:002'],
      response: [],
    }, candidates)).toEqual({
      ok: true,
      sourceLinks: {
        access: ['node:handler'],
        input: ['node:body'],
        response: [],
      },
    })
  })

  it('returns validation errors for unknown candidate ids', () => {
    const result = resolveSourceLinkSelection({ input: ['missing:candidate'] }, [])

    expect(result).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({
          code: 'UNKNOWN_SOURCE_LINK_CANDIDATE',
          path: '$.source_link_selection.input[0]',
        }),
      ],
    })
  })

  it('returns shape errors for non-array roles and malformed selection entries', () => {
    const candidates = buildSourceLinkCandidates([
      source({
        evidence_id: 'ev:body',
        node_id: 'node:body',
        node_type: 'type',
        dep_type: 'dependency',
        symbol: 'VerifyBody',
      }),
    ])

    const result = resolveSourceLinkSelection({
      access: 'source_link_candidate:001',
      input: [123, '', 'source_link_candidate:001'],
    }, candidates)

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: 'QUALITY_FIELD_SHAPE',
          path: '$.source_link_selection.access',
        }),
        expect.objectContaining({
          code: 'QUALITY_FIELD_SHAPE',
          path: '$.source_link_selection.input[0]',
        }),
        expect.objectContaining({
          code: 'QUALITY_FIELD_SHAPE',
          path: '$.source_link_selection.input[1]',
        }),
      ]),
    })
  })
})

describe('stripSourceLinkSelection', () => {
  it('removes transient source_link_selection without mutating other draft fields', () => {
    const draft = {
      title: 'API',
      source_link_selection: { input: ['source_link_candidate:001'] },
    }

    expect(stripSourceLinkSelection(draft)).toEqual({ title: 'API' })
    expect(draft).toHaveProperty('source_link_selection')
  })
})

function source(overrides: Partial<SourceContext>): SourceContext {
  return {
    evidence_id: 'ev',
    node_id: 'node',
    node_type: 'method',
    dep_type: 'dependency',
    hop: 0,
    file_path: 'src/controller.ts',
    symbol: 'Controller.method',
    line_start: 1,
    line_end: 5,
    signature: null,
    source_missing: false,
    source_excerpt: '',
    ...overrides,
  }
}
