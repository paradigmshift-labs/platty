/* istanbul ignore file */
/* c8 ignore start */
/* v8 ignore start -- type-only module. */

/**
 * FrameworkAdapter — framework별 정적 슬롯 추출 인터페이스.
 *
 * SOT: specs/analyze_repo/architecture.md §6.1
 *
 * 각 어댑터는 자기 영역만 채움 (Partial<StandardSlots>).
 * 공통 필드(path_aliases / base_url / integrations / test_patterns / routing_libs)는
 * extractStandardSlots orchestrator가 채움.
 */

import type { Framework } from '@/db/schema/enums.js'
import type { IdentitySignal, ManifestSet, StandardSlots } from '../../types.js'

export interface FrameworkAdapter {
  framework: Framework
  /**
   * 비동기 — 일부 어댑터는 glob/grep 사용 (디스크 I/O).
   * signal: AbortSignal — pre-aborted 시 즉시 AbortError throw.
   */
  extractSlots(
    manifests: ManifestSet,
    identity: IdentitySignal,
    repoPath: string,
    signal?: AbortSignal,
  ): Promise<Partial<StandardSlots>>
}
