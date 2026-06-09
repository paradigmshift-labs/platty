import { describe, it, expect } from 'vitest'
import {
  loadAdapters,
  AdapterLoadError,
} from '@/pipeline_modules/build_route/f2_load_adapters.js'
import type {
  Adapter,
  AdapterRegistry,
  FrameworkDetectionResult,
  StackInfoForBuildRoute,
} from '@/pipeline_modules/build_route/types.js'

function det(framework: string, active: boolean, priority = 50): FrameworkDetectionResult {
  return {
    framework,
    detectedVia: 'manifest',
    evidence: {},
    active,
    priority,
    exclusiveWith: [],
  }
}

function stack(extra: Partial<StackInfoForBuildRoute> = {}): StackInfoForBuildRoute {
  return { framework: 'nestjs', routingLibs: [], ...extra }
}

const FAKE_NEXTJS: Adapter = {
  name: 'nextjs',
  version: '1.0.0',
  type: 'A',
  language: 'typescript',
  detection: { manifestFrameworkMatch: ['nextjs'] },
  minEvidence: 'manifest_only',
  priority: 40,
  entrypointRules: [],
  aliasResolution: { standardDecorators: [] },
}

describe('S1: active 어댑터 1개 (real nestjs registry)', () => {
  it('Adapter 1 로드 + resolvedAliases 빈', () => {
    const out = loadAdapters({
      detections: [det('nestjs', true)],
      stackInfo: stack(),
    })
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('nestjs')
    expect(out[0].resolvedAliases).toEqual({})
  })
})

describe('S2: customDecorators merge (analyze_repo)', () => {
  it("ApiGet wrapper → resolvedAliases.ApiGet.source='analyze_repo'", () => {
    const out = loadAdapters({
      detections: [det('nestjs', true)],
      stackInfo: stack({
        customDecorators: {
          ApiGet: { resolvesTo: 'Get', source: '@my/lib' },
        },
      }),
    })
    expect(out[0].resolvedAliases.ApiGet).toEqual({
      resolvesTo: 'Get',
      source: 'analyze_repo',
    })
  })
})

describe('S4: REGISTRY에 framework 없음', () => {
  it('throw ADAPTER_NOT_REGISTERED', () => {
    expect(() =>
      loadAdapters({
        detections: [det('xunknown', true)],
        stackInfo: stack({ framework: 'other' }),
      }),
    ).toThrow(AdapterLoadError)

    try {
      loadAdapters({
        detections: [det('xunknown', true)],
        stackInfo: stack({ framework: 'other' }),
      })
    } catch (e) {
      expect((e as AdapterLoadError).code).toBe('ADAPTER_NOT_REGISTERED')
    }
  })
})

describe('S5: active 0개', () => {
  it('빈 배열 반환', () => {
    expect(
      loadAdapters({
        detections: [det('nestjs', false)],
        stackInfo: stack(),
      }),
    ).toEqual([])
  })
})

describe('S6: 모노레포 (real REGISTRY — nestjs + nextjs)', () => {
  it('둘 다 로드', () => {
    const out = loadAdapters({
      detections: [det('nestjs', true), det('nextjs', true, 40)],
      stackInfo: stack(),
    })
    expect(out.map((a) => a.name).sort()).toEqual(['nestjs', 'nextjs'])
  })

  it('mock registry override 도 동작', () => {
    const registry: AdapterRegistry = { mockfw: FAKE_NEXTJS }
    const out = loadAdapters({
      detections: [det('mockfw', true)],
      stackInfo: stack(),
      registryOverride: registry,
    })
    expect(out[0].name).toBe('nextjs') // FAKE_NEXTJS 의 name
  })
})

describe('REGISTRY 어댑터 정합성', () => {
  it('all route adapters import 가능', () => {
    const frameworks = [
      'nestjs',
      'express',
      'fastify',
      'koa',
      'hono',
      'elysia',
      'nextjs',
      'nuxt',
      'sveltekit',
      'astro',
      'react_router_v6',
      'flutter_gorouter',
      'flutter_navigator',
      'flutter_getx',
      'flutter_auto_route',
      'flutter_beamer',
      'spring',
    ]
    const out = loadAdapters({
      detections: frameworks.map((f) => det(f, true)),
      stackInfo: stack(),
    })
    expect(out).toHaveLength(frameworks.length)
    expect(out.map((a) => a.name).sort()).toEqual([...frameworks].sort())
  })
})

describe('S8: override 우선', () => {
  it('analyze_repo 매핑을 override가 덮어씀', () => {
    const out = loadAdapters({
      detections: [det('nestjs', true)],
      stackInfo: stack({
        customDecorators: {
          ApiGet: { resolvesTo: 'Get', source: '@my/lib' },
        },
      }),
      overrideAliases: {
        nestjs: {
          ApiGet: { resolvesTo: 'Post', source: 'override' },
        },
      },
    })
    expect(out[0].resolvedAliases.ApiGet).toEqual({
      resolvesTo: 'Post',
      source: 'override',
    })
  })
})

describe('S9: entrypointRules 빈 어댑터도 정상 (mock)', () => {
  it('Adapter 반환', () => {
    const out = loadAdapters({
      detections: [det('nextjs', true, 40)],
      stackInfo: stack(),
      registryOverride: { nextjs: FAKE_NEXTJS },
    })
    expect(out[0].entrypointRules).toEqual([])
  })
})
