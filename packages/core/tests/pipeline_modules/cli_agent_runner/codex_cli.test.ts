import { describe, expect, it } from 'vitest'
import { normalizeCodexOutputSchema } from '@/pipeline_modules/cli_agent_runner/codex_cli.js'

describe('normalizeCodexOutputSchema', () => {
  it('marks nested object schemas as closed for Codex response_format', () => {
    const schema = {
      type: 'object',
      required: ['layout'],
      properties: {
        layout: {
          type: 'array',
          items: {
            type: 'object',
            required: ['section'],
            properties: {
              section: { type: 'string' },
            },
          },
        },
      },
    }

    const normalized = normalizeCodexOutputSchema(schema)

    expect(normalized).toMatchObject({
      additionalProperties: false,
      properties: {
        layout: {
          items: {
            additionalProperties: false,
          },
        },
      },
    })
    expect(schema.properties.layout.items).not.toHaveProperty('additionalProperties')
  })

  it('converts permissive object schemas to closed objects', () => {
    const normalized = normalizeCodexOutputSchema({
      type: 'object',
      additionalProperties: true,
      properties: {
        metadata: {
          type: ['object', 'null'],
          additionalProperties: { type: 'string' },
          properties: {},
        },
      },
    })

    expect(normalized).toMatchObject({
      additionalProperties: false,
      properties: {
        metadata: {
          additionalProperties: false,
        },
      },
    })
  })

  it('drops required keys that are not present in object properties', () => {
    const normalized = normalizeCodexOutputSchema({
      type: 'object',
      required: ['title', 'layout'],
      properties: {
        title: { type: 'string' },
      },
    })

    expect(normalized).toMatchObject({
      required: ['title'],
      properties: {
        title: { type: 'string' },
      },
    })
  })

  it('requires every declared object property for strict Codex schemas', () => {
    const normalized = normalizeCodexOutputSchema({
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
      },
    })

    expect(normalized).toMatchObject({
      required: ['title', 'summary'],
    })
  })
})
