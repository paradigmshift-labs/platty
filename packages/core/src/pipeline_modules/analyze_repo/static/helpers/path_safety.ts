/**
 * path_safety — analyze_repo v2 공통 보안 헬퍼.
 *
 * SOT: specs/analyze_repo/architecture.md §5.4
 *
 * 모든 path 필드 검증 + 모든 z.record 키에 dangerous key 검증.
 */

import { z } from 'zod'

export const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

/**
 * path가 위험하면 true. true → reject.
 *
 * 룰:
 * - 비-string 또는 길이 500 초과 (DoS 방어)
 * - 제어 문자 (NUL/탭/LF/CR/DEL)
 * - `../` 또는 `..\\` (path traversal)
 * - 절대경로 (POSIX `/...` 또는 Windows `C:\\...`)
 * - URL scheme (`http://`, `file://`, `data:` 등)
 */
export function isUnsafePath(value: unknown): boolean {
  if (typeof value !== 'string') return true
  if (value.length === 0) return false // 빈 문자열은 별도 검증 (caller 책임)
  if (value.length > 500) return true
  if (/[\x00-\x1f\x7f]/.test(value)) return true
  if (value.includes('../') || value.includes('..\\')) return true
  if (value.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(value)) return true
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(value)) return true
  return false
}

/**
 * Zod superRefine 헬퍼 — 객체 + 모든 nested object 키에 dangerous key 검증.
 *
 * **주의**: Zod의 `z.record(z.string(), ...)`는 `__proto__` 키를 자동 strip하므로
 * superRefine 안에선 이미 제거된 상태. 이 헬퍼는 **Zod 거치지 않은 raw object**에서
 * 호출해야 의미가 있음. 보통 `assertNoDangerousKeys` (throw 버전)를
 * `JSON.parse` 직후에 사용.
 *
 * 그래도 superRefine 패턴 유지 (이중 안전망).
 */
export function rejectDangerousKeys(
  obj: unknown,
  ctx: z.RefinementCtx,
): void {
  if (obj === null || typeof obj !== 'object') return
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `허용되지 않는 키: ${k}`,
      })
    }
    rejectDangerousKeys((obj as Record<string, unknown>)[k], ctx)
  }
}

/**
 * 비-Zod 환경 (LLM 응답 직접 검증) — throw 버전.
 *
 * 사용 패턴:
 *   const parsed = JSON.parse(llmResponse)
 *   assertNoDangerousKeys(parsed)        // raw 검증 (Zod 자동 strip 우회)
 *   const validated = Schema.parse(parsed)
 */
export function assertNoDangerousKeys(obj: unknown): void {
  if (obj === null || typeof obj !== 'object') return
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) {
      throw new Error(`허용되지 않는 키: ${k}`)
    }
    assertNoDangerousKeys((obj as Record<string, unknown>)[k])
  }
}
