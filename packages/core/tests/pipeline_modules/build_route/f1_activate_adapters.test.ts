import { describe, it, expect } from 'vitest'
import {
  activateAdapters,
  evaluateDetection,
  resolveConflicts,
} from '@/pipeline_modules/build_route/f1_activate_adapters.js'
import type {
  AdapterMeta,
  StackInfoForBuildRoute,
} from '@/pipeline_modules/build_route/types.js'

// ────────────────────────────────────────
// inline meta fixture (Step 5 yaml과 1:1 대응 예정)
// ────────────────────────────────────────

const NESTJS: AdapterMeta = {
  framework: 'nestjs',
  priority: 50,
  detection: {
    manifestFrameworkMatch: ['nestjs'],
    importSpecifiers: ['@nestjs/core', '@nestjs/common'],
  },
  minEvidence: 'manifest_only',
}

const EXPRESS: AdapterMeta = {
  framework: 'express',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['express'],
    importSpecifiers: ['express'],
  },
  minEvidence: 'manifest_only',
}

const FASTIFY: AdapterMeta = {
  framework: 'fastify',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['fastify'],
    importSpecifiers: ['fastify'],
  },
  minEvidence: 'manifest_only',
}

const KOA: AdapterMeta = {
  framework: 'koa',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['koa'],
    importSpecifiers: ['koa', '@koa/router', 'koa-router'],
  },
  minEvidence: 'manifest_only',
}

const HONO: AdapterMeta = {
  framework: 'hono',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['hono'],
    importSpecifiers: ['hono'],
  },
  minEvidence: 'manifest_only',
}

const ELYSIA: AdapterMeta = {
  framework: 'elysia',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['elysia'],
    importSpecifiers: ['elysia'],
  },
  minEvidence: 'manifest_only',
}

const NEXTJS: AdapterMeta = {
  framework: 'nextjs',
  priority: 40,
  exclusiveWith: ['react_router_v6'],
  detection: {
    manifestFrameworkMatch: ['nextjs'],
    importSpecifiers: ['next'],
  },
  minEvidence: 'manifest_only',
}

const RR_V6: AdapterMeta = {
  framework: 'react_router_v6',
  priority: 30,
  detection: {
    // routing_lib 패턴만으로 후보 (다른 framework + 동일 lib 케이스 — 모노레포)
    manifestRoutingLibMatch: ['react-router-dom@^4', 'react-router-dom@^6', 'react-router@^0', 'react-router@^4', 'react-router@^6', 'react-router@^7', 'react-router'],
    importSpecifiers: ['react-router-dom', 'react-router'],
  },
  minEvidence: 'manifest_AND_imports',
}

const RR_V5: AdapterMeta = {
  framework: 'react_router_v5',
  priority: 30,
  mvpStatus: 'mvp_post',
  detection: {
    manifestRoutingLibMatch: ['react-router-dom@^5'],
  },
  minEvidence: 'manifest_only',
}

const FLUTTER_GOROUTER: AdapterMeta = {
  framework: 'flutter_gorouter',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['go_router'],
  },
  minEvidence: 'manifest_only',
}

const FLUTTER_AUTO_ROUTE: AdapterMeta = {
  framework: 'flutter_auto_route',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['auto_route'],
  },
  minEvidence: 'manifest_only',
}

const FLUTTER_GETX: AdapterMeta = {
  framework: 'flutter_getx',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['get'],
  },
  minEvidence: 'manifest_only',
}

const FLUTTER_BEAMER: AdapterMeta = {
  framework: 'flutter_beamer',
  priority: 30,
  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibMatch: ['beamer'],
  },
  minEvidence: 'manifest_only',
}

const FLUTTER_NAVIGATOR: AdapterMeta = {
  framework: 'flutter_navigator',
  priority: 10,
  detection: {
    manifestFrameworkMatch: ['flutter'],
    manifestRoutingLibAbsent: true,
  },
  minEvidence: 'manifest_only',
}

const ALL_METAS: AdapterMeta[] = [
  NESTJS,
  EXPRESS,
  FASTIFY,
  KOA,
  HONO,
  ELYSIA,
  NEXTJS,
  RR_V6,
  RR_V5,
  FLUTTER_GOROUTER,
  FLUTTER_AUTO_ROUTE,
  FLUTTER_GETX,
  FLUTTER_BEAMER,
  FLUTTER_NAVIGATOR,
]

