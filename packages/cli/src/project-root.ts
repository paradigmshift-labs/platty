import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getPlattyHomeDir } from '@platty/core'
import { configPath } from './config-store.js'

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function findPlattyRoot(cwd = process.cwd()): Promise<string | null> {
  void cwd
  const root = getPlattyHomeDir()
  return await exists(configPath(root)) ? root : null
}

export async function resolveProjectRootForInit(cwd = process.cwd(), requestedRoot?: string) {
  if (requestedRoot?.trim()) return resolve(cwd, requestedRoot)
  return getPlattyHomeDir()
}

export async function requirePlattyRoot(cwd = process.cwd()) {
  return findPlattyRoot(cwd)
}
