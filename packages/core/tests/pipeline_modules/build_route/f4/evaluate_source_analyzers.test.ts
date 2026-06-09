import { describe, expect, it } from 'vitest'

import { evaluateSourceAnalyzers } from '@/pipeline_modules/build_route/index.js'

describe('evaluateSourceAnalyzers', () => {
  it('wraps current source fallback output in an analyzer result', () => {
    const result = evaluateSourceAnalyzers({
      repoPath: '/repo',
      repoId: 'repo',
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [],
      graphNodes: [],
    })

    expect(result).toEqual({
      entryPoints: [],
      suspected: [],
      diagnostics: { 'legacy_source_fallbacks.sourceFallbackEntries': 0, filesRead: 1 },
    })
  })
})
