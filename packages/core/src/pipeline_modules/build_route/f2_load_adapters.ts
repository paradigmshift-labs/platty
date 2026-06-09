// f2 loadAdapters — REGISTRY (TS 모듈) 기반 어댑터 로더.
// SOT: specs/build_route/specs/f2_load_adapters/spec.md

import { REGISTRY } from './adapters/index.js'
import type {
  Adapter,
  AdapterRegistry,
  CustomDecoratorMapping,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from './types.js'

export class AdapterLoadError extends Error {
  constructor(
    public code: 'ADAPTER_NOT_REGISTERED',
    message: string,
  ) {
    super(message)
    this.name = 'AdapterLoadError'
  }
}

export interface ResolvedAlias {
  resolvesTo: string
  source: 'static' | 'analyze_repo' | 'override'
}

export interface LoadedAdapter extends Adapter {
  /** 3-Layer merge 결과 (alias_resolver 입력 — f3 orchestrator). */
  resolvedAliases: Record<string, ResolvedAlias>
}

export interface LoadAdaptersInput {
  detections: FrameworkDetectionResult[]
  stackInfo: StackInfoForBuildRoute
  /** REGISTRY 부분 덮어쓰기 — 모노레포 mock / 테스트용. 미제공 시 default REGISTRY. */
  registryOverride?: AdapterRegistry
  /** L3 user override — framework → wrapper → mapping. MVP 후 yaml 도입. */
  overrideAliases?: Record<string, Record<string, CustomDecoratorMapping>>
}

export function loadAdapters(input: LoadAdaptersInput): LoadedAdapter[] {
  const registry = { ...REGISTRY, ...(input.registryOverride ?? {}) }
  const customDecorators = input.stackInfo.customDecorators ?? {}
  const out: LoadedAdapter[] = []

  for (const det of input.detections) {
    if (!det.active) continue

    const adapter = registry[det.framework]
    if (!adapter) {
      throw new AdapterLoadError(
        'ADAPTER_NOT_REGISTERED',
        `Adapter '${det.framework}' not registered in REGISTRY`,
      )
    }

    const overrideForAdapter = input.overrideAliases?.[det.framework] ?? {}
    const resolvedAliases = mergeAliases(customDecorators, overrideForAdapter)

    out.push({ ...adapter, resolvedAliases })
  }

  return out
}

function mergeAliases(
  analyzeRepoMap: Record<string, CustomDecoratorMapping>,
  overrideMap: Record<string, CustomDecoratorMapping>,
): Record<string, ResolvedAlias> {
  const merged: Record<string, ResolvedAlias> = {}

  // L2 — analyze_repo
  for (const [wrapper, mapping] of Object.entries(analyzeRepoMap)) {
    merged[wrapper] = { resolvesTo: mapping.resolvesTo, source: 'analyze_repo' }
  }

  // L3 — override (덮어씀)
  for (const [wrapper, mapping] of Object.entries(overrideMap)) {
    merged[wrapper] = { resolvesTo: mapping.resolvesTo, source: 'override' }
  }

  return merged
}
