import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq, and } from 'drizzle-orm'

import { runAnalyzeRepo, AnalyzeRepoError } from '@/pipeline_modules/analyze_repo/index.js'
import { repositories, repositoryPhaseStatus, projects } from '@/db/schema/core.js'
import { pipelineEvents, pipelineRuns, pipelineSteps } from '@/db/schema/pipeline_runs.js'
import * as registry from '@/llm/registry.js'
import * as slotsMod from '@/pipeline_modules/analyze_repo/f2b_extract_standard_slots.js'
import type { LlmAdapter, LlmRequest, LlmResponse } from '@/llm/types.js'
import { createTestDb, type DB } from '../../server/helpers.js'
import { nanoid } from 'nanoid'

const TMP = resolve(process.cwd(), '.tmp-test-orch-v2')

function mkRepoDir(name: string, files: Record<string, string> = {}): string {
  const repoPath = join(TMP, name)
  rmSync(repoPath, { recursive: true, force: true })
  mkdirSync(repoPath, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel)
    mkdirSync(resolve(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['add', '.'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['-c', 'user.name=Platty Test', '-c', 'user.email=platty@example.test', 'commit', '-m', 'init'], { cwd: repoPath, stdio: 'ignore' })
  return repoPath
}

async function setupRepo(db: DB, files: Record<string, string> = {}): Promise<{ repoId: string; repoPath: string }> {
  const projectId = nanoid()
  const repoId = nanoid()
  db.insert(projects).values({ id: projectId, name: 'test-project' }).run()
  const repoPath = mkRepoDir(`r-${repoId.slice(0, 6)}`, files)
  db.insert(repositories).values({ id: repoId, projectId, name: 'r', repoPath }).run()
  return { repoId, repoPath }
}

function makeStubAdapter(responses: string[]): LlmAdapter & { calls: number } {
  let i = 0
  const adapter: LlmAdapter & { calls: number } = {
    provider: 'claude_code', model: 'claude-sonnet-4-6', calls: 0,
    async call(_req: LlmRequest): Promise<LlmResponse> {
      adapter.calls++
      const text = responses[Math.min(i, responses.length - 1)]
      i++
      return { content: text, usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.001, durationMs: 50, model: 'claude-sonnet-4-6' }
    },
  }
  return adapter
}

describe('runAnalyzeRepo v2', () => {
  let db: DB

  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true })
  })
  beforeEach(() => {
    db = createTestDb()
  })

  // ─────────────────────────────────────────────────
  // O1: 카테고리 A — react no_router (모든 needsLLM=false)
  // ─────────────────────────────────────────────────
  it('O1: 카테고리 A — react no_router → LLM 콜 0', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
      'tsconfig.json': '{"compilerOptions":{"baseUrl":"src"}}',
      'src/main.tsx': '',
      'src/pages/Home.tsx': '',
    })
    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId, triggeredBy: 'user' }, db)
    await completion
    spy.mockRestore()

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('done')

    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('react')
    expect(repo?.type).toBe('frontend')

    // F2a-3 step 미생성
    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all()
    const stepNames = steps.map((s) => s.step)
    expect(stepNames).not.toContain('F2a-3:identity_llm')
    expect(stepNames).not.toContain('F2b-2:ambiguous_slots')

    // ★ N5: F2b-3:merge step 존재 + status='done'
    const mergeStep = steps.find((s) => s.step === 'F2b-3:merge')
    expect(mergeStep, 'F2b-3:merge step must exist').toBeDefined()
    expect(mergeStep?.status).toBe('done')

    // ★ H4: LLM 콜 횟수 단언 — A 카테고리 = 0콜
    expect(adapter.calls).toBe(0)
  })

  // ─────────────────────────────────────────────────
  // O2: nestjs+prisma+custom decorator → static-core, 0 LLM, orm/schema 저장
  // ─────────────────────────────────────────────────
  it('O2: nestjs+prisma (custom decorator wrapper) → 0 LLM, orm/schemaSources 저장', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', prisma: '^5.0.0' } }),
      'tsconfig.json': '{}',
      'src/main.ts': '',
      'src/app.module.ts': '',
      'src/x/x.controller.ts': '',
      'src/common/decorators/api-get.ts': "import { applyDecorators, Get } from '@nestjs/common'\nexport const ApiGet = applyDecorators(Get)",
      'prisma/schema.prisma': 'datasource db { provider = "postgresql" }',
    })
    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()

    expect(db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()?.status).toBe('done')
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('nestjs')
    expect(repo?.schemaSources?.[0]?.orm).toBe('prisma')
    expect(repo?.orm).toBe('prisma') // ★ H1: orm DB 컬럼 저장 검증
    expect(repo?.customDecorators ?? {}).toEqual({}) // custom_decorators는 static-core에서 항상 빈 값

    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all()
    const stepNames = steps.map((s) => s.step)
    const mergeStep = steps.find((s) => s.step === 'F2b-3:merge')
    expect(mergeStep?.status).toBe('done')
    expect(stepNames).not.toContain('F2b-2:ambiguous_slots')

    // ★ static-core: LLM 0콜
    expect(adapter.calls).toBe(0)
  })

  // ─────────────────────────────────────────────────
  // O3: monorepo (nestjs+next workspaces) → static-core, 0 LLM, LLM step 없음
  // ─────────────────────────────────────────────────
  it('O3: monorepo (nestjs+next workspaces) → 0 LLM, 정적 framework 확정', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({
        workspaces: ['packages/*'],
        dependencies: { '@nestjs/core': '^10', next: '^14', react: '^18' },
      }),
      'tsconfig.json': '{}',
      'src/main.ts': '',
      'src/app.module.ts': '',
      'src/x/x.controller.ts': '',
      'src/common/decorators/api-get.ts': "import { applyDecorators, Get } from '@nestjs/common'\nexport const ApiGet = applyDecorators(Get)",
      'app/page.tsx': '',
      'next.config.js': 'module.exports = { basePath: "/api" }',
    })
    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('done')

    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all()
    const stepNames = steps.map((s) => s.step)
    expect(stepNames).not.toContain('F2a-3:identity_llm')
    expect(stepNames).not.toContain('F2b-2:ambiguous_slots')
    // gateway 이벤트 0 (LLM 미사용)
    const gatewayEvents = db.select().from(pipelineEvents).where(eq(pipelineEvents.runId, runId)).all()
      .filter((event) => event.messageKey?.startsWith('pipeline.llm_gateway.'))
    expect(gatewayEvents).toEqual([])

    expect(adapter.calls).toBe(0)

    // monorepo(혼합 framework)는 LLM 없이는 단일 framework로 정적 확정 불가 → canonical 'other'.
    // (발현엔진은 framework='other'여도 decorator/handler 증거로 라우트를 발동하므로 라벨 손실은 허용.)
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('other')
    // 'other'여도 SKIP 안 함 → 표준 슬롯/persist 실행됨
    expect(stepNames).toContain('F2b-1:standard_slots')
    expect(stepNames).toContain('S8:persist')
  })

  // ─────────────────────────────────────────────────
  // O4: Go (framework=other) → static-core, NO SKIP, 표준 슬롯 실행, 0 LLM
  // ─────────────────────────────────────────────────
  it('O4: Go (framework=other) → SKIP 없이 F2b-1/merge/persist 실행, 0 LLM', async () => {
    const { repoId } = await setupRepo(db, {
      'go.mod': 'module example.com/x\ngo 1.21\n',
      'main.go': 'package main',
    })
    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()

    expect(db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()?.status).toBe('done')
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('other') // canonical 'other' (null 아님)

    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all()
    const stepNames = steps.map((s) => s.step)
    expect(stepNames).not.toContain('F2a-3:identity_llm')
    // ★ static-core: 'other'여도 SKIP 안 함 — 표준 슬롯/merge/persist 실행
    expect(stepNames).toContain('F2b-1:standard_slots')
    expect(stepNames).toContain('F2b-3:merge')
    expect(stepNames).toContain('S8:persist')
    expect(adapter.calls).toBe(0)
  })

  // ─────────────────────────────────────────────────
  // O8: AbortSignal cancel → run.status='cancelled'
  // ─────────────────────────────────────────────────
  it('O8: abort signal → run.status=cancelled', async () => {
    const { repoId } = await setupRepo(db, { 'go.mod': 'module x' })
    const ctrl = new AbortController()
    const adapter: LlmAdapter = {
      provider: 'claude_code', model: 'stub',
      async call(req: LlmRequest): Promise<LlmResponse> {
        // signal abort 후 호출되면 즉시 throw
        if (req.signal?.aborted || ctrl.signal.aborted) {
          const e = new Error('aborted'); ;(e as Error & { name: string }).name = 'AbortError'
          throw e
        }
        return { content: '{}', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, durationMs: 0, model: 'stub' }
      },
    }
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    ctrl.abort() // 시작 전 abort
    const { runId, completion } = runAnalyzeRepo({ repoId, signal: ctrl.signal }, db)
    await completion.catch(() => {})
    spy.mockRestore()

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('cancelled')
  })

  // ─────────────────────────────────────────────────
  // O11: REPO_NOT_FOUND
  // ─────────────────────────────────────────────────
  it('O11: 잘못된 repoId → throw REPO_NOT_FOUND', () => {
    expect(() => runAnalyzeRepo({ repoId: 'nonexistent' }, db)).toThrow(AnalyzeRepoError)
  })

  // ─────────────────────────────────────────────────
  // O13: 동시 실행 차단
  // ─────────────────────────────────────────────────
  it('O13: status=running run 진행 중 → throw RUN_IN_PROGRESS', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'tsconfig.json': '{}', 'src/main.tsx': '', 'src/pages/Home.tsx': '',
    })
    // projectId는 setupRepo가 만든 것 사용
    const repoRow = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    db.insert(pipelineRuns).values({
      id: 'fake-running', projectId: repoRow!.projectId, repoId, kind: 'analyze_repo', status: 'running',
      totalSteps: 9, completedSteps: 0,
    } as never).run()

    expect(() => runAnalyzeRepo({ repoId }, db)).toThrow(/RUN_IN_PROGRESS|in progress/)
  })

  // ─────────────────────────────────────────────────
  // O7: 정적 단계(F2b-1)가 non-Error로 실패해도 run.status=failed + errorMessage 기록
  // ─────────────────────────────────────────────────
  it('O7: extractStandardSlots가 non-Error로 실패해도 run.status=failed로 기록', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
      'tsconfig.json': '{}',
      'src/main.ts': '',
      'src/app.module.ts': '',
    })
    const slotsSpy = vi.spyOn(slotsMod, 'extractStandardSlots').mockRejectedValue('slots failed')

    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion.catch(() => undefined)
    slotsSpy.mockRestore()

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('failed')
    expect(run?.errorMessage).toBe('slots failed')
  })

  // ─────────────────────────────────────────────────
  // O9: 재실행 → repository_phase_status UPSERT (1 row)
  // ─────────────────────────────────────────────────
  it('O9: 재실행 → phase_status UPSERT (1 row), pipeline_runs 2 rows', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'tsconfig.json': '{}', 'src/main.tsx': '', 'src/pages/Home.tsx': '',
    })
    for (let i = 0; i < 2; i++) {
      const adapter = makeStubAdapter([])
      const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
      const { completion } = runAnalyzeRepo({ repoId }, db)
      await completion
      spy.mockRestore()
      expect(adapter.calls).toBe(0)
    }
    const phases = db.select().from(repositoryPhaseStatus)
      .where(and(eq(repositoryPhaseStatus.repositoryId, repoId), eq(repositoryPhaseStatus.phase, 'analyze_repo')))
      .all()
    expect(phases).toHaveLength(1)
    const runs = db.select().from(pipelineRuns).where(eq(pipelineRuns.repoId, repoId)).all()
    expect(runs).toHaveLength(2)
  })

  // ─────────────────────────────────────────────────
  // O12: runId 즉시 반환 (RunHandle)
  // ─────────────────────────────────────────────────
  it('O12: runId 즉시 반환 + completion Promise 따로', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'tsconfig.json': '{}', 'src/main.tsx': '', 'src/pages/Home.tsx': '',
    })
    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const handle = runAnalyzeRepo({ repoId }, db)
    expect(handle.runId).toBeTruthy()
    expect(handle.completion).toBeInstanceOf(Promise)
    await handle.completion
    spy.mockRestore()
    expect(adapter.calls).toBe(0)
  })

  // ─────────────────────────────────────────────────
  // O14: framework=null → SKIP (other와 동일)
  // ─────────────────────────────────────────────────
  it('O14: 매니페스트 0개 + LLM이 other 확정 → SKIP', async () => {
    const { repoId } = await setupRepo(db, { 'README.md': '' })
    const adapter = makeStubAdapter([
      JSON.stringify({ framework: 'other', framework_raw: 'unknown', type: null, reasoning: 'no manifest' }),
    ])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('done')
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('other')
  })

  it('O14-b: 매니페스트 0개(미인식) → framework=other canonical 저장, 0 LLM', async () => {
    const { repoId } = await setupRepo(db, { 'README.md': '' })
    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)

    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()

    expect(adapter.calls).toBe(0)
    expect(db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()?.status).toBe('done')
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('other') // null 아닌 canonical 'other'
  })

  // ─────────────────────────────────────────────────
  // O15: persist 트랜잭션 — 정상 흐름은 commit
  // ─────────────────────────────────────────────────
  it('O15: persist 트랜잭션 — repositories + phase_status atomically updated', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'tsconfig.json': '{}', 'src/main.tsx': '', 'src/pages/Home.tsx': '',
    })
    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()
    expect(adapter.calls).toBe(0)
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    const phase = db.select().from(repositoryPhaseStatus)
      .where(and(eq(repositoryPhaseStatus.repositoryId, repoId), eq(repositoryPhaseStatus.phase, 'analyze_repo'))).get()
    expect(repo?.framework).toBe('react')
    expect(phase?.builtAt).toBeTruthy()
    expect(phase?.validity).toBe('fresh')
  })

  // ─────────────────────────────────────────────────
  // ★ N5 — O17: mergeStackInfo Zod 실패 → F2b-3:merge step status='failed'
  // ─────────────────────────────────────────────────
  it('O17: mergeStackInfo Zod 실패 → F2b-3:merge step status=failed + error_message 포함', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
      'tsconfig.json': '{}',
      'src/main.ts': '',
      'src/app.module.ts': '',
    })

    const adapter = makeStubAdapter([])
    const registrySpy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)

    // 정적 슬롯 추출이 path traversal을 포함한 결과를 내면 mergeStackInfo의 StackInfoSchema가 거부 → Zod throw
    const slotsSpy = vi.spyOn(slotsMod, 'extractStandardSlots').mockResolvedValue({
      path_aliases: {}, base_url: null, entrypoint_files: [],
      routing_files: ['../etc/passwd'], // 위험 경로 → StackInfoSchema.superRefine 거부
      routing_libs: [], schema_sources: [],
      needsLLMRouting: false, needsLLMCustomDecorators: false,
    })

    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion.catch(() => {}) // Zod throw → run.finish('failed') 예상
    registrySpy.mockRestore()
    slotsSpy.mockRestore()

    // run status='failed'
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('failed')

    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all()

    // F2b-3:merge step row가 생성되었어야 함
    const mergeStep = steps.find((s) => s.step === 'F2b-3:merge')
    expect(mergeStep, 'F2b-3:merge step must exist even on Zod failure').toBeDefined()
    expect(mergeStep?.status).toBe('failed')
    expect(mergeStep?.errorMessage).toMatch(/Zod/)

    // S8 step은 생성되지 않아야 함 (merge 실패로 중단)
    const stepNames = steps.map((s) => s.step)
    expect(stepNames).not.toContain('S8:persist')
  })

  // ─────────────────────────────────────────────────
  // ★ T2 — O18: SOT 워닝 DB 누적 검증
  //   computeSotWarnings 룰 (코드 SOT):
  //     Rule 1: flutter + routing_libs=[] → {field:'routing_libs', severity:'low'}
  //     Rule 3: type!='backend' + routing_files=[] + routing_libs=[] → {field:'routing_files', severity:'medium'}
  // ─────────────────────────────────────────────────

  // O18-a: nestjs(backend) → backend는 Rule3 대상 외 → routing_files 워닝 없음 + status=done
  it('O18-a: nestjs backend → Rule3 비대상 → routing_files 워닝 없음 + status=done', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
      'tsconfig.json': '{}',
      'src/main.ts': '',
      'src/app.module.ts': '',
    })

    const adapter = makeStubAdapter([])
    const registrySpy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)

    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    registrySpy.mockRestore()
    expect(adapter.calls).toBe(0)

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('done')

    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('nestjs')
    const warnings = repo?.validationWarnings as Array<{ field: string; message: string; severity: string }> | null
    // backend → routing_files 워닝 없어야 함
    const routingWarn = warnings?.find((w) => w.field === 'routing_files')
    expect(routingWarn).toBeUndefined()
  })

  // O18-b: react(frontend) + routing_files=[] + routing_libs=[] → Rule 3 워닝 → DB 누적
  it('O18-b: react frontend routing_files=[] routing_libs=[] → Rule3 SOT 워닝 DB 누적 + status=done', async () => {
    // react 리포 — router lib 없음 → needsLLMRouting=false → routing_files=[] (의도적 no-router)
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
      'tsconfig.json': '{}',
      'src/main.tsx': '',
      'src/pages/Home.tsx': '',
      // router lib 없음 → routing_files=[] routing_libs=[]
    })

    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)

    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()
    expect(adapter.calls).toBe(0)

    // pipeline_runs.status='done'
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('done')

    // F2b-3:merge step 정상 완료
    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all()
    const mergeStep = steps.find((s) => s.step === 'F2b-3:merge')
    expect(mergeStep?.status).toBe('done')

    // repositories.validation_warnings에 Rule 3 워닝 포함
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('react')
    expect(repo?.type).toBe('frontend')
    const warnings = repo?.validationWarnings as Array<{ field: string; message: string; severity: string }> | null
    expect(warnings).not.toBeNull()
    const routingWarn = warnings?.find((w) => w.field === 'routing_files')
    expect(routingWarn, 'routing_files SOT 워닝 누락').toBeDefined()
    expect(routingWarn?.severity).toBe('medium')
  })

  // O18-c: flutter(mobile) + routing_libs=[] + routing_files=[] → Rule1 + Rule3 복수 워닝 → DB 누적
  it('O18-c: flutter mobile routing_libs=[] routing_files=[] → Rule1+Rule3 복수 SOT 워닝 DB 누적', async () => {
    // flutter 리포 — GoRouter 패턴 없는 dart 파일 → routing_files=[]
    // routing_libs는 flutter adapter가 반환 안 함 (standard.routing_libs=[])
    // → Rule1 (routing_libs, low) + Rule3 (routing_files, medium) 동시 발화
    const { repoId } = await setupRepo(db, {
      'pubspec.yaml': [
        'name: my_flutter_app',
        'environment:',
        '  sdk: ">=3.0.0 <4.0.0"',
        'dependencies:',
        '  flutter:',
        '    sdk: flutter',
      ].join('\n'),
      'lib/main.dart': 'void main() { runApp(const MyApp()); }',
      'lib/screens/home_screen.dart': 'class HomeScreen extends StatelessWidget {}',
      // GoRouter/AutoRoute 없음 → routing_files=[]
    })

    const adapter = makeStubAdapter([])
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)

    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()
    expect(adapter.calls).toBe(0)

    // pipeline_runs.status='done'
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()
    expect(run?.status).toBe('done')

    // F2b-3:merge step 정상 완료
    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all()
    const mergeStep = steps.find((s) => s.step === 'F2b-3:merge')
    expect(mergeStep?.status).toBe('done')

    // repositories.validation_warnings에 Rule1 + Rule3 워닝 모두 포함 (2개 이상)
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('flutter')
    expect(repo?.type).toBe('mobile')
    const warnings = repo?.validationWarnings as Array<{ field: string; message: string; severity: string }> | null
    expect(warnings).not.toBeNull()
    expect(warnings!.length).toBeGreaterThanOrEqual(2)

    // Rule 1: routing_libs 워닝 (low)
    const routingLibsWarn = warnings?.find((w) => w.field === 'routing_libs')
    expect(routingLibsWarn, 'routing_libs SOT 워닝 누락 (Rule 1)').toBeDefined()
    expect(routingLibsWarn?.severity).toBe('low')

    // Rule 3: routing_files 워닝 (medium)
    const routingFilesWarn = warnings?.find((w) => w.field === 'routing_files')
    expect(routingFilesWarn, 'routing_files SOT 워닝 누락 (Rule 3)').toBeDefined()
    expect(routingFilesWarn?.severity).toBe('medium')
  })

  // ─────────────────────────────────────────────────
  // ★ T4 — O19: confirmed_at 보존 회귀 안전망
  //   repository_phase_status.confirmed_at은 사용자가 확정한 시각 —
  //   재분석(onConflictDoUpdate) 시 절대 덮어쓰지 않아야 함.
  // ─────────────────────────────────────────────────

  // O19-a: 정상 흐름에서 confirmed_at 보존
  it('O19-a — 재분석 시 confirmed_at은 그대로 보존된다', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
      'tsconfig.json': '{}',
      'src/main.tsx': '',
      'src/pages/Home.tsx': '',
    })

    // 1. 첫 번째 분석
    const adapter1 = makeStubAdapter([])
    const spy1 = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter1)
    const { completion: c1 } = runAnalyzeRepo({ repoId }, db)
    await c1
    spy1.mockRestore()
    expect(adapter1.calls).toBe(0)

    // 2. 사용자 "확정" 버튼 시뮬레이션 — confirmed_at 직접 박기
    const fixedTime = '2025-09-11T10:00:00.000Z'
    db.update(repositoryPhaseStatus)
      .set({ confirmedAt: fixedTime })
      .where(and(eq(repositoryPhaseStatus.repositoryId, repoId), eq(repositoryPhaseStatus.phase, 'analyze_repo')))
      .run()

    // confirmed_at이 실제로 들어갔는지 중간 확인
    const mid = db.select().from(repositoryPhaseStatus)
      .where(and(eq(repositoryPhaseStatus.repositoryId, repoId), eq(repositoryPhaseStatus.phase, 'analyze_repo')))
      .get()
    expect(mid?.confirmedAt).toBe(fixedTime)

    // 3. 재분석
    const adapter2 = makeStubAdapter([])
    const spy2 = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter2)
    const { completion: c2 } = runAnalyzeRepo({ repoId }, db)
    await c2
    spy2.mockRestore()
    expect(adapter2.calls).toBe(0)

    // 4. 검증
    const after = db.select().from(repositoryPhaseStatus)
      .where(and(eq(repositoryPhaseStatus.repositoryId, repoId), eq(repositoryPhaseStatus.phase, 'analyze_repo')))
      .get()
    expect(after?.confirmedAt).toBe(fixedTime)            // 그대로 보존
    expect(after?.builtAt).toBeTruthy()                   // builtAt은 갱신됨
    expect(after?.builtAt).not.toBe(fixedTime)            // 다른 시각으로 갱신
    expect(after?.validity).toBe('fresh')                 // validity도 정상 갱신
  })

  // O19-b: confirmed_at=null 상태에서 재분석 → 여전히 null
  it('O19-b — confirmed_at이 null이면 재분석 후에도 null', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
      'tsconfig.json': '{}',
      'src/main.tsx': '',
      'src/pages/Home.tsx': '',
    })

    // 1. 첫 번째 분석 (confirmedAt은 자동으로 null)
    const adapter1 = makeStubAdapter([])
    const spy1 = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter1)
    const { completion: c1 } = runAnalyzeRepo({ repoId }, db)
    await c1
    spy1.mockRestore()
    expect(adapter1.calls).toBe(0)

    // 2. 재분석 (confirmed_at set 없이)
    const adapter2 = makeStubAdapter([])
    const spy2 = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter2)
    const { completion: c2 } = runAnalyzeRepo({ repoId }, db)
    await c2
    spy2.mockRestore()
    expect(adapter2.calls).toBe(0)

    // 3. 검증: confirmed_at === null
    const after = db.select().from(repositoryPhaseStatus)
      .where(and(eq(repositoryPhaseStatus.repositoryId, repoId), eq(repositoryPhaseStatus.phase, 'analyze_repo')))
      .get()
    expect(after?.confirmedAt).toBeNull()
  })

})
