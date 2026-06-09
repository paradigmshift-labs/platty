import { describe, expect, it } from 'vitest'
import { resolveOutputLanguage, outputLanguageInstruction } from '@/pipeline_modules/shared/output_language.js'

describe('output language config', () => {
  it('defaults to English when no env or option is set', () => {
    expect(resolveOutputLanguage({ stageEnvName: 'BUILD_DOCS_OUTPUT_LANGUAGE', env: {} })).toBe('en')
  })

  it('prefers explicit option over env and supports stage env fallback', () => {
    expect(resolveOutputLanguage({
      option: 'ko',
      stageEnvName: 'BUILD_DOCS_OUTPUT_LANGUAGE',
      env: { BUILD_DOCS_OUTPUT_LANGUAGE: 'en' },
    })).toBe('ko')
    expect(resolveOutputLanguage({
      stageEnvName: 'BUILD_EPICS_OUTPUT_LANGUAGE',
      env: { SDD_OUTPUT_LANGUAGE: 'ko' },
    })).toBe('ko')
  })

  it('rejects unsupported language values', () => {
    expect(() => resolveOutputLanguage({
      stageEnvName: 'BUILD_DOCS_OUTPUT_LANGUAGE',
      env: { BUILD_DOCS_OUTPUT_LANGUAGE: 'jp' },
    })).toThrow('BUILD_DOCS_OUTPUT_LANGUAGE must be "en" or "ko"')
  })

  it('keeps internal identifiers and schema keys untranslated', () => {
    expect(outputLanguageInstruction('ko')).toContain('Write user-facing natural-language values in Korean')
    expect(outputLanguageInstruction('ko')).toContain('Do not translate JSON keys or source identifiers')
  })
})
