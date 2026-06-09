import { describe, expect, it } from 'vitest'
import { runPlattyCommand } from '../../src/main.js'

describe('platty docs command routing', () => {
  it('routes docs root instead of returning UNKNOWN_COMMAND', async () => {
    const response = await runPlattyCommand(['docs', '--json'], { cwd: process.cwd() })

    expect(response.result.ok).toBe(false)
    expect(response.result.errors[0]?.code).not.toBe('UNKNOWN_COMMAND')
  })
})
