import { existsSync, readFileSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { codeNodes } from '@/db/schema/code_graph.js'

export function stripJsLikeComments(source: string): string {
  let out = ''
  let quote: string | null = null
  let blockComment = false
  let lineComment = false

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    const prev = source[i - 1]

    if (lineComment) {
      if (ch === '\n') {
        lineComment = false
        out += ch
      }
      continue
    }

    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false
        i += 1
      }
      continue
    }

    if (quote) {
      out += ch
      if (ch === quote && prev !== '\\') quote = null
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      continue
    }

    if (ch === '/' && next === '/') {
      lineComment = true
      i += 1
      continue
    }

    if (ch === '/' && next === '*') {
      blockComment = true
      i += 1
      continue
    }

    out += ch
  }

  return out
}

export function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i]
    const prev = source[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

export function findMatchingBracket(source: string, openBracket: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = openBracket; i < source.length; i += 1) {
    const ch = source[i]
    const prev = source[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '[') depth += 1
    if (ch === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

export function findMatchingParen(source: string, openParen: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i]
    const prev = source[i - 1]
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(') depth += 1
    if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

export function joinUrlPath(parent: string, child: string): string {
  const p = parent === '/' ? '' : parent.replace(/\/+$/, '')
  const c = child.replace(/^\/+/, '')
  const joined = normalizeReactRoutePath(`${p}/${c}`)
  return joined === '/' ? '/' : joined.replace(/\/+$/, '')
}

export function normalizeReactRoutePath(path: string): string {
  const cleaned = path.trim().replace(/\/+/g, '/')
  if (!cleaned || cleaned === '/') return '/'
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`
}

export function resolveRelativeSourceFile(
  currentFilePath: string,
  requiredPath: string,
  repoPath: string,
  graphNodes: Array<typeof codeNodes.$inferSelect>,
): { id: string; filePath: string } | null {
  const base = requiredPath.startsWith('.')
    ? joinPath(dirname(currentFilePath), requiredPath)
    : joinPath('src', requiredPath)
  const extensionlessBase = base.replace(/\.(js|jsx|ts|tsx)$/, '')
  const candidates = [
    base,
    `${extensionlessBase}.js`,
    `${extensionlessBase}.jsx`,
    `${extensionlessBase}.ts`,
    `${extensionlessBase}.tsx`,
    joinPath(base, 'index.js'),
    joinPath(base, 'index.jsx'),
    joinPath(base, 'index.ts'),
    joinPath(base, 'index.tsx'),
    joinPath(extensionlessBase, 'index.js'),
    joinPath(extensionlessBase, 'index.jsx'),
    joinPath(extensionlessBase, 'index.ts'),
    joinPath(extensionlessBase, 'index.tsx'),
  ].map((candidate) => candidate.replace(/\\/g, '/').replace(/^\.\//, ''))

  for (const candidate of candidates) {
    const fileNode = graphNodes.find((node) => node.type === 'file' && node.filePath === candidate)
    if (fileNode && existsSync(joinPath(repoPath, candidate))) return { id: fileNode.id, filePath: candidate }
  }
  return null
}

export function safeReadSource(repoPath: string, filePath: string): string | null {
  try {
    return readFileSync(joinPath(repoPath, filePath), 'utf-8')
  } catch {
    return null
  }
}
