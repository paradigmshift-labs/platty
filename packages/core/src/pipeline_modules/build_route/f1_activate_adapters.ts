// f1 activateAdapters — 어댑터 활성화 결정 (LLM 0회).
// SOT: specs/build_route/specs/f1_activate_adapters/spec.md
//
// Step 3a 범위: pure 단위 함수 evaluateDetection / resolveConflicts.
// Step 3b: yaml 디렉터리 자동 로드 + 통합 테스트.

import type { Framework } from '@/db/schema/enums.js'
import type {
  AdapterMeta,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from './types.js'

export interface DetectionInputs {
  /** code_edges 상의 imports target_specifier 모음 (graph 의존 단순 표현). */
  importSpecifiers?: string[]
  /** code_edges 상의 calls target_symbol 모음. */
  callPatterns?: string[]
}

/**
 * stackInfo + (옵션) graph 시그널을 metas와 매칭.
 * 매니페스트 시그널 0건이면 결과에 포함하지 않음 (후보조차 아님).
 */
export function evaluateDetection(
  stackInfo: StackInfoForBuildRoute,
  metas: AdapterMeta[],
  inputs: DetectionInputs = {},
): FrameworkDetectionResult[] {
  const fw = stackInfo.framework
  if (fw === 'other' && !inputs.importSpecifiers?.length && !inputs.callPatterns?.length) return []

  const routingLibs = stackInfo.routingLibs ?? []
  const importSpecs = inputs.importSpecifiers ?? []
  const callPatterns = inputs.callPatterns ?? []

  const out: FrameworkDetectionResult[] = []

  for (const meta of metas) {
    const det = meta.detection
    const evidence: Record<string, unknown> = {}

    // ── graph 시그널 ──
    let importsPassed = false
    if (det.importSpecifiers) {
      const matched = det.importSpecifiers.filter((s) => importSpecs.includes(s))
      if (matched.length > 0) {
        importsPassed = true
        evidence.imports = matched
      }
    }

    let patternsPassed = false
    if (det.callPatterns) {
      const matched = det.callPatterns.filter((s) => callPatterns.includes(s))
      if (matched.length > 0) {
        patternsPassed = true
        evidence.patterns = matched
      }
    }

    // ── manifest 시그널 (정의된 것은 모두 만족해야 함 — AND) ──
    let manifestPassed = true
    let anySignalDefined = false

    if (det.manifestFrameworkMatch) {
      anySignalDefined = true
      if (det.manifestFrameworkMatch.includes(fw as Framework)) {
        evidence.framework = fw
      } else {
        manifestPassed = false
      }
    }
    if (det.manifestRoutingLibMatch) {
      anySignalDefined = true
      const matched = det.manifestRoutingLibMatch.filter((pat) =>
        routingLibs.some((lib) => routingLibMatches(lib, pat)),
      )
      if (matched.length > 0) {
        evidence.routingLibs = matched
      } else {
        manifestPassed = false
      }
    }
    if (det.manifestRoutingLibAbsent) {
      anySignalDefined = true
      if (routingLibs.length === 0) {
        evidence.routingLibsAbsent = true
      } else {
        manifestPassed = false
      }
    }

    const graphSupplementPassed = importsPassed || patternsPassed

    // 시그널 정의 0건이면 후보 아님. manifest가 단일 framework로 좁게 잡힌
    // 하이브리드 repo는 graph import/call evidence가 있으면 보조 후보로 유지한다.
    if (!anySignalDefined && !graphSupplementPassed) continue
    if (anySignalDefined && !manifestPassed && !graphSupplementPassed) continue

    // ── min_evidence ──
    let evidenceOk = false
    switch (meta.minEvidence) {
      case 'manifest_only':
        evidenceOk = manifestPassed || graphSupplementPassed
        break
      case 'manifest_AND_imports':
        evidenceOk = manifestPassed && importsPassed
        break
      case 'any_two': {
        const count = Number(manifestPassed) + Number(importsPassed) + Number(patternsPassed)
        evidenceOk = count >= 2
        break
      }
    }

    const detectedVia: 'manifest' | 'imports' | 'pattern' = importsPassed
      ? 'imports'
      : patternsPassed
        ? 'pattern'
        : 'manifest'

    // ── mvp_post ──
    if (meta.mvpStatus === 'mvp_post') {
      out.push({
        framework: meta.framework,
        detectedVia,
        evidence,
        active: false,
        skippedReason: 'mvp_post',
        priority: meta.priority,
        exclusiveWith: meta.exclusiveWith ?? [],
      })
      continue
    }

    if (!evidenceOk) {
      out.push({
        framework: meta.framework,
        detectedVia,
        evidence,
        active: false,
        skippedReason: 'min_evidence_failed',
        priority: meta.priority,
        exclusiveWith: meta.exclusiveWith ?? [],
      })
      continue
    }

    out.push({
      framework: meta.framework,
      detectedVia,
      evidence,
      active: true,
      priority: meta.priority,
      exclusiveWith: meta.exclusiveWith ?? [],
    })
  }

  return out
}

/**
 * priority 내림차순 + exclusive_with 양방향 충돌 해소.
 * 같은 priority면 evidence 강도 (importsPassed/patternsPassed 카운트) 큰 쪽 우선.
 */
export function resolveConflicts(
  results: FrameworkDetectionResult[],
): FrameworkDetectionResult[] {
  const score = (r: FrameworkDetectionResult): number => {
    let s = r.priority * 10
    // evidence 강도 가산점 — 같은 priority tiebreak
    const ev = r.evidence
    if (ev.imports) s += 2
    if (ev.patterns) s += 2
    if (ev.framework) s += 1
    if (ev.routingLibs) s += 1
    return s
  }

  const sorted = [...results.filter((r) => r.active)].sort((a, b) => score(b) - score(a))
  const killed = new Set<string>()

  for (const top of sorted) {
    if (killed.has(top.framework)) continue
    for (const other of sorted) {
      if (other.framework === top.framework) continue
      if (killed.has(other.framework)) continue
      const conflict =
        top.exclusiveWith.includes(other.framework) ||
        other.exclusiveWith.includes(top.framework)
      if (conflict) killed.add(other.framework)
    }
  }

  return results.map((r) =>
    killed.has(r.framework) && r.active
      ? { ...r, active: false, skippedReason: 'exclusive_with' as const }
      : r,
  )
}

/**
 * 'react-router-dom@^6' 같은 패키지 이름 + semver 패턴 매칭.
 * 단순 prefix 비교 — analyze_repo가 정규화된 'name@^N' 형식을 채운다고 가정.
 */
function routingLibMatches(actual: string, pattern: string): boolean {
  if (actual === pattern) return true
  const [actualName, actualRange] = actual.split('@')
  const [patternName, patternRange] = pattern.split('@')
  if (!actualName || !patternName || actualName !== patternName) return false
  if (!patternRange) return true
  if (!actualRange) return false
  if (patternRange.startsWith('^')) {
    const major = patternRange.slice(1).split('.')[0]
    return actualRange === `^${major}` || actualRange.startsWith(`^${major}.`)
  }
  return false
}

// ────────────────────────────────────────
// orchestrator (Step 3b — yaml 로드 후 활성)
// ────────────────────────────────────────
export async function activateAdapters(_input: {
  repoId: string
  stackInfo: StackInfoForBuildRoute
  repoPath: string
}): Promise<FrameworkDetectionResult[]> {
  throw new Error(
    'NOT_IMPLEMENTED: yaml loader 미작성 — Step 3b에서 완성. 단위 테스트는 evaluateDetection / resolveConflicts 사용.',
  )
}
