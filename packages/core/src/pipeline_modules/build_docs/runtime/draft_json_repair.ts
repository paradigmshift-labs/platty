export function parseDraftJsonWithRepair(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const originalError = error instanceof Error ? error : null

    for (const candidate of repairedCandidates(text)) {
      try {
        return JSON.parse(candidate)
      } catch {
        continue
      }
    }

    if (originalError) throw originalError
    throw new SyntaxError('Failed to parse draft JSON.')
  }
}

function repairedCandidates(text: string): string[] {
  const candidates: string[] = []
  const trimmed = text.trim()

  const fenced = unwrapSingleFence(trimmed)
  if (fenced !== null) {
    candidates.push(fenced)
    const strippedFenced = stripTrailingCommas(fenced)
    if (strippedFenced !== fenced) candidates.push(strippedFenced)
  }

  const balancedObject = extractFirstBalancedObjectCandidate(text)
  if (balancedObject !== null) {
    candidates.push(balancedObject)
    const strippedCandidate = stripTrailingCommas(balancedObject)
    if (strippedCandidate !== balancedObject) candidates.push(strippedCandidate)
  }

  const strippedText = stripTrailingCommas(text)
  if (strippedText !== text) candidates.push(strippedText)

  return candidates
}

function unwrapSingleFence(text: string): string | null {
  const match = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text)
  return match ? match[1] : null
}

function extractFirstBalancedObjectCandidate(text: string): string | null {
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString || char !== '{') continue

    const balanced = extractBalancedObject(text, index)
    if (balanced !== null) return balanced
  }

  return null
}

function extractBalancedObject(text: string, startIndex: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') depth += 1
    if (char === '}') depth -= 1

    if (depth === 0) {
      return text.slice(startIndex, index + 1)
    }
  }

  return null
}

function stripTrailingCommas(text: string): string {
  let output = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1
      if (lookahead < text.length && (text[lookahead] === '}' || text[lookahead] === ']')) {
        continue
      }
    }

    output += char
  }

  return output
}
