import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendRunLogRecord, filterRunLog, latestRunLogRecords, readRunLog } from '../../src/fixture_corpus/index.js'

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
})

describe('fixture corpus run log', () => {
  it('appends JSONL run records and reads recent or filtered records', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'platty-fixture-log-'))
    const logPath = join(tempDir, 'runs.jsonl')

    await appendRunLogRecord(logPath, {
      fixtureId: 'unit/ast-extract/nextjs',
      stageId: 'build_graph',
      phase: 'run',
      status: 'fail',
      timestamp: '2026-06-09T00:00:00.000Z',
      cycle: 1,
      reason: 'missing expected',
    })
    await appendRunLogRecord(logPath, {
      fixtureId: 'unit/ast-extract/nextjs',
      stageId: 'build_graph',
      phase: 'gate',
      status: 'pass',
      timestamp: '2026-06-09T00:01:00.000Z',
      cycle: 2,
    })

    expect(await readRunLog(logPath)).toHaveLength(2)
    expect(await latestRunLogRecords(logPath, 1)).toMatchObject([{ phase: 'gate', status: 'pass' }])
    expect(await filterRunLog(logPath, (record) => record.status === 'fail')).toMatchObject([
      { phase: 'run', reason: 'missing expected' },
    ])
  })
})
