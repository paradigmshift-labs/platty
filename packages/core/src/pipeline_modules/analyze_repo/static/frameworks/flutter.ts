/*
 * Flutter adapter.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §5.6
 *
 * 룰:
 *   - entrypoint_files: lib/main*.dart glob (다중 main 환경 대응)
 *   - schema_sources: [] (mobile, drift/floor는 별 — 일단 미지원)
 *   - worker_patterns: []
 *   - routing_files: GoRouter/GetX/AutoRoute/Beamer/MaterialApp.router/onGenerateRoute/routes:{} grep 매칭 파일
 *   (controller/page 패턴 탐색 제거 — build_route가 code_graph에서 직접 수행)
 *   - needsLLMRouting: routingFiles.length === 0 (결과 0 → LLM fallback 활성)
 *   - needsLLMApiBasePaths: false (mobile 자체 API 없음)
 *   - needsLLMCustomDecorators: false (Dart wrapper 흔치 않음)
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FrameworkAdapter } from './_base.js'
import type { StandardSlots } from '../../types.js'
import { safeGlob } from '../helpers/glob.js'
import { grepFiles } from '../helpers/grep.js'

export const flutterAdapter: FrameworkAdapter = {
  framework: 'flutter',
  async extractSlots(_manifests, identity, repoPath, signal): Promise<Partial<StandardSlots>> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    void identity

    // ── entrypoint_files (lib/main*.dart) ──
    const entrypoints: string[] = []
    const mainCandidates = ['lib/main.dart', 'lib/main_dev.dart', 'lib/main_prod.dart']
    for (const m of mainCandidates) {
      if (existsSync(resolve(repoPath, m))) entrypoints.push(m)
    }
    // glob로 추가 (lib/main_*.dart)
    const globResult = await safeGlob('lib/main*.dart', repoPath, signal)
    for (const g of globResult.matches) {
      if (!entrypoints.includes(g)) entrypoints.push(g)
    }

    // ── routing_files (GoRouter / GetX / AutoRoute / Beamer / Navigator map grep) ──
    const routerPattern = /\b(GoRouter|AutoRoute|GetMaterialApp|GetPage|Beamer|BeamPage|MaterialApp\.router|onGenerateRoute)\b|routes\s*:\s*\{/
    const routingFiles = await grepFiles('lib/**/*.dart', routerPattern, repoPath, signal)
    const sourceRoutingLibs = new Set<string>()
    for (const file of routingFiles) {
      const abs = resolve(repoPath, file)
      if (!existsSync(abs)) continue
      const source = readFileSync(abs, 'utf-8')
      if (/\b(GoRouter|GoRoute)\b/.test(source)) sourceRoutingLibs.add('go_router')
      if (/\b(GetMaterialApp|GetPage)\b/.test(source)) sourceRoutingLibs.add('get')
      if (/\bAutoRoute\b/.test(source)) sourceRoutingLibs.add('auto_route')
      if (/\b(BeamPage|BeamLocation|BeamerDelegate)\b/.test(source)) sourceRoutingLibs.add('beamer')
    }

    const schemaSources = identity.orm === 'drift'
      ? [{ orm: 'drift', provider: 'sqlite' as const, schema_paths: ['lib/**/*.dart'], label: 'main' }]
      : []

    return {
      entrypoint_files: entrypoints,
      schema_sources: schemaSources,
      routing_files: routingFiles,
      routing_libs: [...sourceRoutingLibs],
      needsLLMRouting: routingFiles.length === 0,
      needsLLMCustomDecorators: false,
    }
  },
}
