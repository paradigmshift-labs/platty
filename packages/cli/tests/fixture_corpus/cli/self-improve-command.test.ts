import { describe, expect, it } from 'vitest'
import { runPlattyCommand } from '../../../src/main.js'

describe('platty corpus self-improve-once CLI', () => {
  it('dry-runs the self-improve stage plan without touching fixture files or requiring Codex', async () => {
    const response = await runPlattyCommand([
      'corpus',
      'self-improve-once',
      '--id',
      'repo/orm-e2e/prisma-examples-express',
      '--stage',
      'build_models',
      '--dry-run',
      '--json',
    ])

    expect(response.exitCode).toBe(0)
    expect(JSON.parse(response.stdout)).toEqual(response.result)
    expect(response.result).toMatchObject({
      ok: true,
      data: {
        command: 'self-improve-once',
        fixtureId: 'repo/orm-e2e/prisma-examples-express',
        dryRun: true,
        stages: ['analyze_repo', 'build_graph', 'build_pattern_profile', 'build_models'],
        liveOracle: false,
      },
    })
  })
})
