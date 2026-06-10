import { describe, expect, it } from 'vitest'
import { runPlattyCommand } from '../../src/main.js'

describe('platty docs command routing', () => {
  it('shows help when no subcommand is given', async () => {
    const response = await runPlattyCommand(['docs', '--json'], { cwd: process.cwd() })

    expect(response.result.ok).toBe(true)
    expect(response.skipDefaultRender).toBe(true)
    expect(response.stdout).toContain('platty docs <command>')
  })
})
