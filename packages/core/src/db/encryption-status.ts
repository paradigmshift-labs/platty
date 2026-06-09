import type { DbKeySource } from '@/security/db-key-source.js'

export type PlattySecurityMode = 'local' | 'byok' | 'team' | 'managed-provider' | 'saas-sync'

export interface DbEncryptionStatusInput {
  mode?: string
  encrypted: boolean
  keySource: {
    source: DbKeySource
    available: boolean
  }
  allowUnencryptedLocalDb?: boolean
}

function requiresEncryption(mode?: string) {
  return mode === 'team' || mode === 'managed-provider' || mode === 'saas-sync'
}

export function getDbEncryptionStatus(input: DbEncryptionStatusInput) {
  const required = requiresEncryption(input.mode)
  const blocker = required && !input.encrypted ? 'DB_ENCRYPTION_REQUIRED' : null
  return {
    encrypted: input.encrypted,
    requiresEncryption: required,
    keySource: input.keySource.source,
    keyAvailable: input.keySource.available,
    allowUnencryptedLocalDb: Boolean(input.allowUnencryptedLocalDb),
    blocker,
  }
}
