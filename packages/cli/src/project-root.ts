import { execFileSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function findPlattyRoot(cwd = process.cwd()): Promise<string | null> {
  let current = resolve(cwd)
  while (true) {
    if (await exists(resolve(current, '.platty', 'config.json'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function findGitRoot(cwd = process.cwd()): string | null {
  try {
    const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!prefix) return resolve(cwd)
    return resolve(cwd, ...prefix.split('/').filter(Boolean).map(() => '..'))
  } catch {
    return null
  }
}

export async function resolveProjectRootForInit(cwd = process.cwd(), requestedRoot?: string) {
  if (requestedRoot?.trim()) return resolve(cwd, requestedRoot)
  const existingRoot = await findPlattyRoot(cwd)
  if (existingRoot) return existingRoot
  return findGitRoot(cwd) ?? resolve(cwd)
}

export async function requirePlattyRoot(cwd = process.cwd()) {
  return findPlattyRoot(cwd)
}
