import { access, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getPlattyHomeDir } from '@platty/core'
import { failure, success, type PlattyCommandResponse } from '../output.js'

const PACKAGE_UNINSTALL_COMMAND = ['npm', 'uninstall', '-g', '@pshift/platty']

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function hasFlag(argv: string[], flag: string) {
  return argv.includes(flag)
}

function unsafeStateRoot(path: string) {
  const root = resolve(path)
  return root === '/' || root === resolve(homedir())
}

export async function runUninstallCommand(argv: string[]): Promise<PlattyCommandResponse> {
  const stateRoot = getPlattyHomeDir()
  if (unsafeStateRoot(stateRoot)) {
    const result = failure('UNSAFE_UNINSTALL_ROOT', `Refusing to remove unsafe Platty state root: ${stateRoot}`)
    return { exitCode: 2, result, stdout: '', stderr: '' }
  }

  const confirmed = hasFlag(argv, '--yes')
  const stateExists = await exists(stateRoot)

  if (confirmed && stateExists) {
    await rm(stateRoot, { recursive: true, force: true })
  }

  const result = success({
    stateRoot,
    dryRun: !confirmed,
    removedState: confirmed && stateExists,
    packageUninstallCommand: PACKAGE_UNINSTALL_COMMAND,
  }, {
    nextAction: {
      type: 'uninstall_global_package',
      command: PACKAGE_UNINSTALL_COMMAND,
      message: 'Run this npm command outside Platty to remove the installed global CLI package.',
    },
    evidenceRefs: [{ label: 'platty-state-root', path: stateRoot }],
  })
  return { exitCode: 0, result, stdout: '', stderr: '' }
}
