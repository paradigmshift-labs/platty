/*
 * Generic adapter — 호출 안 됨 (orchestrator가 framework='other'/null 시 SKIP).
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.7
 *
 * 방어: 호출되면 throw (orchestrator bug 알림).
 */

import type { FrameworkAdapter } from './_base.js'

export const genericAdapter: FrameworkAdapter = {
  framework: 'other',
  async extractSlots() {
    throw new Error('genericAdapter.extractSlots called — orchestrator should skip framework=other/null')
  },
}
