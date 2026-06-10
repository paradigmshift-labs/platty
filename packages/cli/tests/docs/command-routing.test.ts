import { describe, expect, it } from 'vitest'
import { runPlattyCommand } from '../../src/main.js'

describe('platty docs command routing', () => {
  it('shows help when no subcommand is given', async () => {
    const response = await runPlattyCommand(['docs', '--json'], { cwd: process.cwd() })

    expect(response.result.ok).toBe(true)
    expect(response.skipDefaultRender).toBe(true)
    expect(response.stdout).toContain('platty docs <command>')
    expect(response.stdout).toContain('Targets are build_route entry points')
    expect(response.stdout).toContain('--kind api|screen|job|event|all')
    expect(response.stdout).toContain('--status active|deprecated|all')
  })
})
