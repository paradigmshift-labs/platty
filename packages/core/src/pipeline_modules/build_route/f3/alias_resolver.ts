// f3/alias_resolver — wrapper 추적 + visited Set (architecture.md §4.5).
// 입력 aliasMap은 이미 1-step 매핑된 형태 (analyze_repo Layer 2 + 룰 엔진 Layer 1 머지 결과).

import type { AliasResolveOptions, AliasResolveResult } from '../types.js'

const DEFAULT_DEPTH = 3

export function resolveAlias(
  symbol: string,
  aliasMap: ReadonlyMap<string, string>,
  standardSet: ReadonlySet<string>,
  options: AliasResolveOptions = {},
): AliasResolveResult {
  const depth = options.depth ?? DEFAULT_DEPTH

  // symbol 자체가 이미 standard
  if (standardSet.has(symbol)) {
    return { resolved: symbol, chain: [symbol], cycleDetected: false }
  }

  const chain: string[] = [symbol]
  const visited = new Set<string>([symbol])
  let current = symbol

  for (let step = 0; step < depth; step++) {
    const next = aliasMap.get(current)
    if (next === undefined) {
      // 더 이상 풀 수 없음 — standard? external?
      /* v8 ignore next 3 -- current standard is returned immediately after every alias hop. */
      if (standardSet.has(current)) {
        return { resolved: current, chain, cycleDetected: false }
      }
      return {
        resolved: null,
        chain,
        cycleDetected: false,
        failedReason: 'external',
      }
    }

    if (visited.has(next)) {
      chain.push(next)
      return {
        resolved: null,
        chain,
        cycleDetected: true,
        failedReason: 'cycle',
      }
    }

    visited.add(next)
    chain.push(next)
    current = next

    // standard 도달 — 즉시 종료
    if (standardSet.has(current)) {
      return { resolved: current, chain, cycleDetected: false }
    }
  }

  // depth 소진 — current 가 standard 인지 한 번 더 체크
  /* v8 ignore next 3 -- standard targets are returned inside the loop before depth exhaustion. */
  if (standardSet.has(current)) {
    return { resolved: current, chain, cycleDetected: false }
  }
  // 더 풀 수 있는지 (next 존재 여부)로 depth_exceeded vs external 구분
  if (aliasMap.has(current)) {
    return { resolved: null, chain, cycleDetected: false, failedReason: 'depth_exceeded' }
  }
  return { resolved: null, chain, cycleDetected: false, failedReason: 'external' }
}
