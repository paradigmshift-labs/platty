import { describe, expect, it } from 'vitest'
import { runPlattyCommand } from '../../../src/main.js'

describe('platty corpus CLI', () => {
  it('runs fixture planning through the public corpus command surface', async () => {
    const response = await runPlattyCommand([
      'corpus',
      'run-fixture',
      '--id',
      'repo/orm-e2e/prisma-examples-express',
      '--stage',
      'build_models',
      '--json',
    ])

    expect(response.exitCode).toBe(0)
    expect(JSON.parse(response.stdout)).toEqual(response.result)
    expect(response.result).toMatchObject({
      ok: true,
      data: {
        command: 'run-fixture',
        fixtureId: 'repo/orm-e2e/prisma-examples-express',
        dryRun: true,
        plan: {
          writePolicy: 'report_only',
        },
      },
    })
  })

  it('returns corpus summary and candidate commands without requiring a project database', async () => {
    const report = await runPlattyCommand(['corpus', 'batch-report', '--json'])
    const candidate = await runPlattyCommand(['corpus', 'next-candidate', '--json'])

    expect(report.exitCode).toBe(0)
    expect(report.result).toMatchObject({
      ok: true,
      data: {
        command: 'batch-report',
      },
    })
    expect(report.result.data).toHaveProperty('summary.total')

    expect(candidate.exitCode).toBe(0)
    expect(candidate.result).toMatchObject({
      ok: true,
      data: {
        command: 'next-candidate',
        fixture: {
          id: expect.any(String),
        },
      },
    })
  })

  it('compares, gates, and audits fixture candidates with explicit missing-oracle output', async () => {
    const compare = await runPlattyCommand([
      'corpus',
      'compare',
      '--id',
      'unit/ast-extract/nextjs',
      '--stage',
      'build_graph',
      '--json',
    ])
    const gate = await runPlattyCommand([
      'corpus',
      'gate-check',
      '--id',
      'unit/ast-extract/nextjs',
      '--stage',
      'build_graph',
      '--json',
    ])
    const audit = await runPlattyCommand(['corpus', 'audit-queue', '--json'])

    expect(compare.exitCode).toBe(0)
    expect(compare.result).toMatchObject({
      ok: true,
      data: {
        command: 'compare',
        status: 'missing_expected',
      },
    })
    expect(gate.exitCode).toBe(1)
    expect(gate.result).toMatchObject({
      ok: false,
      data: {
        command: 'gate-check',
        status: 'missing_expected',
      },
      errors: [{ code: 'FIXTURE_GATE_FAILED' }],
    })
    expect(audit.exitCode).toBe(0)
    expect(audit.result).toMatchObject({
      ok: true,
      data: {
        command: 'audit-queue',
        fixtures: expect.any(Array),
      },
    })
  })
})
