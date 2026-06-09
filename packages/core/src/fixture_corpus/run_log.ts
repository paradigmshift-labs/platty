import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface RunLogRecord {
  fixtureId: string
  stageId?: string
  phase: 'select' | 'run' | 'compare' | 'oracle' | 'gate' | 'decision'
  status: 'pass' | 'fail' | 'skip' | 'advisory'
  timestamp: string
  cycle: number
  reason?: string
  escalationReason?: string
  candidatePath?: string
  reportPath?: string
  decision?: string
  scenario?: string
}

export async function appendRunLogRecord(path: string, record: RunLogRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (!existsSync(path)) await writeFile(path, '', 'utf-8')
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf-8')
}

export async function readRunLog(path: string): Promise<RunLogRecord[]> {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf-8').trim()
  if (!raw) return []
  return raw.split('\n').map((line) => JSON.parse(line) as RunLogRecord)
}

export async function filterRunLog(
  path: string,
  predicate: (record: RunLogRecord) => boolean,
): Promise<RunLogRecord[]> {
  return (await readRunLog(path)).filter(predicate)
}

export async function latestRunLogRecords(path: string, maxRecords: number): Promise<RunLogRecord[]> {
  const records = await readRunLog(path)
  return records.slice(Math.max(0, records.length - maxRecords))
}
