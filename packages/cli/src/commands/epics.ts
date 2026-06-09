import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  BuildEpicsCliRuntime,
  BuildEpicsSyncRuntime,
  buildBuildEpicsAgentWorkPacket,
  buildBuildEpicsSyncAgentWorkPacket,
  type BuildEpicsDraftEditInput,
  type BuildEpicsRuntimePolicyInput,
  type BuildEpicsRunnerPreset,
  type BuildEpicsRunnerProvider,
  type BuildEpicsTaskInvoker,
  type DB,
  runBuildEpicsSyncWorkerQueue,
  runBuildEpicsWorkerQueue,
  type OpenPlattyDbResult,
} from '@platty/core'
import { readProjectConfig } from '../config-store.js'
import { openCliDb } from '../db.js'
import { failure, success, type PlattyCommandResponse } from '../output.js'
import { requirePlattyRoot } from '../project-root.js'

export interface EpicsCommandOptions {
  cwd: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  project?: string
  epicsTaskInvoker?: BuildEpicsTaskInvoker
}

export async function runEpicsCommand(argv: string[], options: EpicsCommandOptions): Promise<PlattyCommandResponse> {
  const root = await requireProjectRoot(options.cwd, options)
  if ('exitCode' in root) return root

  const openedDb = options.db ? null : (options.openDb?.() ?? openCliDb())
  const db = options.db ?? openedDb!.db
  const runtime = new BuildEpicsCliRuntime({ db })

  try {
    const command = positional(argv)
    const projectId = options.project ?? root.config.currentProject?.id

    if (command[0] === 'sync') {
      if (!projectId) return projectNotSelected()
      const syncRuntime = new BuildEpicsSyncRuntime({ db })
      const syncCommand = command[1]
      if (syncCommand === 'preview') {
        return ok(await syncRuntime.preview({ projectId, docSyncPlanId: required(argv, '--doc-sync-plan-id') }))
      }
      if (syncCommand === 'start') {
        return ok(await syncRuntime.start({
          projectId,
          docSyncPlanId: required(argv, '--doc-sync-plan-id'),
          requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        }))
      }
      if (syncCommand === 'run') {
        const provider = providerValue(argv)
        if (provider !== 'codex_cli' && !options.epicsTaskInvoker) {
          return {
            exitCode: 2,
            result: failure('CLAUDE_CODE_HEADLESS_UNSUPPORTED', 'Claude Code is not available as a headless build_epics sync worker runner. Use epics sync worker next with Claude Code skill workers.'),
            stdout: '',
            stderr: '',
          }
        }
        const workDir = optionValue(argv, '--work-dir') ?? join(root.config.projectRoot, '.platty', 'tmp', 'build_epics_sync_runs')
        return ok(await runBuildEpicsSyncWorkerQueue({
          runtime: syncRuntime,
          projectId,
          docSyncPlanId: required(argv, '--doc-sync-plan-id'),
          runId: optionValue(argv, '--run-id'),
          provider,
          workers: numberValue(argv, '--workers', 20),
          requestedBy: optionValue(argv, '--requested-by') ?? 'user',
          workDir: resolve(options.cwd, workDir),
          taskInvoker: options.epicsTaskInvoker as never,
        }))
      }
      if (syncCommand === 'tasks' && command[2] === 'lease') {
        return ok(await syncRuntime.leaseTasks({
          runId: required(argv, '--run-id'),
          limit: numberValue(argv, '--limit', 1),
          workerId: optionValue(argv, '--worker-id') ?? 'worker:epics-sync:cli',
        }))
      }
      if (syncCommand === 'worker' && command[2] === 'next') {
        const runId = required(argv, '--run-id')
        const lease = await syncRuntime.leaseTasks({
          runId,
          limit: 1,
          workerId: optionValue(argv, '--worker-id') ?? 'worker:epics-sync:cli',
        })
        const task = lease.leasedTasks[0]
        if (!task) {
          const status = await syncRuntime.status({ runId })
          return ok({
            type: 'no_task_available',
            runId,
            runStatus: status.runStatus,
            remainingPendingTaskCount: lease.remainingPendingTaskCount,
          })
        }
        const context = await syncRuntime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
        const packet = buildBuildEpicsSyncAgentWorkPacket({ task, context: context as unknown as Record<string, unknown> })
        return ok(await writePacketIfRequested(argv, options.cwd, packet))
      }
      if (syncCommand === 'context' && command[2] === 'get') {
        return ok(await syncRuntime.getContext({ taskId: required(argv, '--task-id'), leaseToken: required(argv, '--lease-token') }))
      }
      if (syncCommand === 'tasks' && command[2] === 'submit') {
        return ok(await syncRuntime.submitTask({
          taskId: required(argv, '--task-id'),
          leaseToken: required(argv, '--lease-token'),
          result: await readJsonFile(required(argv, '--input')),
        }))
      }
      if (syncCommand === 'status') return ok(await syncRuntime.status({ runId: required(argv, '--run-id') }))
      if (syncCommand === 'draft' && command[2] === 'show') return ok(await syncRuntime.showDraft({ runId: required(argv, '--run-id') }))
      if (syncCommand === 'draft' && command[2] === 'confirm') {
        return ok(await syncRuntime.confirmDraft({
          runId: required(argv, '--run-id'),
          requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        }))
      }
      return { exitCode: 2, result: failure('UNKNOWN_COMMAND', `Unknown epics sync command: ${command.slice(1).join(' ')}`), stdout: '', stderr: '' }
    }

    if (command[0] === 'preview') {
      if (!projectId) return projectNotSelected()
      return ok(await runtime.preview({ projectId, outputLanguage: languageValue(argv) }))
    }
    if (command[0] === 'start') {
      if (!projectId) return projectNotSelected()
      const policy = await readJsonPolicy(optionValue(argv, '--policy'))
      return ok(await runtime.start({ projectId, policy, requestedBy: optionValue(argv, '--requested-by') ?? 'user' }))
    }
    if (command[0] === 'run') {
      if (!projectId) return projectNotSelected()
      const provider = providerValue(argv)
      if (provider !== 'codex_cli' && !options.epicsTaskInvoker) {
        return {
          exitCode: 2,
          result: failure('CLAUDE_CODE_HEADLESS_UNSUPPORTED', 'Claude Code is not available as a headless build_epics worker runner. Use codex_cli for epics run.'),
          stdout: '',
          stderr: '',
        }
      }
      const policy = await readJsonPolicy(optionValue(argv, '--policy'))
      const workDir = optionValue(argv, '--work-dir') ?? join(root.config.projectRoot, '.platty', 'tmp', 'build_epics_runs')
      return ok(await runBuildEpicsWorkerQueue({
        runtime,
        projectId,
        runId: optionValue(argv, '--run-id'),
        policy,
        provider,
        preset: presetValue(argv),
        workers: numberValue(argv, '--workers', 20),
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
        workDir: resolve(options.cwd, workDir),
        taskInvoker: options.epicsTaskInvoker,
      }))
    }
    if (command[0] === 'tasks' && command[1] === 'lease') {
      return ok(await runtime.leaseTasks({
        runId: required(argv, '--run-id'),
        limit: numberValue(argv, '--limit', 1),
        workerId: optionValue(argv, '--worker-id') ?? 'worker:cli',
      }))
    }
    if (command[0] === 'worker' && command[1] === 'next') {
      const runId = required(argv, '--run-id')
      const lease = await runtime.leaseTasks({
        runId,
        limit: 1,
        workerId: optionValue(argv, '--worker-id') ?? 'worker:epics:cli',
      })
      const task = lease.leasedTasks[0]
      if (!task) {
        const status = await runtime.status({ runId })
        return ok({
          type: 'no_task_available',
          runId,
          runStatus: status.runStatus,
          remainingPendingTaskCount: lease.remainingPendingTaskCount,
        })
      }
      const context = await runtime.getContext({ taskId: task.taskId, leaseToken: task.leaseToken })
      const packet = buildBuildEpicsAgentWorkPacket({ task, context: context as unknown as Record<string, unknown> })
      return ok(await writePacketIfRequested(argv, options.cwd, packet))
    }
    if (command[0] === 'context' && command[1] === 'get') {
      return ok(await runtime.getContext({ taskId: required(argv, '--task-id'), leaseToken: required(argv, '--lease-token') }))
    }
    if (command[0] === 'tasks' && command[1] === 'submit') {
      return ok(await runtime.submitTask({
        taskId: required(argv, '--task-id'),
        leaseToken: required(argv, '--lease-token'),
        result: await readJsonFile(required(argv, '--input')),
      }))
    }
    if (command[0] === 'status') return ok(await runtime.status({ runId: required(argv, '--run-id') }))
    if (command[0] === 'draft' && command[1] === 'edit') {
      const input = await readJsonFile(required(argv, '--input')) as BuildEpicsDraftEditInput
      return ok(await runtime.editDraft({
        runId: required(argv, '--run-id'),
        expectedVersion: input.expectedVersion,
        commands: input.commands,
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
      }))
    }
    if (command[0] === 'draft' && command[1] === 'confirm') {
      return ok(await runtime.confirmDraft({
        runId: required(argv, '--run-id'),
        requestedBy: optionValue(argv, '--requested-by') ?? 'user',
      }))
    }
    if (command[0] === 'draft' && command[1] === 'show') return ok(await runtime.showDraft({ runId: required(argv, '--run-id') }))
    if (command[0] === 'validate') return ok(await runtime.validate({ runId: required(argv, '--run-id') }))
    if (command[0] === 'cancel') return ok(await runtime.cancel({ runId: required(argv, '--run-id'), reason: optionValue(argv, '--reason') }))

    return { exitCode: 2, result: failure('UNKNOWN_COMMAND', `Unknown epics command: ${command.join(' ')}`), stdout: '', stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'epics command failed'
    return { exitCode: 1, result: failure('EPICS_COMMAND_FAILED', message), stdout: '', stderr: '' }
  } finally {
    openedDb?.close()
  }
}

async function requireProjectRoot(
  cwd: string,
  _options: EpicsCommandOptions,
): Promise<{ config: Awaited<ReturnType<typeof readProjectConfig>> } | PlattyCommandResponse> {
  const projectRoot = await requirePlattyRoot(cwd)
  if (!projectRoot) {
    return {
      exitCode: 2,
      result: failure('PROJECT_ROOT_NOT_FOUND', 'Platty project root was not found'),
      stdout: '',
      stderr: '',
    }
  }
  return { config: await readProjectConfig(projectRoot) }
}

function ok(data: unknown): PlattyCommandResponse {
  return { exitCode: 0, result: success(data), stdout: '', stderr: '' }
}

function projectNotSelected(): PlattyCommandResponse {
  return {
    exitCode: 2,
    result: failure('PROJECT_NOT_SELECTED', 'No Platty project is selected'),
    stdout: '',
    stderr: '',
  }
}

function positional(argv: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (part === '--json') continue
    if (part.startsWith('--')) {
      index += 1
      continue
    }
    values.push(part)
  }
  return values
}

function optionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index === -1 ? undefined : argv[index + 1]
  return value && !value.startsWith('--') ? value : undefined
}

function required(argv: string[], flag: string): string {
  const value = optionValue(argv, flag)
  if (!value) throw new Error(`${flag} is required`)
  return value
}

function numberValue(argv: string[], flag: string, fallback: number): number {
  const value = optionValue(argv, flag)
  return value ? Number(value) : fallback
}

function languageValue(argv: string[]): 'ko' | 'en' {
  return optionValue(argv, '--language') === 'en' ? 'en' : 'ko'
}

function providerValue(argv: string[]): BuildEpicsRunnerProvider {
  const provider = optionValue(argv, '--provider') ?? 'codex_cli'
  if (provider !== 'codex_cli' && provider !== 'claude_code') throw new Error(`Unsupported --provider: ${provider}`)
  return provider
}

function presetValue(argv: string[]): BuildEpicsRunnerPreset | undefined {
  const preset = optionValue(argv, '--preset')
  if (preset === undefined) return undefined
  if (preset !== 'final-mixed' && preset !== 'balanced') throw new Error(`Unsupported --preset: ${preset}`)
  return preset
}

async function readJsonPolicy(path: string | undefined): Promise<BuildEpicsRuntimePolicyInput> {
  if (!path) return {}
  return await readJsonFile(path) as BuildEpicsRuntimePolicyInput
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writePacketIfRequested(argv: string[], cwd: string, packet: unknown): Promise<unknown> {
  const outPath = optionValue(argv, '--out')
  if (!outPath) return packet
  const resolved = resolve(cwd, outPath)
  await mkdir(dirname(resolved), { recursive: true })
  await writeFile(resolved, `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
  return typeof packet === 'object' && packet !== null && !Array.isArray(packet)
    ? { ...packet, packetPath: resolved }
    : { type: 'packet', packetPath: resolved }
}
