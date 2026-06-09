/**
 * tsconfig 헬퍼 — path_aliases / base_url 추출.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §4.1, §4.2
 */

import type { TsConfig } from '../../types.js'
import { isUnsafePath, DANGEROUS_KEYS } from './path_safety.js'

/**
 * tsconfig.compilerOptions.paths를 정규화.
 * - 키와 값 1쌍씩만 (배열 첫 원소 사용)
 * - 위험 키(__proto__/constructor/prototype) 제외
 * - 위험 path 값 제외
 *
 * Returns `{}` 안전하게.
 */
export function extractPathAliases(tsconfig: TsConfig | null): Record<string, string> {
  if (tsconfig === null) return {}
  const paths = tsconfig.compilerOptions?.paths
  if (!paths || typeof paths !== 'object') return {}

  const result: Record<string, string> = {}
  for (const [key, valueArr] of Object.entries(paths)) {
    if (DANGEROUS_KEYS.has(key)) continue
    if (typeof key !== 'string' || key.length > 200) continue
    if (!Array.isArray(valueArr) || valueArr.length === 0) continue
    const first = valueArr[0]
    if (typeof first !== 'string') continue
    if (isUnsafePath(first)) continue
    result[key] = first
  }
  return result
}

/**
 * tsconfig.compilerOptions.baseUrl을 안전하게 추출.
 * - 위험 패턴이면 null
 */
export function extractBaseUrl(tsconfig: TsConfig | null): string | null {
  if (tsconfig === null) return null
  const baseUrl = tsconfig.compilerOptions?.baseUrl
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return null
  if (isUnsafePath(baseUrl)) return null
  return baseUrl
}
