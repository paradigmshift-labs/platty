/**
 * AbortSignal 전파 테스트 (N7)
 *
 * SOT: specs/analyze_repo/architecture.md §AbortSignal pass-through
 *
 * A1: pre-aborted signal → safeGlob 즉시 AbortError
 * A2: pre-aborted signal → grepFiles 즉시 AbortError
 * A3: pre-aborted signal → extractStandardSlots 즉시 AbortError
 * A4: pre-aborted signal → nestjs adapter 즉시 AbortError
 * A5: pre-aborted signal → nextjs adapter 즉시 AbortError
 * A6: react/flutter/express/fastify adapter — pre-aborted signal → 즉시 AbortError
 * A7: orchestrator — F2b-1 진입 후 abort 발화 시 pipeline_runs.status='cancelled'
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'

import { safeGlob } from '@/pipeline_modules/analyze_repo/static/helpers/glob.js'
import { grepFiles } from '@/pipeline_modules/analyze_repo/static/helpers/grep.js'
import { extractStandardSlots } from '@/pipeline_modules/analyze_repo/f2b_extract_standard_slots.js'
import { nestjsAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/nestjs.js'
import { nextjsAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/nextjs.js'
import { reactAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/react.js'
import { flutterAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/flutter.js'
import { expressAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/express.js'
import { fastifyAdapter } from '@/pipeline_modules/analyze_repo/static/frameworks/fastify.js'
import { runAnalyzeRepo } from '@/pipeline_modules/analyze_repo/index.js'
import { repositories, projects } from '@/db/schema/core.js'
import { pipelineRuns } from '@/db/schema/pipeline_runs.js'
import * as registry from '@/llm/registry.js'
import type { LlmAdapter, LlmRequest, LlmResponse } from '@/llm/types.js'
import type { ManifestSet, IdentitySignal } from '@/pipeline_modules/analyze_repo/types.js'
import { createTestDb, type DB } from '../../../server/helpers.js'

const TMP = resolve(process.cwd(), '.tmp-test-abort-signal')

function mkRepo(name: string, files: Record<string, string> = {}): string {
  const repoPath = join(TMP, name)
  rmSync(repoPath, { recursive: true, force: true })
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return repoPath
}

const baseManifests: ManifestSet = {
  packageJson: null,
  pubspecYaml: null,
  tsconfig: null,
  otherManifests: [],
}

const nestjsIdentity: IdentitySignal = {
  language: 'typescript', language_raw: null,
  framework: 'nestjs', framework_raw: null,
  type: 'backend', orm: null, build_tool: null,
  confidence: 'high', reasoning: '', ambiguous: false,
}

function preAbortedSignal(): AbortSignal {
  const ctrl = new AbortController()
  ctrl.abort()
  return ctrl.signal
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
})
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// A1: safeGlob — pre-aborted signal → 즉시 AbortError
// ─────────────────────────────────────────────────────────────────────────────
describe('A1: safeGlob — AbortSignal', () => {
  it('pre-aborted signal → throws AbortError immediately', async () => {
    const repo = mkRepo('a1', { 'src/a.ts': '' })
    const signal = preAbortedSignal()
    await expect(safeGlob('src/**/*.ts', repo, signal)).rejects.toSatisfy(isAbortError)
  })

  it('no signal → works normally', async () => {
    const repo = mkRepo('a1-normal', { 'src/a.ts': '' })
    const result = await safeGlob('src/**/*.ts', repo)
    expect(result.matches).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A2: grepFiles — pre-aborted signal → 즉시 AbortError
// ─────────────────────────────────────────────────────────────────────────────
describe('A2: grepFiles — AbortSignal', () => {
  it('pre-aborted signal → throws AbortError immediately', async () => {
    const repo = mkRepo('a2', { 'src/a.ts': 'const x = 1' })
    const signal = preAbortedSignal()
    await expect(grepFiles('src/**/*.ts', 'const x', repo, signal)).rejects.toSatisfy(isAbortError)
  })

  it('no signal → works normally', async () => {
    const repo = mkRepo('a2-normal', { 'src/a.ts': 'const x = 1' })
    const result = await grepFiles('src/**/*.ts', 'const x', repo)
    expect(result).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A3: extractStandardSlots — pre-aborted signal → 즉시 AbortError
// ─────────────────────────────────────────────────────────────────────────────
describe('A3: extractStandardSlots — AbortSignal', () => {
  it('pre-aborted signal → throws AbortError immediately', async () => {
    const repo = mkRepo('a3', { 'src/main.ts': '' })
    const signal = preAbortedSignal()
    await expect(
      extractStandardSlots(baseManifests, nestjsIdentity, repo, { signal }),
    ).rejects.toSatisfy(isAbortError)
  })

  it('no opts → works normally (nestjs)', async () => {
    const repo = mkRepo('a3-normal', { 'src/main.ts': '' })
    const result = await extractStandardSlots(baseManifests, nestjsIdentity, repo)
    expect(result).toHaveProperty('entrypoint_files')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A4: nestjs adapter — pre-aborted signal → 즉시 AbortError
// ─────────────────────────────────────────────────────────────────────────────
describe('A4: nestjsAdapter — AbortSignal', () => {
  it('pre-aborted signal → throws AbortError immediately', async () => {
    const repo = mkRepo('a4', { 'src/main.ts': '' })
    const signal = preAbortedSignal()
    await expect(
      nestjsAdapter.extractSlots(baseManifests, nestjsIdentity, repo, signal),
    ).rejects.toSatisfy(isAbortError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A5: nextjs adapter — pre-aborted signal → 즉시 AbortError
// ─────────────────────────────────────────────────────────────────────────────
describe('A5: nextjsAdapter — AbortSignal', () => {
  it('pre-aborted signal → throws AbortError immediately', async () => {
    const repo = mkRepo('a5', {})
    const signal = preAbortedSignal()
    const identity: IdentitySignal = { ...nestjsIdentity, framework: 'nextjs' }
    await expect(
      nextjsAdapter.extractSlots(baseManifests, identity, repo, signal),
    ).rejects.toSatisfy(isAbortError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A6: react / flutter / express / fastify — pre-aborted signal → 즉시 AbortError
// ─────────────────────────────────────────────────────────────────────────────
describe('A6: other adapters — AbortSignal', () => {
  const adapters = [
    { name: 'react', adapter: reactAdapter, framework: 'react' as const },
    { name: 'flutter', adapter: flutterAdapter, framework: 'flutter' as const },
    { name: 'express', adapter: expressAdapter, framework: 'express' as const },
    { name: 'fastify', adapter: fastifyAdapter, framework: 'fastify' as const },
  ]

  it.each(adapters)('$name adapter: pre-aborted signal → throws AbortError', async ({ name, adapter, framework }) => {
    const repo = mkRepo(`a6-${name}`, {})
    const signal = preAbortedSignal()
    const identity: IdentitySignal = { ...nestjsIdentity, framework }
    const manifests: ManifestSet = framework === 'flutter'
      ? { ...baseManifests, pubspecYaml: { dependencies: {} } }
      : { ...baseManifests, packageJson: { dependencies: {}, devDependencies: {} } }
    await expect(
      adapter.extractSlots(manifests, identity, repo, signal),
    ).rejects.toSatisfy(isAbortError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A7: orchestrator — F2b-1 진입 후 abort → pipeline_runs.status='cancelled'
// ─────────────────────────────────────────────────────────────────────────────
describe('A7: orchestrator — abort during F2b-1 → cancelled', () => {
  let db: DB

  beforeEach(() => {
    db = createTestDb()
  })

  it('signal aborted before F2b-1 → run.status=cancelled', async () => {
    // react repo — static extraction only (no LLM for F2a-3)
    // but abort signal pre-fired → F2b-1 should abort immediately
    const projectId = nanoid()
    const repoId = nanoid()
    db.insert(projects).values({ id: projectId, name: 'test-project' }).run()
    const repoPath = mkRepo(`a7-${repoId.slice(0, 6)}`, {
      'package.json': JSON.stringify({
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      }),
      'src/main.tsx': '',
      'src/pages/Home.tsx': '',
    })
    db.insert(repositories).values({ id: repoId, projectId, name: 'r', repoPath }).run()

    const ctrl = new AbortController()
    // LLM stubbing is not needed here — abort fires before any fallback can run.
    const adapter: LlmAdapter = {
      provider: 'claude_code', model: 'stub',
      async call(_req: LlmRequest): Promise<LlmResponse> {
        if (ctrl.signal.aborted) {
          const e = new DOMException('Aborted', 'AbortError')
          throw e
        }
        return { content: '{}', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, durationMs: 0, model: 'stub' }
      },
    }
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)

    // abort BEFORE starting — F2b-1 will throw immediately
    ctrl.abort()

    const { runId, completion } = runAnalyzeRepo({ repoId, signal: ctrl.signal }, db)
    await completion.catch(() => {})
    spy.mockRestore()

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('cancelled')
  })
})
