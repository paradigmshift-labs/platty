import { createHash } from 'node:crypto'

export function normalizeLf(value) {
  return `${value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\n*$/, '')}\n`
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function failure(code, message = code) {
  const error = new Error(message)
  error.code = code
  return error
}

function parseScalar(source) {
  const value = source.trim()
  if (value === '') return {}
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((entry) => parseScalar(entry))
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch { throw failure('INVALID_FRONTMATTER', `invalid quoted YAML scalar: ${value}`) }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value)
  return value
}

function parseFrontmatter(source) {
  const result = {}
  let parent
  for (const [index, rawLine] of source.split('\n').entries()) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue
    const indentation = rawLine.match(/^\s*/)[0].length
    if (indentation !== 0 && indentation !== 2) {
      throw failure('INVALID_FRONTMATTER', `unsupported YAML indentation on line ${index + 1}`)
    }
    const line = rawLine.trim()
    const separator = line.indexOf(':')
    if (separator <= 0) throw failure('INVALID_FRONTMATTER', `invalid YAML mapping on line ${index + 1}`)
    const key = line.slice(0, separator).trim()
    const value = parseScalar(line.slice(separator + 1))
    if (indentation === 0) {
      result[key] = value
      parent = value && typeof value === 'object' && !Array.isArray(value) ? key : undefined
      continue
    }
    if (!parent || !result[parent] || typeof result[parent] !== 'object' || Array.isArray(result[parent])) {
      throw failure('INVALID_FRONTMATTER', `nested YAML key without a mapping parent on line ${index + 1}`)
    }
    result[parent][key] = value
  }
  return result
}

function scalar(value) {
  return value ?? ''
}

function pick(metadata, keys) {
  return Object.fromEntries(keys.map((key) => [key, scalar(metadata[key])]))
}

export function parseSddArtifact(name, source, counterpart) {
  const content = normalizeLf(source)
  if (!content.startsWith('---\n')) throw failure('INVALID_FRONTMATTER', `${name} is missing YAML frontmatter`)
  const end = content.indexOf('\n---\n', 4)
  if (end < 0) throw failure('INVALID_FRONTMATTER', `${name} has unterminated YAML frontmatter`)
  const metadata = parseFrontmatter(content.slice(4, end))
  if (counterpart && canonicalJson(metadata) !== canonicalJson(counterpart.metadata)) {
    throw failure('LEGACY_METADATA_CONFLICT', `${name} conflicts with canonical metadata`)
  }
  return { name, content, metadata, body: content.slice(end + 5) }
}

function evidenceHeading(document, { required = false } = {}) {
  const delimiter = '## 9. 영향도 조사 및 근거'
  const positions = [...document.body.matchAll(/^## 9\. 영향도 조사 및 근거\s*$/gm)].map((match) => match.index)
  if (positions.length > 1 || (required && positions.length !== 1)) {
    throw failure('INVALID_EVIDENCE_DELIMITER', `${document.name} must contain ${required ? 'exactly' : 'at most'} one ${delimiter} delimiter`)
  }
  return positions[0]
}

function prdBodyBeforeEvidence(document) {
  const boundary = evidenceHeading(document)
  return boundary === undefined ? document.body : document.body.slice(0, boundary)
}

export function computeRequestRevision(document) {
  return digest(canonicalJson({
    body: prdBodyBeforeEvidence(document),
    frontmatter: pick(document.metadata, ['id', 'outputLanguage', 'projectId', 'type']),
  }))
}

export function computeStoriesRevision(document) {
  return digest(canonicalJson({
    body: document.body,
    frontmatter: pick(document.metadata, ['derivedFrom', 'id', 'outputLanguage', 'projectId', 'type']),
  }))
}

export function computeProductInputFingerprint(request, stories) {
  return digest(canonicalJson({
    requestRevision: computeRequestRevision(request),
    requestStatus: scalar(request.metadata.status),
    storiesRevision: computeStoriesRevision(stories),
    storiesStatus: scalar(stories.metadata.status),
  }))
}

export function computeDesignRevision(document) {
  return digest(canonicalJson({
    body: document.body,
    frontmatter: pick(document.metadata, [
      'derivedFrom', 'evidenceFingerprint', 'id', 'outputLanguage',
      'productInputFingerprint', 'projectId', 'requestRevision', 'requestStatus',
      'review', 'storiesRevision', 'storiesStatus', 'type',
    ]),
  }))
}
