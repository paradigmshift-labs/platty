import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import fg from 'fast-glob'

// LOCK — the MCP static-analysis core must never reach for the LLM agent layer.
//
// A module-by-module audit (2026-06-02) confirmed the chain analyze_repo → build_graph →
// build_pattern_profile → build_models → build_route → build_relations → build_service_map makes ZERO LLM
// calls on a default run; the first real LLM call in the whole pipeline is build_docs F3 (synthesizeDocument).
// As of the LLM-FREE refactor the static core has NO sanctioned in-code LLM touchpoint at all:
//   (a) the rule_authoring self-improvement loops are now LLM-FREE — the author is injected (a test stub or the
//       agent-driven `dsl` CLI's promote path); the old llm_*_rule_author / resolveLive*Author were deleted.
//       rule_authoring is still EXCLUDED below (it carries no @/agents import to begin with), and
//   (b) build_route's former optional LLM fallback (F5 runLlmFallback) was REMOVED — build_route is pure static;
//       suspected entry points are surfaced and enriched later by the route CLI / agent, outside the engine.
// This test freezes that property: a regression that wires the LLM role layer (@/agents) or a runtime
// (value) @/llm import into any static stage fails right here. `import type ... from '@/llm'` is allowed
// (a type on an injection-seam signature never calls an LLM).

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STATIC_CORE = [
  'analyze_repo', 'build_graph', 'build_pattern_profile', 'build_models',
  'build_route', 'build_relations', 'build_service_map',
] as const

function sourceFiles(module: string): string[] {
  return fg.sync(`src/pipeline_modules/${module}/**/*.ts`, {
    cwd: ROOT,
    absolute: true,
    ignore: ['**/rule_authoring/**', '**/*.test.ts'], // rule_authoring = the env-gated discovery loop (sanctioned LLM)
  })
}

describe('MCP static core is LLM-free (lock)', () => {
  for (const module of STATIC_CORE) {
    it(`${module}: runtime path imports neither @/agents nor a value @/llm`, () => {
      const offenders: string[] = []
      for (const file of sourceFiles(module)) {
        const rel = file.slice(ROOT.length)
        const lines = readFileSync(file, 'utf-8').split('\n')
        for (const line of lines) {
          if (/^\s*\/\//.test(line)) continue // skip comments (the audit notes mention @/agents in prose)
          if (/from ['"]@\/agents/.test(line)) {
            offenders.push(`${rel}: imports the LLM agent layer → ${line.trim()}`)
          }
          if (/from ['"]@\/llm/.test(line) && !/^\s*import\s+type\b/.test(line)) {
            offenders.push(`${rel}: value-imports @/llm → ${line.trim()}`)
          }
        }
      }
      expect(offenders, `static-core module '${module}' must stay LLM-free on its runtime path`).toEqual([])
    })
  }

  it('covers a non-trivial number of files (the glob is not silently empty)', () => {
    const total = STATIC_CORE.reduce((n, m) => n + sourceFiles(m).length, 0)
    expect(total).toBeGreaterThan(50)
  })
})
