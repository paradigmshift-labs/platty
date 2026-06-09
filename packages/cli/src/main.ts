#!/usr/bin/env node
import { getPlattyEngineInfo } from '@platty/core'
import { createPlattyClient } from '@platty/sdk'

declare const process: {
  readonly argv: readonly string[]
  readonly stdout: {
    write(output: string): void
  }
}

export function runPlattyCli(): string {
  const engine = getPlattyEngineInfo()
  const client = createPlattyClient({ baseUrl: 'http://localhost:3001' })
  return `platty cli ready: ${engine.name} via ${client.baseUrl}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${runPlattyCli()}\n`)
}
