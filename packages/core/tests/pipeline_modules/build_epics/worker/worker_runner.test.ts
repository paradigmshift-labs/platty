import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeBuildEpicsRunnerResult,
  resolveBuildEpicsRunnerModelPolicy,
  runBuildEpicsWorkerQueue,
} from '@/pipeline_modules/build_epics/worker/worker_runner.js'

describe('runBuildEpicsWorkerQueue', () => {
  it('resumes the latest interrupted run before creating a new one', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'platty-epics-worker-'))
    let startCalled = false
    const runtime = {
      resumeLatestInterruptedRun: async () => ({ runId: 'gen:epics:interrupted', status: 'running', policy: {} }),
      preview: async () => ({ recommendedPolicy: {} }),
      start: async () => {
        startCalled = true
        throw new Error('should not start')
      },
      leaseTasks: async () => ({ leasedTasks: [], remainingPendingTaskCount: 0 }),
      status: async () => ({ runStatus: 'completed', draftStatus: 'ready', taskCountsByStatus: {} }),
      showDraft: async () => ({ plan: { domains: [], epics: [], reviewBuckets: {} } }),
      validate: async () => ({ fatal: [], warnings: [] }),
    }

    try {
      const result = await runBuildEpicsWorkerQueue({
        runtime: runtime as any,
        projectId: 'project:test',
        workers: 1,
        workDir,
        taskInvoker: async () => null,
      })

      expect(result.runId).toBe('gen:epics:interrupted')
      expect(startCalled).toBe(false)
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})

describe('build_epics worker runner policy', () => {
  it('uses the validated Codex final mixed model policy', () => {
    const policy = resolveBuildEpicsRunnerModelPolicy({ provider: 'codex_cli', preset: 'final-mixed' })

    expect(policy).toEqual({
      taxonomy_candidate: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'low' },
      taxonomy_consolidation: { provider: 'codex_cli', model: 'gpt-5.4', effort: 'medium' },
      document_assignment: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
      cross_domain_link: { provider: 'codex_cli', model: 'gpt-5.4-mini', effort: 'low' },
    })
  })

  it('keeps Claude and Codex presets on separate provider policies', () => {
    const policy = resolveBuildEpicsRunnerModelPolicy({ provider: 'claude_code', preset: 'balanced' })

    expect(policy).toEqual({
      taxonomy_candidate: { provider: 'claude_code', model: 'claude-sonnet-4-6' },
      taxonomy_consolidation: { provider: 'claude_code', model: 'claude-sonnet-4-6' },
      document_assignment: { provider: 'claude_code', model: 'claude-haiku-4-5' },
      cross_domain_link: { provider: 'claude_code', model: 'claude-haiku-4-5' },
    })
  })
})

describe('build_epics worker runner result normalization', () => {
  it('forces API assignments to owner and removes duplicate API owners', () => {
    const { result, stats } = normalizeBuildEpicsRunnerResult({
      assignments: [
        { documentId: 'api:orders', epicKey: 'orders', role: 'primary', confidence: 'high', reason: 'Orders.' },
        { documentId: 'api:orders', epicKey: 'orders', role: 'supporting', confidence: 'high', reason: 'Duplicate.' },
        { documentId: 'screen:orders', epicKey: 'orders', role: 'primary', confidence: 'high', reason: 'Screen.' },
      ],
    }, {
      taskType: 'document_assignment',
      cards: [
        { documentId: 'api:orders', type: 'api_spec' },
        { documentId: 'screen:orders', type: 'screen_spec' },
      ],
    })

    expect(result).toEqual({
      assignments: [
        { documentId: 'api:orders', epicKey: 'orders', role: 'owner', confidence: 'high', reason: 'Orders.' },
        { documentId: 'screen:orders', epicKey: 'orders', role: 'primary', confidence: 'high', reason: 'Screen.' },
      ],
    })
    expect(stats).toEqual({
      apiRoleFixed: 1,
      duplicateApiOwnerRemoved: 1,
      selfCrossLinkRemoved: 0,
      duplicateCrossLinkRemoved: 0,
    })
  })

  it('removes self cross-links and duplicate cross-links', () => {
    const { result, stats } = normalizeBuildEpicsRunnerResult({
      links: [
        { sourceDocumentId: 'api:orders', targetTempEpicId: 'epic:orders', kind: 'state_change', role: 'impact', confidence: 'high', reason: 'Self.' },
        { sourceDocumentId: 'api:orders', targetTempEpicId: 'epic:rewards', kind: 'state_change', role: 'impact', confidence: 'high', reason: 'Reward.' },
        { sourceDocumentId: 'api:orders', targetTempEpicId: 'epic:rewards', kind: 'state_change', role: 'impact', confidence: 'high', reason: 'Duplicate.' },
      ],
    }, {
      taskType: 'cross_domain_link',
      owners: { 'api:orders': 'epic:orders' },
    })

    expect(result).toEqual({
      links: [
        { sourceDocumentId: 'api:orders', targetTempEpicId: 'epic:rewards', kind: 'state_change', role: 'impact', confidence: 'high', reason: 'Reward.' },
      ],
    })
    expect(stats).toEqual({
      apiRoleFixed: 0,
      duplicateApiOwnerRemoved: 0,
      selfCrossLinkRemoved: 1,
      duplicateCrossLinkRemoved: 1,
    })
  })
})
