#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BuildEpicsTaskInvoker, BusinessDocsTaskInvoker, DB, OpenPlattyDbResult } from '@platty/core'
import { commandLabel, hasFlag } from './argv.js'
import { failure, renderJson, renderText, type PlattyCommandResponse } from './output.js'
import { runPlattyCommanderDispatch } from './program.js'

export interface StaticPipelineRunnerInput {
  db: DB
  projectId: string
  stepOnly?: boolean
}

export type StaticPipelineRunner = (input: StaticPipelineRunnerInput) => Promise<unknown>

export interface PlattyCommandRunOptions {
  cwd?: string
  db?: DB
  openDb?: () => OpenPlattyDbResult
  analyticsRecorder?: null
  now?: () => Date
  staticPipelineRunner?: StaticPipelineRunner
  epicsTaskInvoker?: BuildEpicsTaskInvoker
  businessDocsTaskInvoker?: BusinessDocsTaskInvoker
}

export async function runPlattyCommand(argv: string[], options: PlattyCommandRunOptions = {}): Promise<PlattyCommandResponse> {
  const json = hasFlag(argv, '--json')
  const command = commandLabel(argv)

  try {
    const response = await runPlattyCommanderDispatch(argv, { ...options, cwd: resolve(options.cwd ?? process.cwd()) })
    return {
      ...response,
      stdout: response.skipDefaultRender
        ? response.stdout
        : json ? renderJson(response.result) : response.stdout || renderText(response.result),
    }
  } catch {
    const result = failure('UNEXPECTED_ERROR', `${command} failed unexpectedly`, {
      errors: [{ code: 'UNEXPECTED_ERROR', message: 'unexpected failure', retryable: true }],
    })
    return {
      exitCode: 1,
      result,
      stdout: json ? renderJson(result) : renderText(result),
      stderr: '',
    }
  }
}

async function main() {
  const response = await runPlattyCommand(process.argv.slice(2))
  process.stdout.write(response.stdout)
  if (response.stderr) process.stderr.write(response.stderr)
  process.exitCode = response.exitCode
}

function isDirectCliExecution() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  }
}

if (isDirectCliExecution()) {
  void main()
}
