/**
 * routing_libs 추출 — framework + deps로 라우터 라이브러리 식별.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §4.5
 *      build_route v2 BLOCKER 변경 C.
 *
 * 룰:
 * - flutter: go_router / get / auto_route / beamer / flutter_modular
 * - react/nextjs: react-router-dom@^X / react-router@^X / @tanstack/react-router / wouter
 * - vue: vue-router@^X
 * - 그 외: []
 */

import type { Framework } from '@/db/schema/enums.js'
import type { ManifestSet } from '../../types.js'

export function extractRoutingLibs(framework: Framework | null, manifests: ManifestSet): string[] {
  if (framework === null || framework === 'other') return []

  const libs: string[] = []

  // Flutter
  if (framework === 'flutter') {
    const deps = manifests.pubspecYaml?.dependencies ?? {}
    if (deps['go_router'] !== undefined) libs.push('go_router')
    if (deps['get'] !== undefined) libs.push('get')
    if (deps['auto_route'] !== undefined) libs.push('auto_route')
    if (deps['beamer'] !== undefined) libs.push('beamer')
    if (deps['flutter_modular'] !== undefined) libs.push('flutter_modular')
    return libs
  }

  // React / Next.js — npm deps
  if (framework === 'react' || framework === 'nextjs') {
    const deps = npmDeps(manifests)
    const rrDomVer = deps['react-router-dom']
    if (rrDomVer) {
      const major = parseSemverMajor(rrDomVer)
      libs.push(major !== null ? `react-router-dom@^${major}` : 'react-router-dom')
    }
    const rrVer = deps['react-router']
    if (rrVer) {
      const major = parseSemverMajor(rrVer)
      libs.push(major !== null ? `react-router@^${major}` : 'react-router')
    }
    if (deps['@tanstack/react-router'] !== undefined) libs.push('@tanstack/react-router')
    if (deps['wouter'] !== undefined) libs.push('wouter')
    return libs
  }

  // Vue
  if (framework === 'vue') {
    const deps = npmDeps(manifests)
    const vrVer = deps['vue-router']
    if (vrVer) {
      const major = parseSemverMajor(vrVer)
      libs.push(major !== null ? `vue-router@^${major}` : 'vue-router')
    }
    return libs
  }

  // Svelte
  if (framework === 'svelte') {
    const deps = npmDeps(manifests)
    if (deps['@sveltejs/kit'] !== undefined) libs.push('@sveltejs/kit')
    return libs
  }

  return libs
}

function npmDeps(manifests: ManifestSet): Record<string, string> {
  if (manifests.packageJson === null) return {}
  return {
    ...(manifests.packageJson.dependencies ?? {}),
    ...(manifests.packageJson.devDependencies ?? {}),
  }
}

/**
 * 비정상 버전 문자열 (workspace:*, latest, *)도 안전하게 처리.
 * 매칭 안 되면 null.
 */
function parseSemverMajor(version: string): number | null {
  if (typeof version !== 'string') return null
  // 버전 시작 부분에서 첫 숫자만 추출 (^6.0.0 / ~5.2.1 / 7.x / >=4 등)
  const m = version.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0 || n > 999) return null
  return n
}
