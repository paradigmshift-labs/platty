/**
 * F5-3: re-export multi-hop chain (medium, 시나리오 enumerate)
 *
 * A → re-exports B → re-exports C — A에서 import한 X가 C 정의.
 * F4의 resolveFromResolvedImport는 1-hop만 처리. multi-hop은 F3 flatten 의존.
 *
 * 현재 시나리오 작성 + skip — F3 단계에서 flatten 처리되는지 별도 milestone 영역.
 */
import { describe, it } from 'vitest'

describe('F5-3: re-export multi-hop chain', () => {
  it.skip('RE-1 — A→B→C re-export, A에서 import한 X가 C 정의 → resolved (multi-hop)', () => {
    // F3 단계에서 re-export flatten 처리 필요. 별 milestone로 분리.
    // 시나리오:
    //   src/c.ts: export const X = 1
    //   src/b.ts: export * from './c'
    //   src/a.ts: export * from './b'
    //   src/usage.ts: import { X } from './a' — multi-hop resolved 기대
  })

  it.skip('RE-2 — re-export 순환 (A↔B) — infinite loop 안 빠지고 fail-safe', () => {
    // 순환 re-export는 grammar 안티패턴. 우리 graph는 hop 제한 또는 visited set으로 안전망.
  })
})
