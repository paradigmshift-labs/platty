/*
 * React adapter (frontend).
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.5
 *
 * 룰 (★ v2 — router lib 없으면 routing_files=[] + needsLLMRouting=false):
 *   - entrypoint_files: src/main.tsx → src/main.jsx → src/index.tsx → src/index.jsx → src/App.tsx
 *   - schema_sources: [] (frontend)
 *   - controller_patterns: []
 *   - page_patterns: src/pages → src/views → src/screens (매칭 시 정적, 없으면 needsLLMPages)
 *   - routing_files:
 *       · deps에 router lib 없음 → [] + needsLLMRouting=false (의도적 no-router)
 *       · router lib 있음 + 컨벤션 위치(src/router/index.ts) 발견 → 정적
 *       · router lib 있음 + 컨벤션 위치 없음 → [] + needsLLMRouting=true
 *   - needsLLMCustomDecorators: HOC 패턴(withAuth(/withLogger() grep 시 true
 */

import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FrameworkAdapter } from './_base.js'
import type { ManifestSet, SchemaSourceFromLLM, StandardSlots } from '../../types.js'
import { globHasAny } from '../helpers/glob.js'
import { grepFiles, grepHasAny } from '../helpers/grep.js'

const ENTRYPOINT_CHAIN = [
  'src/main.tsx', 'src/main.jsx',
  'src/index.tsx', 'src/index.jsx',
  'src/App.tsx', 'src/App.jsx',
]

const ROUTER_LIB_DEPS = ['react-router-dom', 'react-router', '@tanstack/react-router', 'wouter', '@metorial/microfrontend']
const ROUTER_CONVENTION_FILES = [
  'src/router/index.ts', 'src/router/index.tsx',
  'src/router.ts', 'src/router.tsx',
  'src/routes.ts', 'src/routes.tsx',
  'src/App.ts', 'src/App.tsx', 'src/App.js', 'src/App.jsx',
  'app/routes.ts', 'app/routes.tsx', 'app/routes.js', 'app/routes.jsx',
  'react-router.config.ts', 'react-router.config.js',
]

const ROUTER_SOURCE_PATTERN =
  /\b(BrowserRouter|HashRouter|MemoryRouter|RouterProvider|Routes|Route|createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|useRoutes|reactRouter|createFrontendRouter|createSlice)\b/


export const reactAdapter: FrameworkAdapter = {
  framework: 'react',
  async extractSlots(manifests, identity, repoPath, signal): Promise<Partial<StandardSlots>> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // ── entrypoint ──
    const entrypoints: string[] = []
    for (const candidate of ENTRYPOINT_CHAIN) {
      if (existsSync(resolve(repoPath, candidate))) {
        entrypoints.push(candidate)
        break
      }
    }
    if (entrypoints.length === 0) {
      for (const candidate of collectTopLevelReactEntrypoints(repoPath)) {
        entrypoints.push(candidate)
      }
    }

    // ── routing_files / needsLLMRouting ──
    const npmDeps = collectNpmDeps(manifests)
    const hasRouterLib = ROUTER_LIB_DEPS.some((d) => npmDeps[d] !== undefined)

    let routingFiles: string[] = []
    let needsLLMRouting = false

    if (!hasRouterLib) {
      // 의도적 no-router → routing_files=[] + needsLLM=false
      routingFiles = []
      needsLLMRouting = false
    } else {
      // 컨벤션 위치 검사
      for (const cv of ROUTER_CONVENTION_FILES) {
        if (existsSync(resolve(repoPath, cv))) {
          routingFiles.push(cv)
        }
      }
      const routeSearchGlobs = [
        '{src,app}/**/*.{ts,tsx,js,jsx}',
        '*/*.{ts,tsx,js,jsx}',
      ]
      for (const glob of routeSearchGlobs) {
        for (const file of await grepFiles(glob, ROUTER_SOURCE_PATTERN, repoPath, signal)) {
          if (!routingFiles.includes(file)) routingFiles.push(file)
        }
      }
      needsLLMRouting = routingFiles.length === 0
    }

    // ── needsLLMCustomDecorators (HOC grep) ──
    const hasHOC = await grepHasAny('src/**/*.{ts,tsx,jsx}', /\b(withAuth|withLogger|withApollo|withRouter|withRedux)\s*\(/, repoPath, signal)
    void globHasAny // 일단 사용 안 함 (R7에서 컨벤션 매칭 보강 시 사용 가능)

    return {
      entrypoint_files: entrypoints,
      schema_sources: reactSchemaSources(identity.orm, repoPath),
      routing_files: routingFiles,
      needsLLMRouting,
      needsLLMCustomDecorators: hasHOC,
    }
  },
}

function reactSchemaSources(orm: string | null, repoPath: string): SchemaSourceFromLLM[] {
  if (orm === 'prisma' && existsSync(resolve(repoPath, 'prisma/schema.prisma'))) {
    return [{ orm: 'prisma', provider: null, schema_paths: ['prisma/schema.prisma'], label: 'main' }]
  }
  return []
}

function collectNpmDeps(manifests: ManifestSet): Record<string, string> {
  if (manifests.packageJson === null) return {}
  return {
    ...(manifests.packageJson.dependencies ?? {}),
    ...(manifests.packageJson.devDependencies ?? {}),
  }
}

function collectTopLevelReactEntrypoints(repoPath: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(repoPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const name of ['main.tsx', 'main.jsx', 'index.tsx', 'index.jsx']) {
      const rel = `${entry.name}/${name}`
      if (existsSync(resolve(repoPath, rel))) {
        out.push(rel)
        break
      }
    }
  }
  return out.sort()
}
