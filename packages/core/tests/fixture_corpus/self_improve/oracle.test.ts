import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestOracleCandidate, type OracleProvider } from '../../../src/fixture_corpus/self_improve/index.js'

describe('requestOracleCandidate', () => {
  let fixtureDir: string

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'platty-oracle-'))
  })

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('calls an injected oracle provider and returns candidate metadata', async () => {
    const provider: OracleProvider = {
      createCandidate: vi.fn(async (request) => ({
        fixtureId: request.fixtureId,
        stage: request.stage,
        candidatePath: request.candidatePath,
        confidence: 'high',
        evidence: [{ path: 'schema.prisma', summary: 'reviewed source', confidence: 'high' }],
      })),
    }

    const result = await requestOracleCandidate({
      fixtureDir,
      fixtureId: 'repo/orm-e2e/prisma-examples-express',
      stage: 'build_models',
      provider,
    })

    expect(provider.createCandidate).toHaveBeenCalledWith({
      fixtureDir: resolve(fixtureDir),
      fixtureId: 'repo/orm-e2e/prisma-examples-express',
      stage: 'build_models',
      actualPath: join(fixtureDir, 'actual/build_models.json'),
      candidatePath: join(fixtureDir, 'candidate/build_models.json'),
      expectedPath: join(fixtureDir, 'expected/build_models.json'),
    })
    expect(result).toMatchObject({
      status: 'ready',
      source: 'provider',
      candidate: {
        confidence: 'high',
      },
    })
  })

  it('writes a request instead of invoking live Codex when no provider is supplied', async () => {
    const result = await requestOracleCandidate({
      fixtureDir,
      fixtureId: 'unit/ast-extract/nextjs',
      stage: 'build_graph',
      timestamp: '2026-06-09T00:00:00.000Z',
    })

    expect(result).toEqual({
      status: 'required',
      requestPath: join(fixtureDir, 'reports/self-improve/oracle-requests/2026-06-09T00-00-00-000Z-build_graph.md'),
    })
    expect(readFileSync(result.requestPath, 'utf-8')).toContain('Do not copy the actual pipeline output')
  })

  it('reuses an existing candidate only when explicitly requested', async () => {
    mkdirSync(join(fixtureDir, 'candidate'), { recursive: true })
    writeFileSync(join(fixtureDir, 'candidate/build_models.json'), '{"models":[]}\n', 'utf-8')
    const provider: OracleProvider = { createCandidate: vi.fn() }

    const result = await requestOracleCandidate({
      fixtureDir,
      fixtureId: 'repo/orm-e2e/prisma-examples-express',
      stage: 'build_models',
      provider,
      reuseExistingCandidate: true,
    })

    expect(provider.createCandidate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'ready', source: 'existing' })
    expect(existsSync(join(fixtureDir, 'candidate/build_models.json'))).toBe(true)
  })
})