// 헬퍼: 단순 stackInfo 생성
function stack(partial: Partial<StackInfoForBuildRoute> & Pick<StackInfoForBuildRoute, 'framework'>): StackInfoForBuildRoute {
  return { routingLibs: [], ...partial }
}

// 헬퍼: 활성 framework name 추출
function activeNames(results: ReturnType<typeof resolveConflicts>): string[] {
  return results.filter((r) => r.active).map((r) => r.framework).sort()
}

// ────────────────────────────────────────
// S1~S12
// ────────────────────────────────────────

describe('f1 evaluateDetection — 단일 어댑터 활성', () => {
  it('S1: NestJS only → nestjs active', () => {
    const stackInfo = stack({ framework: 'nestjs' })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['nestjs'])
    const nest = out.find((r) => r.framework === 'nestjs')!
    expect(nest.active).toBe(true)
    expect(nest.detectedVia).toBe('manifest')
    expect(nest.priority).toBe(50)
  })

  it('S2: Express only → express active', () => {
    const stackInfo = stack({ framework: 'express' })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['express'])
  })

  it.each([
    ['fastify'],
    ['koa'],
    ['hono'],
    ['elysia'],
  ] as const)('S2b: %s only → matching backend adapter active', (framework) => {
    const out = resolveConflicts(evaluateDetection(stack({ framework }), ALL_METAS))
    expect(activeNames(out)).toEqual([framework])
  })
})

describe('f1 — Flutter 분기 (routing_libs 핵심)', () => {
  it('S4: flutter + go_router → flutter_gorouter active', () => {
    const stackInfo = stack({ framework: 'flutter', routingLibs: ['go_router'] })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['flutter_gorouter'])
  })

  it('S5: flutter + routing_libs=[] → flutter_navigator active (기본 가정)', () => {
    const stackInfo = stack({ framework: 'flutter', routingLibs: [] })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['flutter_navigator'])
  })

  it('S6: flutter + auto_route → flutter_auto_route active', () => {
    const stackInfo = stack({ framework: 'flutter', routingLibs: ['auto_route'] })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['flutter_auto_route'])
    const auto = out.find((r) => r.framework === 'flutter_auto_route')!
    expect(auto.active).toBe(true)
  })

  it('S7: flutter + get → flutter_getx active', () => {
    const stackInfo = stack({ framework: 'flutter', routingLibs: ['get'] })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['flutter_getx'])
  })

  it('S8: flutter + beamer → flutter_beamer active', () => {
    const stackInfo = stack({ framework: 'flutter', routingLibs: ['beamer'] })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['flutter_beamer'])
  })
})

describe('f1 — exclusive_with / 모노레포', () => {
  it('S3: Next.js + react-router-dom@^6 → nextjs active=1, rr_v6 active=0 (exclusive_with)', () => {
    const stackInfo = stack({
      framework: 'nextjs',
      routingLibs: ['react-router-dom@^6'],
    })
    // imports 시그널이 없으면 RR_V6의 minEvidence='manifest_AND_imports' 통과 못 하니
    // 추가 imports 시그널을 stackInfo에 가정 — 별도 graph 인자로 simulate
    const out = resolveConflicts(
      evaluateDetection(stackInfo, ALL_METAS, {
        importSpecifiers: ['next', 'react-router-dom'],
      }),
    )
    expect(activeNames(out)).toEqual(['nextjs'])
    const rr = out.find((r) => r.framework === 'react_router_v6')!
    expect(rr.active).toBe(false)
    expect(rr.skippedReason).toBe('exclusive_with')
  })

  it('S8: NestJS + Next.js 모노레포 → graph imports로 둘 다 active', () => {
    const stackInfo = stack({ framework: 'nextjs' })
    const out = resolveConflicts(
      evaluateDetection(stackInfo, ALL_METAS, {
        importSpecifiers: ['@nestjs/core', 'next'],
      }),
    )
    expect(activeNames(out)).toEqual(['nestjs', 'nextjs'])
    expect(out.find((r) => r.framework === 'nestjs')).toMatchObject({
      active: true,
      detectedVia: 'imports',
      evidence: { imports: ['@nestjs/core'] },
    })
  })

  it('S8b: framework other + NestJS imports → nestjs active from source evidence', () => {
    const out = resolveConflicts(
      evaluateDetection(stack({ framework: 'other' }), ALL_METAS, {
        importSpecifiers: ['@nestjs/common'],
      }),
    )

    expect(activeNames(out)).toEqual(['nestjs'])
    expect(out.find((r) => r.framework === 'nestjs')).toMatchObject({
      active: true,
      detectedVia: 'imports',
      evidence: { imports: ['@nestjs/common'] },
    })
  })
})

