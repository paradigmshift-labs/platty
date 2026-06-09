import { describe, expect, it } from 'vitest'
import { runPlattyCommand } from '../src/main.js'

describe('platty command shell', () => {
  it('prints version JSON without opening a DB', async () => {
    const response = await runPlattyCommand(['--json', 'version'])

    expect(response.exitCode).toBe(0)
    expect(response.stdout).toMatch(/"ok": true/)
    expect(response.stdout).toMatch(/"version": "0.1.0"/)
  })

  it('rejects unknown commands', async () => {
    const response = await runPlattyCommand(['missing'])

    expect(response.exitCode).toBe(2)
    expect(response.stdout).toMatch(/UNKNOWN_COMMAND/)
  })
})
