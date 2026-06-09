export type DbKeySource = 'keychain' | 'env' | 'none'

export interface DbKeySourceInput {
  env?: Record<string, string | undefined>
  keychainAvailable?: boolean
}

export function resolveDbKeySource(input: DbKeySourceInput = {}) {
  if (input.keychainAvailable) {
    return { source: 'keychain' as const, available: true }
  }
  if (input.env?.PLATTY_DB_KEY) {
    return { source: 'env' as const, available: true }
  }
  return { source: 'none' as const, available: false }
}
