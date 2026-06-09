/**
 * grep 헬퍼 — 텍스트 패턴 매칭.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.6 (flutter GoRouter grep)
 *
 * 사용:
 * - flutter routing_files 추출 (`GoRouter(`, `AutoRoute(`, `MaterialApp.router(`)
 * - nestjs custom_decorators 의심 신호 (`applyDecorators` import)
 * - react HOC 의심 신호 (`withAuth(`/`withLogger(`)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { safeGlob } from './glob.js'

const MAX_FILE_SIZE = 256 * 1024 // 256KB per file

/**
 * 패턴이 들어있는 파일 경로 목록 (relative).
 * @param pattern 정규식 또는 단순 문자열
 */
export async function grepFiles(
  globPattern: string,
  textPattern: string | RegExp,
  cwd: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const { matches } = await safeGlob(globPattern, cwd, signal)
  const found: string[] = []
  const re = textPattern instanceof RegExp ? textPattern : new RegExp(escapeRegex(textPattern))

  for (const rel of matches) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const full = resolve(cwd, rel)
      const buf = readFileSync(full)
      if (buf.length > MAX_FILE_SIZE) continue
      const content = buf.toString('utf-8')
      if (re.test(content)) found.push(rel)
    } catch {
      continue
    }
  }
  return found
}

/**
 * 단순 boolean — 어떤 파일이라도 패턴 포함하면 true.
 */
export async function grepHasAny(
  globPattern: string,
  textPattern: string | RegExp,
  cwd: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const found = await grepFiles(globPattern, textPattern, cwd, signal)
  return found.length > 0
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
