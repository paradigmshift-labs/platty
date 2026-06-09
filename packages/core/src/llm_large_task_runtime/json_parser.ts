import { LlmLargeTaskError } from './errors.js'

export function extractJsonValue(raw: string): unknown {
  const direct = tryParseJson(raw)
  if (direct.ok) return direct.value
  for (const candidate of extractFenceCandidates(raw)) {
    const parsed = tryParseJson(candidate)
    if (parsed.ok) return parsed.value
  }
  const balanced = extractBalancedJson(raw)
  if (balanced) {
    const parsed = tryParseJson(balanced)
    if (parsed.ok) return parsed.value
  }
  throw new LlmLargeTaskError('OUTPUT_VALIDATION_FAILED', 'No parseable JSON value found in LLM response.')
}

export function parseJsonWithSchema<T>(
  raw: string,
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; message: string; details?: unknown },
): T {
  const value = extractJsonValue(raw)
  const result = validate(value)
  if (result.ok) return result.value
  throw new LlmLargeTaskError('OUTPUT_VALIDATION_FAILED', result.message, { details: result.details })
}

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw.trim()) }
  } catch {
    return { ok: false }
  }
}

function extractFenceCandidates(raw: string): string[] {
  const candidates: string[] = []
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fencePattern.exec(raw)) !== null) {
    if (match[1]) candidates.push(match[1].trim())
  }
  return candidates
}

function extractBalancedJson(raw: string): string | null {
  const starts = ['{', '[']
    .map((start) => ({ start, index: raw.indexOf(start) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index)
  for (const candidate of starts) {
    const end = candidate.start === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = candidate.index; index < raw.length; index += 1) {
      const char = raw[index]
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (char === candidate.start) depth += 1
      if (char === end) depth -= 1
      if (depth === 0) return raw.slice(candidate.index, index + 1)
    }
  }
  return null
}
