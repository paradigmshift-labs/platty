import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'

import { createTestDb } from '../../server/helpers.js'
import { projects, repositories } from '@/db/schema/core.js'
import { pipelineRuns, pipelineSteps } from '@/db/schema/pipeline_runs.js'
import { runAnalyzeRepo } from '@/pipeline_modules/analyze_repo/index.js'
import type { LlmOverride } from '@/observability/index.js'

const TMP = resolve(process.cwd(), '.tmp-test-analyze-repo-index')

function createRepo(name: string, files: Record<string, string>): string {
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

function insertRepo(db: ReturnType<typeof createTestDb>, repoPath: string): string {
  db.insert(projects).values({ id: 'p1', name: 'Project' }).run()
  db.insert(repositories).values({ id: 'r1', projectId: 'p1', name: 'Repo', repoPath }).run()
  return 'r1'
}

function throwingLlmOverride(): LlmOverride {
  return () => ({
    provider: 'claude_code',
    model: 'throwing',
    async call() {
      throw new Error('LLM should not be called for deterministic analyze_repo path')
    },
  })
}

describe('runAnalyzeRepo', () => {
  it('does not run F2c LLM review on deterministic Flutter analysis', async () => {
    rmSync(TMP, { recursive: true, force: true })
    const repoPath = createRepo('flutter-get-utils', {
      'pubspec.yaml': [
        'name: flutter_get_utils',
        'dependencies:',
        '  flutter:',
        '    sdk: flutter',
        '  get: 4.7.2',
      ].join('\n'),
      'lib/main.dart': [
        "import 'package:flutter/material.dart';",
        "import 'package:get/utils.dart';",
        'void main() => runApp(const App());',
        'class App extends StatelessWidget {',
        '  const App({super.key});',
        '  @override',
        '  Widget build(BuildContext context) => MaterialApp(onGenerateRoute: AppRouter.onGenerateRoute);',
        '}',
        'class AppRouter {',
        '  static Route<dynamic>? onGenerateRoute(RouteSettings settings) => MaterialPageRoute(builder: (_) => const SizedBox());',
        '}',
      ].join('\n'),
    })
    const db = createTestDb()
    const repoId = insertRepo(db, repoPath)

    const handle = runAnalyzeRepo({ repoId, llmOverride: throwingLlmOverride() }, db)
    await handle.completion

    const repo = db.select().from(repositories).where(eq(repositories.id, repoId)).get()
    expect(repo?.framework).toBe('flutter')
    expect(repo?.language).toBe('dart')
    expect(repo?.routingLibs).toEqual(['get'])

    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, handle.runId)).get()
    expect(run?.status).toBe('done')
    const steps = db.select().from(pipelineSteps).where(eq(pipelineSteps.runId, handle.runId)).all()
    expect(steps.map((step) => step.step)).not.toContain('F2c:review_stack')
  })
})
