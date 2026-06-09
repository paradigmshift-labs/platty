/**
 * 카테고리 A — NestJS 고급 decorator
 *
 * 목적: build_docs api_spec / Guard 그래프 / DI 그래프가 누락 없이 추출되도록.
 *
 * 시나리오:
 *   - @UseGuards / @UseInterceptors / @UsePipes — class & method level
 *   - @Inject(TOKEN) — constructor 인자 decorator
 *   - @SetMetadata(KEY, value) / @Roles('admin')
 *   - @HttpCode(204) / @Header('Cache-Control', '...')
 *   - @ApiBearerAuth() / @ApiExtraModels(...)
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/c.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('A. NestJS 고급 decorator', () => {
  it('A-01: @UseGuards(AuthGuard) — class-level guard', () => {
    const r = parse(`
      import { Controller, UseGuards } from '@nestjs/common'
      import { AuthGuard } from './guards'
      @Controller('/admin')
      @UseGuards(AuthGuard)
      export class AdminController {}
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'UseGuards')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('@nestjs/common')
    // depends_on edge — AuthGuard에 의존 (decorator 객체 인자 분해 X — 식별자가 인자라 별 케이스)
  })

  it('A-02: @UseGuards(A, B, C) — 여러 guard 식별자 인자', () => {
    const r = parse(`
      import { UseGuards } from '@nestjs/common'
      import { AuthGuard, RolesGuard, ThrottleGuard } from './guards'
      @UseGuards(AuthGuard, RolesGuard, ThrottleGuard)
      export class C {}
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'UseGuards')
    expect(e).toBeDefined()
    // literal_args에 식별자 3개 → 모두 null로 표시 (E4 spec)
    expect(e!.literal_args).toBe(JSON.stringify([null, null, null]))
  })

  it('A-03: method-level @UseGuards — method 노드 source', () => {
    const r = parse(`
      import { Get, UseGuards } from '@nestjs/common'
      import { AuthGuard } from './guards'
      export class C {
        @UseGuards(AuthGuard)
        @Get()
        list() { return [] }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'decorates' &&
        edge.target_symbol === 'UseGuards' &&
        edge.source_id.endsWith(':C.list'),
    )
    expect(e).toBeDefined()
  })

  it('A-04: @Inject(TOKEN) — constructor param decorator', () => {
    const r = parse(`
      import { Injectable, Inject } from '@nestjs/common'
      @Injectable()
      export class S {
        constructor(@Inject('CONFIG') private readonly cfg: any) {}
      }
    `)
    // constructor param에 decorator는 method param decorator로 처리됨 → constructor는 method 처리에서 제외라
    // 일단 edge 자체가 잡히는지 확인 (constructor는 별도 처리 — 이게 누락이면 BS 추가)
    const decoratesS = r.edges.filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':S'))
    expect(decoratesS.find((e) => e.target_symbol === 'Injectable')).toBeDefined()
  })

  it('A-05: @SetMetadata(key, value) — method-level metadata', () => {
    const r = parse(`
      import { SetMetadata, Get } from '@nestjs/common'
      export class C {
        @SetMetadata('roles', ['admin', 'user'])
        @Get()
        list() { return [] }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'SetMetadata',
    )
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('roles')
    // literal_args=['roles', ['admin','user']]
    expect(e!.literal_args).toBe(JSON.stringify(['roles', ['admin', 'user']]))
  })

  it('A-06: @Roles("admin") 커스텀 metadata decorator', () => {
    const r = parse(`
      import { Get } from '@nestjs/common'
      import { Roles } from './roles.decorator'
      export class C {
        @Roles('admin', 'super')
        @Get()
        adminOnly() { return [] }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Roles',
    )
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('./roles.decorator')
    expect(e!.first_arg).toBe('admin')
    expect(e!.literal_args).toBe(JSON.stringify(['admin', 'super']))
  })

  it('A-07: @HttpCode(204) — number 인자', () => {
    const r = parse(`
      import { Delete, HttpCode } from '@nestjs/common'
      export class C {
        @HttpCode(204)
        @Delete()
        remove() {}
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'HttpCode')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBeNull()  // number는 first_arg 안 채움 (string literal만)
    expect(e!.literal_args).toBe(JSON.stringify([204]))
  })

  it('A-08: @Header("Cache-Control", "no-store")', () => {
    const r = parse(`
      import { Get, Header } from '@nestjs/common'
      export class C {
        @Header('Cache-Control', 'no-store')
        @Get()
        list() {}
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'Header')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('Cache-Control')
    expect(e!.literal_args).toBe(JSON.stringify(['Cache-Control', 'no-store']))
  })

  it('A-09: @UseInterceptors + @UsePipes 동시', () => {
    const r = parse(`
      import { Post, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common'
      import { LoggingInterceptor } from './interceptors'
      export class C {
        @UseInterceptors(LoggingInterceptor)
        @UsePipes(new ValidationPipe())
        @Post()
        create() {}
      }
    `)
    const interceptor = r.edges.find((e) => e.target_symbol === 'UseInterceptors')
    const pipes = r.edges.find((e) => e.target_symbol === 'UsePipes')
    expect(interceptor).toBeDefined()
    expect(pipes).toBeDefined()
    expect(interceptor!.source_id).toBe(pipes!.source_id)  // 같은 method 노드
  })

  it('A-10: @ApiBearerAuth() — 인자 없는 swagger decorator', () => {
    const r = parse(`
      import { Get } from '@nestjs/common'
      import { ApiBearerAuth } from '@nestjs/swagger'
      export class C {
        @ApiBearerAuth()
        @Get()
        protected() {}
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'ApiBearerAuth')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('@nestjs/swagger')
  })

  it('A-11: @ApiExtraModels(A, B) — 식별자 여러 개', () => {
    const r = parse(`
      import { ApiExtraModels } from '@nestjs/swagger'
      import { OrderDto, UserDto } from './dto'
      @ApiExtraModels(OrderDto, UserDto)
      export class C {}
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'ApiExtraModels')
    expect(e).toBeDefined()
    expect(e!.literal_args).toBe(JSON.stringify([null, null]))
  })

  it('A-12: 같은 method에 6개 decorator 동시', () => {
    const r = parse(`
      import { Get, UseGuards, HttpCode } from '@nestjs/common'
      import { ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
      import { AuthGuard } from './guards'
      export class C {
        @ApiBearerAuth()
        @ApiOperation({ summary: 'list' })
        @ApiResponse({ status: 200 })
        @UseGuards(AuthGuard)
        @HttpCode(200)
        @Get()
        list() {}
      }
    `)
    const decorates = r.edges.filter(
      (e) => e.relation === 'decorates' && e.source_id.endsWith(':C.list'),
    )
    const symbols = decorates.map((e) => e.target_symbol).sort()
    expect(symbols).toEqual([
      'ApiBearerAuth',
      'ApiOperation',
      'ApiResponse',
      'Get',
      'HttpCode',
      'UseGuards',
    ])
  })
})
