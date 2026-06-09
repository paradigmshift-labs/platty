import { getPlattyEngineInfo } from '@platty/core'

export function describeBackend(): string {
  return `platty backend ready: ${getPlattyEngineInfo().name}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${describeBackend()}\n`)
}
