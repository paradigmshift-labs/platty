import { getPlattyEngineInfo } from '@platty/core'

declare const process: {
  readonly argv: readonly string[]
  readonly stdout: {
    write(output: string): void
  }
}

export function describeBackend(): string {
  return `platty backend ready: ${getPlattyEngineInfo().name}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${describeBackend()}\n`)
}
