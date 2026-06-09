import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPlattyCommand } from '../src/main.js'

describe('platty init', () => {
  it('creates project config without project-local DB path', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'platty-init-'))
    const response = await runPlattyCommand(['--json', 'init'], { cwd })

    expect(response.exitCode).toBe(0)
    const config = JSON.parse(readFileSync(join(cwd, '.platty/config.json'), 'utf8'))
    expect(config.projectRoot).toBe(cwd)
    expect(config.localDbPath).toBeUndefined()
  })
})
