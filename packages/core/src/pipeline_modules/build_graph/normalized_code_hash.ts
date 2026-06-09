import { createHash } from 'node:crypto'

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch)
}

function appendPendingWhitespace(out: string[], next: string): void {
  const prev = out[out.length - 1]
  if (prev && isIdentChar(prev) && isIdentChar(next)) out.push(' ')
}

function previousSignificantChar(out: readonly string[]): string | null {
  for (let i = out.length - 1; i >= 0; i--) {
    const ch = out[i]
    if (!/\s/.test(ch)) return ch
  }
  return null
}

function canStartRegexLiteral(out: readonly string[]): boolean {
  const prev = previousSignificantChar(out)
  return prev === null || /[({[=,:;!&|?+\-*~%^<>]/.test(prev)
}

function readRegexLiteral(source: string, slashIndex: number): number | null {
  let i = slashIndex + 1
  let inCharacterClass = false

  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[') {
      inCharacterClass = true
      i++
      continue
    }
    if (ch === ']') {
      inCharacterClass = false
      i++
      continue
    }
    if (ch === '/' && !inCharacterClass) {
      i++
      while (i < source.length && /[A-Za-z]/.test(source[i])) i++
      return i
    }
    if (ch === '\n' || ch === '\r') return null
    i++
  }

  return null
}

export function normalizeCodeForHash(source: string): string {
  const out: string[] = []
  let i = 0
  let pendingWhitespace = false

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (/\s/.test(ch)) {
      pendingWhitespace = true
      i++
      continue
    }

    if (ch === '/' && next === '/') {
      i += 2
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++
      pendingWhitespace = true
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i = Math.min(i + 2, source.length)
      pendingWhitespace = true
      continue
    }

    if (pendingWhitespace) {
      appendPendingWhitespace(out, ch)
      pendingWhitespace = false
    }

    if (ch === '/' && canStartRegexLiteral(out)) {
      const regexEnd = readRegexLiteral(source, i)
      if (regexEnd !== null) {
        out.push(source.slice(i, regexEnd))
        i = regexEnd
        continue
      }
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch
      out.push(ch)
      i++
      while (i < source.length) {
        const c = source[i]
        out.push(c)
        i++
        if (c === '\\') {
          if (i < source.length) {
            out.push(source[i])
            i++
          }
          continue
        }
        if (c === quote) break
      }
      continue
    }

    out.push(ch)
    i++
  }

  return out.join('').trim()
}

export function computeNormalizedCodeHash(source: string): string {
  return createHash('sha256').update(normalizeCodeForHash(source)).digest('hex')
}

export function sliceLinesForHash(
  sourceLines: readonly string[],
  lineStart: number | null,
  lineEnd: number | null,
): string | null {
  if (lineStart === null || lineEnd === null) return null
  if (lineStart < 1 || lineEnd < lineStart) return null
  return sourceLines.slice(lineStart - 1, lineEnd).join('\n')
}
