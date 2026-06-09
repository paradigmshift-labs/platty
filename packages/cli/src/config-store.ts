import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CurrentProjectPointer } from '@platty/core'

export interface PlattyProjectConfig {
  version: 1
  projectRoot: string
  currentProject: CurrentProjectPointer | null
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function plattyDir(projectRoot: string) {
  return resolve(projectRoot, '.platty')
}

export function configPath(projectRoot: string) {
  return resolve(plattyDir(projectRoot), 'config.json')
}

export async function readProjectConfig(projectRoot: string): Promise<PlattyProjectConfig> {
  const raw = await readFile(configPath(projectRoot), 'utf8')
  const parsed = JSON.parse(raw) as Partial<PlattyProjectConfig>
  return {
    version: 1,
    projectRoot: parsed.projectRoot ?? projectRoot,
    currentProject: parsed.currentProject ?? null,
  }
}

export async function writeProjectConfig(projectRoot: string, config: PlattyProjectConfig): Promise<void> {
  const path = configPath(projectRoot)
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await chmod(path, 0o600)
}

export async function ensureProjectConfig(projectRoot: string): Promise<{ config: PlattyProjectConfig; created: boolean; configPath: string }> {
  const dir = plattyDir(projectRoot)
  const path = configPath(projectRoot)
  await mkdir(dir, { recursive: true })
  await chmod(dir, 0o700)

  if (await exists(path)) {
    return { config: await readProjectConfig(projectRoot), created: false, configPath: path }
  }

  const config: PlattyProjectConfig = {
    version: 1,
    projectRoot,
    currentProject: null,
  }
  await writeProjectConfig(projectRoot, config)
  return { config, created: true, configPath: path }
}