describe('f1 — skip / min_evidence / fallback', () => {
  it('S7: react + routing_libs=[] → 어댑터 0개 (router 없는 SPA)', () => {
    const stackInfo = stack({ framework: 'react', routingLibs: [] })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual([])
  })

  it('S9: react-router-dom@^5 → mvp_post', () => {
    const stackInfo = stack({
      framework: 'react',
      routingLibs: ['react-router-dom@^5'],
    })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual([])
    const v5 = out.find((r) => r.framework === 'react_router_v5')!
    expect(v5.skippedReason).toBe('mvp_post')
  })

  it('S10: react + react-router-dom@^6 manifest 매치하지만 imports 없음 → min_evidence_failed', () => {
    const stackInfo = stack({
      framework: 'react',
      routingLibs: ['react-router-dom@^6'],
    })
    // imports 시그널 없음 → minEvidence='manifest_AND_imports' fail
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual([])
    const rr = out.find((r) => r.framework === 'react_router_v6')!
    expect(rr.active).toBe(false)
    expect(rr.skippedReason).toBe('min_evidence_failed')
  })

  it('S10b: react-router package import also activates React Router adapter', () => {
    const stackInfo = stack({
      framework: 'react',
      routingLibs: ['react-router@^0'],
    })
    const out = resolveConflicts(
      evaluateDetection(stackInfo, ALL_METAS, {
        importSpecifiers: ['react-router'],
      }),
    )
    expect(activeNames(out)).toEqual(['react_router_v6'])
  })

  it('S10c: bare react-router manifest lib also activates React Router adapter with imports', () => {
    const stackInfo = stack({
      framework: 'react',
      routingLibs: ['react-router'],
    })
    const out = resolveConflicts(
      evaluateDetection(stackInfo, ALL_METAS, {
        importSpecifiers: ['react-router'],
      }),
    )
    expect(activeNames(out)).toEqual(['react_router_v6'])
  })

  it('S10d: react-router-dom@^4 activates React Router adapter with imports', () => {
    const stackInfo = stack({
      framework: 'react',
      routingLibs: ['react-router-dom@^4'],
    })
    const out = resolveConflicts(
      evaluateDetection(stackInfo, ALL_METAS, {
        importSpecifiers: ['react-router-dom'],
      }),
    )
    expect(activeNames(out)).toEqual(['react_router_v6'])
  })

  it('S11: 같은 priority 충돌 → evidence 강도 tiebreak (manifest_AND_imports > manifest_only)', () => {
    // 가상 메타 — 같은 priority, 같은 framework match
    const A: AdapterMeta = {
      framework: 'a',
      priority: 30,
      detection: { manifestFrameworkMatch: ['react'] },
      minEvidence: 'manifest_only',
    }
    const B: AdapterMeta = {
      framework: 'b',
      priority: 30,
      exclusiveWith: ['a'],
      detection: { manifestFrameworkMatch: ['react'], importSpecifiers: ['lib-b'] },
      minEvidence: 'manifest_AND_imports',
    }
    const stackInfo = stack({ framework: 'react' })
    const out = resolveConflicts(
      evaluateDetection(stackInfo, [A, B], { importSpecifiers: ['lib-b'] }),
    )
    expect(activeNames(out)).toEqual(['b'])
    const a = out.find((r) => r.framework === 'a')!
    expect(a.skippedReason).toBe('exclusive_with')
  })

  it('S12: framework="other" → 빈 배열', () => {
    const stackInfo = stack({ framework: 'other' })
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(out).toEqual([])
  })
})

