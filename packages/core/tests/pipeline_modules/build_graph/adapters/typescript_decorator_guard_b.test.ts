// Guard B — UseGuards/UseInterceptors/UseFilters/UsePipes 화이트리스트 depends_on 발화
// SOT: spec scenarios-heroines.md HB-01 (FirebaseAuthGuard 추적)
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('Guard B: 데코레이터 화이트리스트 depends_on 발화', () => {
  it('GB-01: @UseGuards(SingleIdentifier) → depends_on edge 발화', () => {
    const r = parse(`
      import { Controller, UseGuards } from '@nestjs/common'
      import { FirebaseAuthGuard } from './guard'
      @Controller()
      @UseGuards(FirebaseAuthGuard)
      export class UserController {}
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'depends_on' && edge.target_symbol === 'FirebaseAuthGuard',
    )
    expect(e, 'depends_on FirebaseAuthGuard 발화').toBeDefined()
    expect(e!.source_id.endsWith(':UserController')).toBe(true)
  })

  it('GB-02: @UseGuards(A, B) — multi-arg → 각각 depends_on', () => {
    const r = parse(`
      import { UseGuards } from '@nestjs/common'
      @UseGuards(GuardA, GuardB)
      export class C {}
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'depends_on')
      .map((e) => e.target_symbol)
    expect(symbols).toContain('GuardA')
    expect(symbols).toContain('GuardB')
  })

  it('GB-03: @UseInterceptors(SingleIdentifier) → depends_on', () => {
    const r = parse(`
      import { UseInterceptors } from '@nestjs/common'
      @UseInterceptors(LogInterceptor)
      export class C {}
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'depends_on' && edge.target_symbol === 'LogInterceptor',
    )
    expect(e).toBeDefined()
  })

  it('GB-04: @UseFilters / @UsePipes 동일하게', () => {
    const r = parse(`
      import { UseFilters, UsePipes } from '@nestjs/common'
      @UseFilters(HttpExceptionFilter)
      @UsePipes(ValidationPipe)
      export class C {}
    `)
    const filters = r.edges.find(
      (e) => e.relation === 'depends_on' && e.target_symbol === 'HttpExceptionFilter',
    )
    const pipes = r.edges.find(
      (e) => e.relation === 'depends_on' && e.target_symbol === 'ValidationPipe',
    )
    expect(filters).toBeDefined()
    expect(pipes).toBeDefined()
  })

  it('GB-05: 비-화이트리스트 데코레이터는 기존 정책 유지 (@SetMetadata token 미발화)', () => {
    const r = parse(`
      import { SetMetadata } from '@nestjs/common'
      @SetMetadata('roles', ROLE_KEY)
      export class C {}
    `)
    // ROLE_KEY는 화이트리스트 외라 depends_on 미발화 (a7 §7 기존 정책)
    const e = r.edges.find(
      (edge) => edge.relation === 'depends_on' && edge.target_symbol === 'ROLE_KEY',
    )
    expect(e, '화이트리스트 외 데코는 단일 identifier 미발화').toBeUndefined()
  })

  it('GB-06: method-level @UseGuards on method → method node source의 depends_on', () => {
    const r = parse(`
      import { Controller, Get, UseGuards } from '@nestjs/common'
      @Controller()
      export class C {
        @UseGuards(AuthGuard)
        @Get()
        list() {}
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'depends_on' &&
        edge.target_symbol === 'AuthGuard' &&
        edge.source_id.endsWith(':C.list'),
    )
    expect(e, 'method 위 UseGuards depends_on').toBeDefined()
  })
})
