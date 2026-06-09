/**
 * mergeStackInfo 단위 테스트 (static-core)
 *
 * 검증 대상: src/pipeline_modules/analyze_repo/index.ts — mergeStackInfo(identity, standard)
 *
 * 함수 동작 요약 (코드 SOT):
 *   - type/language/framework: identity에서, null이면 'backend'/'other'/'other' fallback
 *   - path_aliases/base_url/entrypoint_files/routing_libs/schema_sources/routing_files: standard 그대로
 *   - custom_decorators: 항상 {} (LLM 전용이었음 → static-core에서 제거, build_route 루프가 후속 발견)
 *   - Zod 검증 실패 시 'mergeStackInfo Zod 검증 실패' throw
 *   - SOT 워닝은 이 함수에서 발화 안 함 (computeSotWarnings로 분리됨)
 */

import { describe, it, expect } from 'vitest'
import { mergeStackInfo } from '@/pipeline_modules/analyze_repo/index.js'
import type { IdentitySignal, StandardSlots } from '@/pipeline_modules/analyze_repo/types.js'

function makeIdentity(overrides: Partial<IdentitySignal> = {}): IdentitySignal {
  return {
    language: 'typescript',
    language_raw: null,
    framework: 'nestjs',
    framework_raw: null,
    type: 'backend',
    orm: null,
    build_tool: null,
    confidence: 'high',
    reasoning: '',
    ambiguous: false,
    ...overrides,
  }
}

function makeStandard(overrides: Partial<StandardSlots> = {}): StandardSlots {
  return {
    path_aliases: {},
    base_url: null,
    entrypoint_files: ['src/main.ts'],
    routing_files: [],
    routing_libs: [],
    schema_sources: [],
    needsLLMRouting: false,
    needsLLMCustomDecorators: false,
    ...overrides,
  }
}

describe('mergeStackInfo', () => {
  // M1: 정상 병합 — identity + standard 일관성
  it('M1: 정상 병합 — identity + standard 합쳐짐, 반환값 구조 검증', () => {
    const result = mergeStackInfo(
      makeIdentity(),
      makeStandard({
        path_aliases: { '@': 'src' },
        entrypoint_files: ['src/main.ts'],
        routing_files: ['src/app.module.ts'],
      }),
    )

    expect(result.type).toBe('backend')
    expect(result.language).toBe('typescript')
    expect(result.framework).toBe('nestjs')
    expect(result.path_aliases).toEqual({ '@': 'src' })
    expect(result.base_url).toBeNull()
    expect(result.entrypoint_files).toEqual(['src/main.ts'])
    expect(result.routing_files).toEqual(['src/app.module.ts'])
    expect(result.custom_decorators).toEqual({})
    expect(result.routing_libs).toEqual([])
    expect(result.schema_sources).toEqual([])
  })

  // M2: routing_files는 standard 그대로
  it('M2: routing_files — standard 값 그대로', () => {
    const result = mergeStackInfo(makeIdentity(), makeStandard({ routing_files: ['src/router.ts'] }))
    expect(result.custom_decorators).toEqual({})
    expect(result.routing_files).toEqual(['src/router.ts'])
  })

  // M3: static-core — routing_files는 standard만, LLM fallback 없음 → standard 비면 []
  it('M3: routing_files — static-core, standard 비어있으면 [] (ambiguous fallback 제거)', () => {
    const result = mergeStackInfo(makeIdentity(), makeStandard({ routing_files: [] }))
    expect(result.routing_files).toEqual([])
  })

  // M7: identity null fallback — language/framework/type null이면 기본값
  it('M7: identity null fallback — language/framework/type null → other/other/backend', () => {
    const result = mergeStackInfo(
      makeIdentity({ language: null, framework: null, type: null }),
      makeStandard(),
    )
    expect(result.language).toBe('other')
    expect(result.framework).toBe('other')
    expect(result.type).toBe('backend')
  })

  // M8: custom_decorators — static-core에서 항상 {} (LLM 전용 필드 제거)
  it('M8: custom_decorators — 항상 빈 객체', () => {
    const result = mergeStackInfo(makeIdentity(), makeStandard())
    expect(result.custom_decorators).toEqual({})
  })

  // M9: schema_sources — standard 값 그대로 포함
  it('M9: schema_sources — standard 값 그대로 포함', () => {
    const standard = makeStandard({
      schema_sources: [
        { orm: 'prisma', provider: 'postgresql', schema_paths: ['prisma/schema.prisma'], label: 'Prisma' },
      ],
    })
    const result = mergeStackInfo(makeIdentity(), standard)
    expect(result.schema_sources).toEqual([
      { orm: 'prisma', provider: 'postgresql', schema_paths: ['prisma/schema.prisma'], label: 'Prisma' },
    ])
  })

  // M10: routing_libs — standard 값 그대로
  it('M10: routing_libs — standard 값 그대로 포함', () => {
    const result = mergeStackInfo(
      makeIdentity({ framework: 'flutter', type: 'mobile' }),
      makeStandard({ routing_libs: ['go_router'] }),
    )
    expect(result.routing_libs).toEqual(['go_router'])
  })

  // M11: Zod 검증 실패 — unsafe path 포함 시 throw
  it('M11: unsafe path(../etc/passwd) → mergeStackInfo Zod 검증 실패 throw', () => {
    const standard = makeStandard({ routing_files: ['../etc/passwd'] })
    expect(() => mergeStackInfo(makeIdentity(), standard)).toThrow('mergeStackInfo Zod 검증 실패')
  })

  // M13: Zod 검증 실패 — 절대 경로
  it('M13: 절대 경로(/etc/passwd) → mergeStackInfo Zod 검증 실패 throw', () => {
    const standard = makeStandard({ entrypoint_files: ['/etc/passwd'] })
    expect(() => mergeStackInfo(makeIdentity(), standard)).toThrow('mergeStackInfo Zod 검증 실패')
  })

  // M15: flutter 타입 병합 — mobile type + routing_libs
  it('M15: mobile(flutter) — type=mobile, routing_libs 병합 정상', () => {
    const identity = makeIdentity({ framework: 'flutter', type: 'mobile', language: 'dart' })
    const standard = makeStandard({ routing_libs: ['go_router'], routing_files: ['lib/router.dart'] })
    const result = mergeStackInfo(identity, standard)
    expect(result.type).toBe('mobile')
    expect(result.framework).toBe('flutter')
    expect(result.language).toBe('dart')
    expect(result.routing_libs).toEqual(['go_router'])
    expect(result.routing_files).toEqual(['lib/router.dart'])
  })
})
