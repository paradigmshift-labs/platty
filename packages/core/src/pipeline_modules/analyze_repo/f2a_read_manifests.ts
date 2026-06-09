/**
 * F2a-1: readManifests — repo 루트의 매니페스트 파일들을 객체로 읽어옴.
 *
 * SOT: specs/analyze_repo/specs/f2a_read_manifests/spec.md
 *
 * 룰:
 *   - 디스크 I/O만. LLM 호출 0.
 *   - 파싱 실패 → null (warning 누적 X — 호출자 책임).
 *   - tsconfig extends: depth limit 5 + path_safety 검증.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'
import type {
  ManifestSet,
  PackageJson,
  PubspecYaml,
  TsConfig,
} from './types.js'

const MAX_PACKAGE_JSON_SIZE = 1024 * 1024 // 1MB
const MAX_TSCONFIG_SIZE = 256 * 1024       // 256KB
const MAX_PUBSPEC_SIZE = 256 * 1024
const TSCONFIG_EXTENDS_DEPTH_LIMIT = 5

const OTHER_MANIFEST_FILES = [
  'go.mod',
  'Cargo.toml',
  'requirements.txt',
  'setup.py',
  'pyproject.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
] as const

export function readManifests(repoPath: string): ManifestSet {
  return {
    packageJson: readPackageJson(repoPath),
    pubspecYaml: readPubspecYaml(repoPath),
    tsconfig: readTsConfig(repoPath),
    otherManifests: collectOtherManifests(repoPath),
  }
}

// ────────────────────────────────────────
// package.json
// ────────────────────────────────────────

function readPackageJson(repoPath: string): PackageJson | null {
  const filePath = resolve(repoPath, 'package.json')
  if (!existsSync(filePath)) return null

  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return null
  }
  if (stat.size > MAX_PACKAGE_JSON_SIZE) return null

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
  raw = stripBOM(raw)

  try {
    const parsed = JSON.parse(raw) as PackageJson
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

// ────────────────────────────────────────
// pubspec.yaml — minimal parser (top-level + dependencies/dev_dependencies)
// ────────────────────────────────────────

function readPubspecYaml(repoPath: string): PubspecYaml | null {
  const filePath = resolve(repoPath, 'pubspec.yaml')
  if (!existsSync(filePath)) return null

  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return null
  }
  if (stat.size > MAX_PUBSPEC_SIZE) return null

  let raw: string
  try {
    raw = stripBOM(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }

  return parsePubspecMinimal(raw)
}

/**
 * pubspec.yaml의 최소 필드만 추출:
 *  - name (top-level)
 *  - dependencies / dev_dependencies (key 목록만 — 값은 원본 보존)
 *
 * YAML 전체 파서 안 쓰는 이유: 외부 의존 회피 + 우리가 필요한 것은 deps 키만.
 */
function parsePubspecMinimal(raw: string): PubspecYaml | null {
  try {
    const lines = raw.split(/\r?\n/)
    const result: PubspecYaml = {}

    let currentSection: 'dependencies' | 'dev_dependencies' | null = null
    let currentDepIndent = -1

    for (const line of lines) {
      // 빈 줄 / 주석
      if (line.trim() === '' || line.trim().startsWith('#')) continue

      const indent = line.length - line.trimStart().length
      const trimmed = line.trim()

      // top-level (indent 0)
      if (indent === 0) {
        currentSection = null
        currentDepIndent = -1
        const m = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/)
        if (!m) continue
        const [, key, value] = m
        if (key === 'name' && value) {
          result.name = stripQuotes(value)
        } else if (key === 'dependencies' || key === 'dev_dependencies') {
          currentSection = key
          if (value) {
            // inline dict not supported, treat as empty
          }
          if (key === 'dependencies') result.dependencies = {}
          else result.dev_dependencies = {}
        }
        continue
      }

      // section 안 (indent > 0)
      if (currentSection === null) continue

      // 첫 dep entry로 들여쓰기 깊이 확정
      if (currentDepIndent === -1) currentDepIndent = indent
      // 깊이가 dep entry 깊이와 같을 때만 dep key로 인식
      if (indent !== currentDepIndent) continue

      const m = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/)
      if (!m) continue
      const [, key, value] = m
      const depKey = key
      // value가 비어있으면 nested map (이후 줄), 그렇지 않으면 inline string
      const target = currentSection === 'dependencies' ? result.dependencies : result.dev_dependencies
      if (target) {
        target[depKey] = value === '' ? null : stripQuotes(value)
      }
    }

    return result
  } catch {
    return null
  }
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

