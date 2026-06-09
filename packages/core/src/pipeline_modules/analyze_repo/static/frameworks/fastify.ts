/*
 * Fastify adapter — express와 거의 동일.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.4
 */

import type { FrameworkAdapter } from './_base.js'
import { expressAdapter } from './express.js'

export const fastifyAdapter: FrameworkAdapter = {
  framework: 'fastify',
  async extractSlots(manifests, identity, repoPath, signal) {
    // express와 동일 룰 + framework만 변경
    const result = await expressAdapter.extractSlots(manifests, identity, repoPath, signal)
    return result
  },
}
