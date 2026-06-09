import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve, relative, isAbsolute } from 'node:path'
import type { SourceFallback } from './types.js'

type Scope = Parameters<SourceFallback['resolveConstant']>[0]['allowedScopes'][number]
type ResolvedConstant = { kind: 'literal'; value: string } | { kind: 'reference'; identifier: string }

const MAX_IMPORT_HOPS = 5

export function createSourceFallback(repoPath: string | null | undefined): SourceFallback {
  return {
    resolveConstant(args) {
      if (!repoPath || !args.filePath) return null

      const value = resolveIdentifierFromFile(repoPath, args.filePath, args.identifier, new Set(), 0)
      if (!value || !isAllowedForScopes(value, args.allowedScopes)) return null
      return value
    },
  }
}

function readRepoFile(repoPath: string, filePath: string): string | null {
  const root = resolve(repoPath)
  const fullPath = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath)
  const rel = relative(root, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  if (!existsSync(fullPath)) return null
  try {
    return readFileSync(fullPath, 'utf8')
  } catch {
    return null
  }
}

function resolveIdentifierFromFile(
  repoPath: string,
  filePath: string,
  identifier: string,
  visited: Set<string>,
  depth: number,
): string | null {
  if (depth > MAX_IMPORT_HOPS) return null

  const visitKey = `${filePath}:${identifier}`
  if (visited.has(visitKey)) return null
  visited.add(visitKey)

  const source = readRepoFile(repoPath, filePath)
  if (!source) return null

  const local = resolveIdentifierFromSource(source, identifier)
  if (local?.kind === 'literal') return local.value
  if (local?.kind === 'reference') {
    return resolveIdentifierFromFile(repoPath, filePath, local.identifier, visited, depth + 1)
  }

  for (const importedFile of findImportedFiles(repoPath, filePath, source, identifier)) {
    const imported = resolveIdentifierFromFile(repoPath, importedFile, identifier, visited, depth + 1)
    if (imported) return imported
  }

  return null
}

function resolveIdentifierFromSource(source: string, identifier: string): ResolvedConstant | null {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(identifier)) return null

  const [base, prop] = identifier.split('.')
  if (!base) return null
  if (prop) {
    return resolveObjectProperty(source, base, prop) ?? resolveStaticProperty(source, base, prop)
  }
  return resolveDirectConstant(source, base)
}

function resolveDirectConstant(source: string, identifier: string): ResolvedConstant | null {
  const ident = escapeRegExp(identifier)
  const literalPatterns = [
    new RegExp(String.raw`(?:export\s+)?const\s+${ident}\s*=\s*(['"\`])([^'"\`]+)\1`, 'm'),
    new RegExp(String.raw`(?:const|final|var)\s+${ident}\s*=\s*(['"])([^'"]+)\1`, 'm'),
  ]

  for (const pattern of literalPatterns) {
    const match = source.match(pattern)
    if (match?.[2]) return { kind: 'literal', value: match[2] }
  }

  const referencePatterns = [
    new RegExp(String.raw`(?:export\s+)?const\s+${ident}\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\b`, 'm'),
    new RegExp(String.raw`(?:const|final|var)\s+${ident}\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\b`, 'm'),
  ]

  for (const pattern of referencePatterns) {
    const match = source.match(pattern)
    if (match?.[1] && match[1] !== identifier) return { kind: 'reference', identifier: match[1] }
  }

  return null
}

function resolveObjectProperty(source: string, objectName: string, propertyName: string): ResolvedConstant | null {
  const body = extractAssignedObjectBody(source, objectName)
  if (!body) return null

  const prop = escapeRegExp(propertyName)
  const literalPattern = new RegExp(String.raw`(?:${prop}|['"]${prop}['"])\s*:\s*(['"\`])([^'"\`]+)\1`, 'm')
  const literalMatch = body.match(literalPattern)
  if (literalMatch?.[2]) return { kind: 'literal', value: literalMatch[2] }

  const referencePattern = new RegExp(
    String.raw`(?:${prop}|['"]${prop}['"])\s*:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\b`,
    'm',
  )
  const referenceMatch = body.match(referencePattern)
  if (referenceMatch?.[1]) return { kind: 'reference', identifier: referenceMatch[1] }

  return null
}

function resolveStaticProperty(source: string, className: string, propertyName: string): ResolvedConstant | null {
  const body = extractClassBody(source, className)
  if (!body) return null

  const prop = escapeRegExp(propertyName)
  const literalPattern = new RegExp(
    String.raw`static\s+(?:readonly\s+)?(?:const|final|var)?\s*${prop}\s*=\s*(['"\`])([^'"\`]+)\1`,
    'm',
  )
  const literalMatch = body.match(literalPattern)
  if (literalMatch?.[2]) return { kind: 'literal', value: literalMatch[2] }

  const referencePattern = new RegExp(
    String.raw`static\s+(?:readonly\s+)?(?:const|final|var)?\s*${prop}\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\b`,
    'm',
  )
  const referenceMatch = body.match(referencePattern)
  if (referenceMatch?.[1]) return { kind: 'reference', identifier: referenceMatch[1] }

  return null
}

