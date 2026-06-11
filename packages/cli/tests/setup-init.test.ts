import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlattyCommand } from '../src/main.js'

describe('platty init', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates project config in the user-global Platty home without project-local state', async () => {
    const home = mkdtempSync(join(tmpdir(), 'platty-user-home-'))
    const cwd = mkdtempSync(join(tmpdir(), 'platty-init-'))
    vi.stubEnv('HOME', home)

    const response = await runPlattyCommand(['--json', 'init'], { cwd })

    expect(response.exitCode).toBe(0)
    expect(existsSync(join(home, '.platty/config.json'))).toBe(true)
    expect(existsSync(join(cwd, '.platty/config.json'))).toBe(false)
    const config = JSON.parse(readFileSync(join(home, '.platty/config.json'), 'utf8'))
    expect(config.projectRoot).toBe(resolve(home, '.platty'))
    expect(config.localDbPath).toBeUndefined()
  })

  it('uses the global PLATTY_HOME dir as the workspace root, ignoring cwd', async () => {
    const home = mkdtempSync(join(tmpdir(), 'platty-home-'))
    const cwd = mkdtempSync(join(tmpdir(), 'platty-elsewhere-'))
    vi.stubEnv('PLATTY_HOME', home)

    const response = await runPlattyCommand(['--json', 'init'], { cwd })

    expect(response.exitCode).toBe(0)
    // config lives directly in PLATTY_HOME (no nested .platty), ignoring cwd
    expect(existsSync(join(home, 'config.json'))).toBe(true)
    expect(existsSync(join(cwd, '.platty/config.json'))).toBe(false)
    const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))
    expect(config.projectRoot).toBe(resolve(home))
  })
})
