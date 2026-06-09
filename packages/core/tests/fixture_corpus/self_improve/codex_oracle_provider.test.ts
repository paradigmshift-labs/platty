import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCodexOracleProvider } from '../../../src/fixture_corpus/self_improve/index.js'
import type { LlmAdapter } from '../../../src/llm/types.js'

describe('createCodexOracleProvider', () => {
  let fixtureDir: string

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'platty-codex-oracle-'))
  })

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('uses an injected LLM adapter and writes candidate JSON without including the actual path in the prompt', async () => {
    const call = vi.fn(async () => ({
      content: JSON.stringify({
        candidate: { models: [] },
        confidence: 'high',
        evidence: [{ path: 'schema.prisma', summary: 'reviewed prisma schema', confidence: 'high' }],
      }),
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: 0,
      durationMs: 1,
      model: 'test',
    }))
    const llm: LlmAdapter = { provider: 'codex_cli', model: 'test', call }
    const provider = createCodexOracleProvider({ llm })
    const candidatePath = join(fixtureDir, 'candidate/build_models.json')

    const result = await provider.createCandidate({
      fixtureDir,
      fixtureId: 'repo/orm-e2e/prisma-examples-express',
      stage: 'build_models',
      actualPath: join(fixtureDir, 'actual/build_models.json'),
      candidatePath,
      expectedPath: join(fixtureDir, 'expected/build_models.json'),
    })

    expect(existsSync(candidatePath)).toBe(true)
    expect(JSON.parse(readFileSync(candidatePath, 'utf-8'))).toEqual({ models: [] })
    expect(result.confidence).toBe('high')
    expect(call.mock.calls[0]?.[0].prompt).not.toContain('Actual path')
    expect(call.mock.calls[0]?.[0].systemPrompt).toContain('Do not copy actual pipeline output')
  })
})
