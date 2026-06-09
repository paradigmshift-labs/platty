import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dbModuleDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(dbModuleDir, '../..')

export function getMigrationsPath(): string {
  const candidates = [
    resolve(packageRoot, 'dist/db/migrations'),
    resolve(packageRoot, 'src/db/migrations'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[1]
}

export interface PlattyHomeOptions {
  readonly env?: Record<string, string | undefined>
  readonly homeDir?: string
  readonly platform?: NodeJS.Platform
}

export function getPlattyHomeDir(options: PlattyHomeOptions = {}): string {
  const env = options.env ?? process.env
  if (env.PLATTY_HOME) return resolve(env.PLATTY_HOME)

  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    const base = env.APPDATA ?? options.homeDir ?? env.USERPROFILE ?? homedir()
    if (!base) throw new Error('PLATTY_HOME_REQUIRED')
    return resolve(base, 'Platty')
  }

  const baseHome = options.homeDir ?? env.HOME ?? homedir()
  if (!baseHome) throw new Error('PLATTY_HOME_REQUIRED')
  return resolve(baseHome, '.platty')
}

export function getDefaultDatabasePath(options: PlattyHomeOptions = {}): string {
  const env = options.env ?? process.env
  return env.PLATTY_DB_PATH ? resolve(env.PLATTY_DB_PATH) : join(getPlattyHomeDir(options), 'platty.db')
}
