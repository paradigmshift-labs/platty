import { afterEach, describe, expect, it, vi } from 'vitest'
import fg from 'fast-glob'
import { safeGlob } from '@/pipeline_modules/analyze_repo/static/helpers/glob.js'

vi.mock('fast-glob', () => ({ default: vi.fn() }))

const fgMock = vi.mocked(fg)

describe('safeGlob mocked fast-glob boundaries', () => {
  afterEach(() => {
    vi.useRealTimers()
    fgMock.mockReset()
  })

  it('returns empty matches when fast-glob rejects with a non-abort error', async () => {
    fgMock.mockRejectedValueOnce(new Error('glob failed'))

    await expect(safeGlob('src/**/*.ts', '/repo')).resolves.toEqual({
      matches: [],
      truncated: false,
    })
  })

  it('propagates abort when the signal aborts after glob starts', async () => {
    fgMock.mockReturnValueOnce(new Promise(() => undefined))
    const ctrl = new AbortController()

    const result = safeGlob('src/**/*.ts', '/repo', ctrl.signal)
    ctrl.abort()

    await expect(result).rejects.toThrow(/abort/i)
  })

  it('returns empty matches when timeout wins the race', async () => {
    vi.useFakeTimers()
    fgMock.mockReturnValueOnce(new Promise(() => undefined))

    const result = safeGlob('src/**/*.ts', '/repo')
    await vi.advanceTimersByTimeAsync(10_001)

    await expect(result).resolves.toEqual({ matches: [], truncated: false })
  })
})
