/**
 * glob 헬퍼 — fast-glob wrapper with MAX_RESULTS 상한.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md Z3
 *
 * 룰:
 * - MAX_RESULTS=1000 — 거대 monorepo에서 100k+ 매칭 방어 (DoS)
 * - 결과 1000+ → truncate + warning 호출자에게 신호
 * - symlink 따라가지 않음
 */

import fg from 'fast-glob'

export const MAX_GLOB_RESULTS = 1000
export const GLOB_TIMEOUT_MS = 10_000

export interface GlobResult {
  matches: string[]
  truncated: boolean
}

export async function safeGlob(
  pattern: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<GlobResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  try {
    const results = await Promise.race([
      fg(pattern, {
        cwd,
        followSymbolicLinks: false,
        onlyFiles: true,
        dot: false,
      }),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('glob timeout')), GLOB_TIMEOUT_MS),
      ),
      ...(signal
        ? [
            new Promise<string[]>((_, reject) => {
              /* v8 ignore next -- safeGlob checks pre-aborted signals before constructing the race. */
              if (signal.aborted) {
                /* v8 ignore next -- same unreachable pre-aborted guard as above. */
                reject(new DOMException('Aborted', 'AbortError'))
              } else {
                signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
              }
            }),
          ]
        : []),
    ])
    if (results.length > MAX_GLOB_RESULTS) {
      return { matches: results.slice(0, MAX_GLOB_RESULTS), truncated: true }
    }
    return { matches: results, truncated: false }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return { matches: [], truncated: false }
  }
}

/**
 * 빠른 카운트 (≥1만 확인하면 되는 경우). 매칭 결과 자체는 버림.
 */
export async function globHasAny(
  pattern: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const r = await safeGlob(pattern, cwd, signal)
  return r.matches.length > 0
}
