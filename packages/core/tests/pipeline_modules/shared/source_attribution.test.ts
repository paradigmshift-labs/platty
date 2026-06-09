import { describe, expect, it } from 'vitest'
import {
  normalizeSourceAttribution,
  sourceAttributionFromConfigSource,
} from '@/pipeline_modules/shared/static_config/source_attribution.js'

describe('static analysis source attribution', () => {
  it('maps config sources to user-facing attribution classes', () => {
    expect(sourceAttributionFromConfigSource('default')).toBe('default_config')
    expect(sourceAttributionFromConfigSource('repository_metadata')).toBe('repository_metadata')
    expect(sourceAttributionFromConfigSource('user')).toBe('user_config')
    expect(sourceAttributionFromConfigSource('fixture')).toBe('fixture_config')
    expect(sourceAttributionFromConfigSource('approved')).toBe('approved_config')
    expect(sourceAttributionFromConfigSource('agent_candidate')).toBe('agent_search_proposal')
  })

  it('keeps adapter, source fallback, and route LLM fallback distinguishable', () => {
    expect(normalizeSourceAttribution('rule:nestjs')).toBe('adapter')
    expect(normalizeSourceAttribution('semantic:react')).toBe('adapter')
    expect(normalizeSourceAttribution('source:nextjs')).toBe('source_fallback')
    expect(normalizeSourceAttribution('llm:haiku')).toBe('route_llm_fallback')
  })

  it('does not collapse unknown legacy values into a false attribution class', () => {
    expect(normalizeSourceAttribution('legacy:unknown')).toBeNull()
  })
})
