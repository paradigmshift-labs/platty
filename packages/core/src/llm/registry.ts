import type { LlmAdapter } from './types.js'

export interface LlmSpec {
  provider: LlmAdapter['provider']
  model: string
}

export function getLlmAdapter(spec: LlmSpec): LlmAdapter {
  return {
    provider: spec.provider,
    model: spec.model,
    async call() {
      throw new Error(`No LLM adapter registered for ${spec.provider}:${spec.model}`)
    },
  }
}
