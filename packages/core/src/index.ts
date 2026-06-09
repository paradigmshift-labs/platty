export interface PlattyEngineInfo {
  readonly name: '@platty/core'
  readonly role: 'analysis-engine'
}

export function getPlattyEngineInfo(): PlattyEngineInfo {
  return {
    name: '@platty/core',
    role: 'analysis-engine',
  }
}