function extractAssignedObjectBody(source: string, objectName: string): string | null {
  const startPattern = new RegExp(String.raw`(?:export\s+)?const\s+${escapeRegExp(objectName)}\s*=\s*\{`, 'm')
  const startMatch = startPattern.exec(source)
  if (!startMatch) return null
  return extractBalancedBody(source, startMatch.index + startMatch[0].length - 1)
}

function extractClassBody(source: string, className: string): string | null {
  const startPattern = new RegExp(String.raw`class\s+${escapeRegExp(className)}\b[^{]*\{`, 'm')
  const startMatch = startPattern.exec(source)
  if (!startMatch) return null
  return extractBalancedBody(source, startMatch.index + startMatch[0].length - 1)
}

function extractBalancedBody(source: string, openBraceIndex: number): string | null {
  let depth = 0
  for (let i = openBraceIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBraceIndex + 1, i)
    }
  }
  return null
}

function findImportedFiles(
  repoPath: string,
  filePath: string,
  source: string,
  identifier: string,
): string[] {
  const baseIdentifier = identifier.split('.')[0] ?? identifier
  const files = new Set<string>()

  const jsImportPattern = /import\s+(?:\{([^}]+)\}|([A-Za-z_$][\w$]*)|\*\s+as\s+([A-Za-z_$][\w$]*))[^'"]*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(jsImportPattern)) {
    const [, namedImports, defaultImport, namespaceImport, specifier] = match
    if (!specifier || !isLocalSpecifier(specifier)) continue
    if (
      namedImports?.split(',').some((part) => importedName(part) === baseIdentifier)
      || defaultImport === baseIdentifier
      || namespaceImport === baseIdentifier
    ) {
      for (const candidate of resolveImportCandidates(repoPath, filePath, specifier)) files.add(candidate)
    }
  }

  const jsExportPattern = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(jsExportPattern)) {
    const [, namedExports, specifier] = match
    if (!specifier || !isLocalSpecifier(specifier)) continue
    if (namedExports?.split(',').some((part) => importedName(part) === baseIdentifier)) {
      for (const candidate of resolveImportCandidates(repoPath, filePath, specifier)) files.add(candidate)
    }
  }

  const dartImportPattern = /import\s+['"]([^'"]+\.dart)['"]/g
  for (const match of source.matchAll(dartImportPattern)) {
    const specifier = match[1]
    if (!specifier || !isLocalSpecifier(specifier)) continue
    for (const candidate of resolveImportCandidates(repoPath, filePath, specifier)) files.add(candidate)
  }

  return Array.from(files)
}

function importedName(importPart: string): string | null {
  const [name, alias] = importPart.trim().split(/\s+as\s+/)
  return (alias ?? name)?.trim() || null
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function resolveImportCandidates(repoPath: string, fromFilePath: string, specifier: string): string[] {
  const basePath = resolve(dirname(resolve(repoPath, fromFilePath)), specifier)
  const relativeBase = relative(resolve(repoPath), basePath)
  if (relativeBase.startsWith('..') || isAbsolute(relativeBase)) return []

  const extensions = extname(basePath) ? [''] : ['', '.ts', '.tsx', '.js', '.jsx', '.dart']
  const candidates = extensions
    .map((extension) => relative(resolve(repoPath), `${basePath}${extension}`))
    .filter((candidate) => existsSync(join(resolve(repoPath), candidate)))

  if (!extname(basePath)) {
    for (const indexFile of ['index.ts', 'index.tsx', 'index.js']) {
      const candidate = relative(resolve(repoPath), join(basePath, indexFile))
      if (existsSync(join(resolve(repoPath), candidate))) candidates.push(candidate)
    }
  }

  return candidates
}

function isAllowedForScopes(value: string, scopes: Scope[]): boolean {
  return scopes.some((scope) => {
    switch (scope) {
      case 'api':
        return /^\/[^/]/.test(value) || /\b(?:query|mutation|subscription)\s+[A-Za-z_][\w]*/.test(value)
      case 'route':
        return /^\/($|[^/])/.test(value) || /^[A-Za-z_][\w.-]*$/.test(value)
      case 'event':
        return /^[\w./:-]+$/.test(value)
      case 'external':
        return /^https?:\/\//.test(value) || /^[a-z][a-z0-9+.-]*:/.test(value)
    }
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
