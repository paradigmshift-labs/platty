import { existsSync, mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlattyCommand } from '../src/main.js'

describe('uninstall command', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps Platty state on dry run and prints the npm uninstall command', async () => {
    const home = mkdtempSync(join(tmpdir(), 'platty-uninstall-dry-'))
    vi.stubEnv('PLATTY_HOME', join(home, '.platty'))
    await mkdir(join(home, '.platty'), { recursive: true })
    await writeFile(join(home, '.platty/config.json'), '{}\n', 'utf8')

    const response = await runPlattyCommand(['--json', 'uninstall'])

    expect(response.exitCode).toBe(0)
    expect(response.result.data).toMatchObject({
      dryRun: true,
      removedState: false,
      packageUninstallCommand: ['npm', 'uninstall', '-g', '@pshift/platty'],
    })
    expect(response.result.nextAction).toMatchObject({
      type: 'uninstall_global_package',
      command: ['npm', 'uninstall', '-g', '@pshift/platty'],
    })
    expect(existsSync(join(home, '.platty/config.json'))).toBe(true)
  })

  it('removes the Platty state root only when --yes is provided', async () => {
    const home = mkdtempSync(join(tmpdir(), 'platty-uninstall-confirm-'))
    vi.stubEnv('PLATTY_HOME', join(home, '.platty'))
    await mkdir(join(home, '.platty'), { recursive: true })
    await writeFile(join(home, '.platty/config.json'), '{}\n', 'utf8')

    const response = await runPlattyCommand(['--json', 'uninstall', '--yes'])

    expect(response.exitCode).toBe(0)
    expect(response.result.data).toMatchObject({
      dryRun: false,
      removedState: true,
      packageUninstallCommand: ['npm', 'uninstall', '-g', '@pshift/platty'],
    })
    expect(existsSync(join(home, '.platty'))).toBe(false)
  })
})
