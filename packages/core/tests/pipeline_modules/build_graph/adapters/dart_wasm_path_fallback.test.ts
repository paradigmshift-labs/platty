import { afterEach, describe, expect, it, vi } from 'vitest'

describe('DartParserAdapter WASM path fallback', () => {
  afterEach(() => {
    vi.doUnmock('node:url')
    vi.resetModules()
  })

  it('import.meta.url path resolution throws → cwd fallback path still creates adapter', async () => {
    vi.resetModules()
    vi.doMock('node:url', () => ({
      fileURLToPath: () => {
        throw new Error('url unavailable')
      },
    }))

    const { DartParserAdapter } = await import('@/pipeline_modules/build_graph/adapters/dart.js')
    const adapter = await DartParserAdapter.create()

    expect(adapter.supportedExtensions()).toEqual(['.dart'])
  })
})