// ────────────────────────────────────────
// tsconfig.json — JSONC 관대 파싱 + extends 체인 해소
// ────────────────────────────────────────

function readTsConfig(repoPath: string): TsConfig | null {
  return readTsConfigChain(resolve(repoPath, 'tsconfig.json'), repoPath, 0, new Set())
}

function readTsConfigChain(
  filePath: string,
  repoRoot: string,
  depth: number,
  visited: Set<string>,
): TsConfig | null {
  if (depth >= TSCONFIG_EXTENDS_DEPTH_LIMIT) return null
  if (visited.has(filePath)) return null
  visited.add(filePath)

  if (!existsSync(filePath)) return null

  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return null
  }
  if (stat.size > MAX_TSCONFIG_SIZE) return null

  let raw: string
  try {
    raw = stripBOM(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }

  let parsed: TsConfig
  try {
    parsed = JSON.parse(stripJsoncExtras(raw)) as TsConfig
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null

  // extends 처리 — depth limit 5 + path_safety
  const extendsValue = parsed.extends
  if (typeof extendsValue === 'string' && extendsValue.length > 0) {
    if (isUnsafeExtendsPath(extendsValue)) return null

    const baseFilePath = resolveExtendsPath(filePath, extendsValue)
    /* v8 ignore next -- kept as a second boundary after the explicit unsafe path checks above. */
    if (!baseFilePath.startsWith(repoRoot)) return null // path traversal escape

    const base = readTsConfigChain(baseFilePath, repoRoot, depth + 1, visited)
    if (base === null) return null

    return mergeTsConfig(base, parsed)
  }

  return parsed
}

function resolveExtendsPath(fromFile: string, target: string): string {
  // target은 path만 허용. node_modules 패키지 참조(`@scope/pkg/tsconfig`)는 미지원 (보안)
  let p = target
  if (!p.endsWith('.json')) p += '.json'
  return resolve(dirname(fromFile), p)
}

function isUnsafeExtendsPath(value: string): boolean {
  /* v8 ignore next -- callers pass parsed `extends` only after a string type guard. */
  if (typeof value !== 'string') return true
  if (value.length > 200) return true
  if (/[\x00-\x1f\x7f]/.test(value)) return true
  if (value.includes('../') || value.includes('..\\')) return true
  if (isAbsolute(value)) return true
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return true // URL scheme
  return false
}

function mergeTsConfig(base: TsConfig, child: TsConfig): TsConfig {
  return {
    compilerOptions: {
      ...(base.compilerOptions ?? {}),
      ...(child.compilerOptions ?? {}),
      paths: child.compilerOptions?.paths ?? base.compilerOptions?.paths,
    },
    extends: child.extends, // 보존 (디버깅)
  }
}

/**
 * JSONC 관대 파싱 — 주석 + trailing comma 제거.
 */
function stripJsoncExtras(raw: string): string {
  // 라인 주석 / 블록 주석 제거 — 문자열 안 보호
  let out = ''
  let i = 0
  let inString: '"' | "'" | null = null
  while (i < raw.length) {
    const c = raw[i]
    const next = raw[i + 1]
    if (inString) {
      out += c
      if (c === '\\' && i + 1 < raw.length) {
        out += raw[i + 1]
        i += 2
        continue
      }
      if (c === inString) inString = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inString = c as '"' | "'"
      out += c
      i++
      continue
    }
    if (c === '/' && next === '/') {
      // 라인 끝까지 skip
      while (i < raw.length && raw[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < raw.length - 1 && !(raw[i] === '*' && raw[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  // trailing comma 제거: `,` 직후 whitespace 후 `}` or `]`
  return out.replace(/,(\s*[}\]])/g, '$1')
}

// ────────────────────────────────────────
// otherManifests
// ────────────────────────────────────────

function collectOtherManifests(repoPath: string): string[] {
  const found: string[] = []
  for (const name of OTHER_MANIFEST_FILES) {
    const p = resolve(repoPath, name)
    if (existsSync(p)) found.push(name)
  }
  return found
}

// ────────────────────────────────────────
// helpers
// ────────────────────────────────────────

function stripBOM(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1)
  return s
}
