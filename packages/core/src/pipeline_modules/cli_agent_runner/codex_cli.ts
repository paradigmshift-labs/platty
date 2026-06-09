import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type CodexCliEffort = 'low' | 'medium' | 'high'

export interface CodexCliModel {
  provider: 'codex_cli'
  model: string
  effort?: CodexCliEffort
}

export async function invokeCodexCliJson(input: {
  model: CodexCliModel
  prompt: string
  schema: Record<string, unknown>
  workDir: string
  baseName: string
  timeoutMs: number
}): Promise<unknown> {
  await mkdir(input.workDir, { recursive: true })
  const base = safeName(input.baseName)
  const schemaPath = path.join(input.workDir, `${base}.schema.json`)
  const resultPath = path.join(input.workDir, `${base}.result.json`)
  const logPath = path.join(input.workDir, `${base}.log`)
  await writeJson(schemaPath, normalizeCodexOutputSchema(input.schema))
  const args = [
    'exec',
    '-m', input.model.model,
    '-c', 'service_tier=fast',
    '-c', `model_reasoning_effort=${input.model.effort ?? 'medium'}`,
    '--skip-git-repo-check',
    '--ephemeral',
    '-C', input.workDir,
    '--output-schema', schemaPath,
    '-o', resultPath,
  ]
  const result = await spawnCapture('codex', args, { input: input.prompt, timeoutMs: input.timeoutMs })
  await writeFile(logPath, result.stdout + result.stderr, 'utf8')
  if (result.code !== 0) throw new Error(`codex exited ${result.code}: ${(result.stderr || result.stdout).slice(-500)}`)
  return JSON.parse(await readFile(resultPath, 'utf8')) as unknown
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, '_')
}

export function normalizeCodexOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeSchemaNode(schema)
  return isRecord(normalized) ? normalized : {}
}

function normalizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchemaNode)
  if (!isRecord(value)) return value

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    next[key] = normalizeSchemaNode(child)
  }
  if (isObjectSchema(next)) {
    next.additionalProperties = false
    next.required = requiredKeysForProperties(next)
  }
  return next
}

function isObjectSchema(value: Record<string, unknown>): boolean {
  const type = value.type
  return type === 'object'
    || (Array.isArray(type) && type.includes('object'))
    || isRecord(value.properties)
}

function requiredKeysForProperties(value: Record<string, unknown>): string[] {
  if (!isRecord(value.properties)) {
    value.properties = {}
    return []
  }
  return Object.keys(value.properties)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function spawnCapture(command: string, args: string[], options: { input: string; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 2_000).unref()
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms`))
    }, options.timeoutMs)
    timer.unref()
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    proc.stdin.end(options.input)
  })
}
