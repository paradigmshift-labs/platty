import { describe, expect, it } from 'vitest'
import { StackInfoSchema } from '@/pipeline_modules/analyze_repo/schemas.js'

function validStack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'backend',
    language: 'typescript',
    framework: 'nestjs',
    schema_sources: [],
    routing_files: ['src/app.module.ts'],
    routing_libs: [],
    entrypoint_files: ['src/main.ts'],
    path_aliases: { '@': 'src' },
    base_url: null,
    custom_decorators: {},
    ...overrides,
  }
}

describe('StackInfoSchema path and key safety', () => {
  it('accepts a valid downstream stack contract', () => {
    expect(StackInfoSchema.safeParse(validStack()).success).toBe(true)
  })

  it.each([
    ['routing_files', ['../routes.ts']],
    ['entrypoint_files', ['../main.ts']],
  ])('rejects unsafe filesystem path field %s', (field, value) => {
    const parsed = StackInfoSchema.safeParse(validStack({ [field]: value }))

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.message.includes('위험한 경로'))).toBe(true)
  })

  it('rejects unsafe schema paths, path aliases, and custom decorator wrapper files', () => {
    const parsed = StackInfoSchema.safeParse(validStack({
      schema_sources: [{
        orm: 'prisma',
        provider: 'postgresql',
        label: 'main',
        schema_paths: ['../schema.prisma'],
      }],
      path_aliases: { '@bad': '..\\src' },
      custom_decorators: {
        ApiGet: {
          expands_to: ['Get'],
          file: '/tmp/decorator.ts',
          dynamic: false,
          fallback_to_llm: false,
        },
      },
    }))

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.filter((issue) => issue.message.includes('위험한 경로')).length).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['../api'],
    ['..\\api'],
    ['/api'],
    ['https://example.com/api'],
    ['api '],
  ])('rejects unsafe base_url value %s', (baseUrl) => {
    const parsed = StackInfoSchema.safeParse(validStack({ base_url: baseUrl }))

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.message.includes('base_url'))).toBe(true)
  })

  it.each(['constructor', 'prototype'])('rejects dangerous path_aliases key %s', (key) => {
    const parsed = StackInfoSchema.safeParse(validStack({ path_aliases: { [key]: 'src' } }))

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.message.includes(`허용되지 않는 키: ${key}`))).toBe(true)
  })
})
