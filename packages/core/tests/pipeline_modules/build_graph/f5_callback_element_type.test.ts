/**
 * F5-4: callback element type 추적 (P15-Full 영역, 시나리오 enumerate)
 *
 * `users.map(u => u.method())` — 콜백 안 receiver `u`의 type을 추적해서
 * `u.method()`를 정확히 매핑.
 *
 * 어댑터/F5는 syntax tree만 봄 — 변수 type inference는 TS Type Checker(P15-Full) 영역.
 * 현재 시나리오만 enumerate, 구현은 별 milestone.
 */
import { describe, it } from 'vitest'

describe('F5-4: callback element type 추적', () => {
  it.skip('CE-1 — `users: User[].map(u => u.method())` (User에 method 정의) → u.method calls resolved', () => {
    // P15-Full 영역. TS Type Checker로 u의 type=User 추론 필요.
    // 시나리오:
    //   class User { method() {} }
    //   const users: User[] = ...
    //   users.map(u => u.method())  // u.method가 User.method로 resolved
  })

  it.skip('CE-2 — `Promise<User>.then(u => u.method())` → u.method resolved', () => {
    // Promise generic type 추적 필요.
  })
})
