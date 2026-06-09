import { describe, it, expect, vi } from 'vitest'
import type { IdentitySignal, ManifestSet } from '@/pipeline_modules/analyze_repo/types.js'

vi.mock('@/pipeline_modules/analyze_repo/static/frameworks/nestjs.js', () => ({
  nestjsAdapter: {
    framework: 'nestjs',
    extractSlots: vi.fn(async () => ({})),
  },
}))

const { extractStandardSlots } = await import('@/pipeline_modules/analyze_repo/f2b_extract_standard_slots.js')

const identity: IdentitySignal = {
  language: 'typescript',
  language_raw: null,
  framework: 'nestjs',
  framework_raw: null,
  type: 'backend',
  orm: null,
  build_tool: null,
  confidence: 'high',
  reasoning: '',
  ambiguous: false,
}

const manifests: ManifestSet = {
  packageJson: null,
  pubspecYaml: null,
  tsconfig: null,
  otherManifests: [],
}

describe('extractStandardSlots adapter defaulting', () => {
  it('defaults missing adapter slots to downstream-safe empty values', async () => {
    const result = await extractStandardSlots(manifests, identity, '/repo')

    expect(result).toMatchObject({
      path_aliases: {},
      base_url: null,
      entrypoint_files: [],
      routing_files: [],
      routing_libs: [],
      schema_sources: [],
      needsLLMRouting: false,
      needsLLMCustomDecorators: false,
    })
  })
})