describe('f1 — graceful (구 데이터)', () => {
  it('routingLibs undefined → 빈 배열로 처리', () => {
    // TS는 required로 잡지만 런타임 graceful (analyze_repo 구 데이터)
    const stackInfo = { framework: 'flutter' as const } as StackInfoForBuildRoute
    const out = resolveConflicts(evaluateDetection(stackInfo, ALL_METAS))
    expect(activeNames(out)).toEqual(['flutter_navigator'])
  })

  it('patterns 시그널로 detectedVia=pattern 및 any_two evidence 통과', () => {
    const meta: AdapterMeta = {
      framework: 'a',
      priority: 10,
      detection: {
        manifestFrameworkMatch: ['express'],
        callPatterns: ['Router.get'],
      },
      minEvidence: 'any_two',
    }

    const out = evaluateDetection(stack({ framework: 'express' }), [meta], {
      callPatterns: ['Router.get'],
    })

    expect(out).toMatchObject([{
      framework: 'a',
      active: true,
      detectedVia: 'pattern',
      evidence: { framework: 'express', patterns: ['Router.get'] },
    }])
  })

  it('patterns evidence도 같은 priority 충돌 해소 점수에 반영', () => {
    const patternMeta: AdapterMeta = {
      framework: 'patterned',
      priority: 10,
      exclusiveWith: ['plain'],
      detection: {
        manifestFrameworkMatch: ['express'],
        callPatterns: ['Router.get'],
      },
      minEvidence: 'any_two',
    }
    const plainMeta: AdapterMeta = {
      framework: 'plain',
      priority: 10,
      detection: { manifestFrameworkMatch: ['express'] },
      minEvidence: 'manifest_only',
    }

    const out = resolveConflicts(
      evaluateDetection(stack({ framework: 'express' }), [patternMeta, plainMeta], {
        callPatterns: ['Router.get'],
      }),
    )

    expect(activeNames(out)).toEqual(['patterned'])
    expect(out.find((r) => r.framework === 'plain')).toMatchObject({
      active: false,
      skippedReason: 'exclusive_with',
    })
  })

  it('any_two는 manifest 단독이면 min_evidence_failed', () => {
    const meta: AdapterMeta = {
      framework: 'a',
      priority: 10,
      detection: { manifestFrameworkMatch: ['express'], callPatterns: ['Router.get'] },
      minEvidence: 'any_two',
    }

    const out = evaluateDetection(stack({ framework: 'express' }), [meta])

    expect(out).toMatchObject([{
      framework: 'a',
      active: false,
      skippedReason: 'min_evidence_failed',
    }])
  })

  it('non-caret routing lib pattern은 exact match가 아니면 매치하지 않음', () => {
    const meta: AdapterMeta = {
      framework: 'a',
      priority: 10,
      detection: { manifestRoutingLibMatch: ['router@~1'] },
      minEvidence: 'manifest_only',
    }

    expect(evaluateDetection(stack({ framework: 'react', routingLibs: ['router@~1.2.3'] }), [meta])).toEqual([])
  })

  it('exclusiveWith는 낮은 쪽에서만 선언해도 높은 우선순위 어댑터가 낮은 쪽을 비활성화', () => {
    const high: AdapterMeta = {
      framework: 'high',
      priority: 20,
      detection: { manifestFrameworkMatch: ['react'] },
      minEvidence: 'manifest_only',
    }
    const mid: AdapterMeta = {
      framework: 'mid',
      priority: 15,
      detection: { manifestFrameworkMatch: ['react'] },
      minEvidence: 'manifest_only',
    }
    const low: AdapterMeta = {
      framework: 'low',
      priority: 10,
      exclusiveWith: ['high', 'mid'],
      detection: { manifestFrameworkMatch: ['react'] },
      minEvidence: 'manifest_only',
    }

    const out = resolveConflicts(evaluateDetection(stack({ framework: 'react' }), [high, mid, low]))

    expect(out.find((r) => r.framework === 'low')).toMatchObject({
      active: false,
      skippedReason: 'exclusive_with',
    })
    expect(activeNames(out)).toEqual(['high', 'mid'])
  })

  it('activateAdapters는 yaml loader 구현 전 stub 에러를 반환', async () => {
    await expect(activateAdapters({
      repoId: 'repo',
      repoPath: '/repo',
      stackInfo: stack({ framework: 'express' }),
    })).rejects.toThrow('NOT_IMPLEMENTED')
  })
})
