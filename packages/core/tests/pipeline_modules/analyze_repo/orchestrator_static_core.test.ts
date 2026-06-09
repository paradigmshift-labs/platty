import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'

import { runAnalyzeRepo } from '@/pipeline_modules/analyze_repo/index.js'
import { repositories, projects } from '@/db/schema/core.js'
import { pipelineRuns, pipelineSteps } from '@/db/schema/pipeline_runs.js'
import * as registry from '@/llm/registry.js'
import type { LlmAdapter, LlmRequest, LlmResponse } from '@/llm/types.js'
import { createTestDb, type DB } from '../../server/helpers.js'
import { nanoid } from 'nanoid'

// static-core 리팩토링 (specs/analyze_repo/improvements/static-core-refactor.md):
// analyze_repo는 LLM fallback 없이 순수 정적으로 돈다. framework='other'/null이어도 'other' SKIP을
// 하지 않고 표준 슬롯을 추출·저장한다. LLM 호출은 어떤 경로에서도 0이어야 한다.

const TMP = resolve(process.cwd(), '.tmp-test-static-core')

function mkRepoDir(name: string, files: Record<string, string>): string {
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

async function setupRepo(db: DB, files: Record<string, string>): Promise<{ repoId: string }> {
  const projectId = nanoid()
  const repoId = nanoid()
  db.insert(projects).values({ id: projectId, name: 'test-project' }).run()
  const repoPath = mkRepoDir(`r-${repoId.slice(0, 6)}`, files)
  db.insert(repositories).values({ id: repoId, projectId, name: 'r', repoPath }).run()
  return { repoId }
}

// LLM 어댑터가 호출되면 즉시 실패하게 해서 "코어가 LLM을 절대 안 부른다"를 강제한다.
function makeForbiddenAdapter(): LlmAdapter & { calls: number } {
  const adapter: LlmAdapter & { calls: number } = {
    provider: 'claude_code', model: 'forbidden', calls: 0,
    async call(_req: LlmRequest): Promise<LlmResponse> {
      adapter.calls++
      throw new Error('LLM must NOT be called in analyze_repo static core')
    },
  }
  return adapter
}

describe('analyze_repo static core (LLM-free, no other-SKIP)', () => {
  let db: DB
  beforeAll(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }) })
  afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })
  beforeEach(() => { db = createTestDb() })

  it('S1: clear framework (react) → full static, 0 LLM', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'src' } }),
      'src/main.tsx': '', 'src/pages/Home.tsx': '',
    })
    const adapter = makeForbiddenAdapter()
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()
    expect(adapter.calls).toBe(0)
    expect(db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()?.status).toBe('done')
    expect(db.select().from(repositories).where(eq(repositories.id, repoId)).get()?.framework).toBe('react')
  })

  it("S3+S4: 'other' framework + tsconfig paths → NO SKIP, path_aliases persisted, 0 LLM", async () => {
    const { repoId } = await setupRepo(db, {
      // 프레임워크 의존성 없음 → 정적 framework='other'
      'package.json': JSON.stringify({ dependencies: { lodash: '^4.17.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { '@/*': ['./*'] } } }),
      'src/index.ts': '',
    })
    const adapter = makeForbiddenAdapter()
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()

    expect(adapter.calls).toBe(0)
    expect(db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()?.status).toBe('done')

    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('other')
    // ★ 핵심: 'other'여도 SKIP 안 하고 정적 슬롯을 채운다 (이전엔 persistOther로 NULL)
    expect(repo?.baseUrl).toBe('src')
    expect(repo?.pathAliases, 'other framework도 path_aliases를 버리지 않아야 함').toBeTruthy()
    expect(Object.keys(repo?.pathAliases ?? {}).length).toBeGreaterThan(0)

    const stepNames = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, runId)).all().map((s) => s.step)
    expect(stepNames).toContain('F2b-1:standard_slots') // 표준 슬롯 추출이 실행됨
    expect(stepNames).toContain('S8:persist')
    expect(stepNames).not.toContain('F2a-3:identity_llm')
    expect(stepNames).not.toContain('F2b-2:ambiguous_slots')
  })

  it('S6+S8: nestjs+prisma+custom decorator wrapper → 0 LLM, custom_decorators empty, orm persisted', async () => {
    const { repoId } = await setupRepo(db, {
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', prisma: '^5.0.0' } }),
      'tsconfig.json': '{}', 'src/main.ts': '', 'src/app.module.ts': '',
      'src/common/decorators/api-get.ts': "import { applyDecorators, Get } from '@nestjs/common'\nexport const ApiGet = applyDecorators(Get)",
      'prisma/schema.prisma': 'datasource db { provider = "postgresql" }',
    })
    const adapter = makeForbiddenAdapter()
    const spy = vi.spyOn(registry, 'getLlmAdapter').mockReturnValue(adapter)
    const { runId, completion } = runAnalyzeRepo({ repoId }, db)
    await completion
    spy.mockRestore()

    expect(adapter.calls).toBe(0)
    expect(db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).get()?.status).toBe('done')
    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('nestjs')
    expect(repo?.orm).toBe('prisma')
    // custom_decorators는 LLM 전용이었음 → 이제 항상 빈 값 (나중에 build_route 루프가 발견)
    expect(repo?.customDecorators ?? {}).toEqual({})
  })
})
