/**
 * E7 — class field decorator + property 노드 (BS-9)
 *
 * V1/V2 모두 method decorator만 처리하고 field decorator는 누락.
 * TypeORM/Swagger DTO/class-validator 거의 모든 NestJS 패턴이 영향.
 *
 * 보강:
 *   - new CodeNodeType 'property' 추가
 *   - public_field_definition 처리 → property 노드 생성
 *   - 'contains' edge (class → property)
 *   - field 위 decorator (여러 개 가능) → property 노드를 source로 'decorates' edge
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/u.ts') {
  return adapter.parseFile(content, filePath, 'r1')
}

// ────────────────────────────────────────────────
// E7-A. property 노드 + contains edge
// ────────────────────────────────────────────────
describe('E7-A: property 노드 생성 + contains edge', () => {
  it('E7-A-01: 단순 field → property 노드 생성 (name은 V1 호환으로 fullName=Class.field)', () => {
    const r = parse(`
      export class User {
        id: string
        name: string
      }
    `)
    const idNode = r.nodes.find((n) => n.type === 'property' && n.name === 'User.id')
    const nameNode = r.nodes.find((n) => n.type === 'property' && n.name === 'User.name')
    expect(idNode).toBeDefined()
    expect(nameNode).toBeDefined()
  })

  it('E7-A-02: contains edge (class → property)', () => {
    const r = parse(`
      export class User {
        id: string
      }
    `)
    const containsId = r.edges.find(
      (e) => e.relation === 'contains' && e.target_symbol === 'id',
    )
    expect(containsId).toBeDefined()
    expect(containsId!.source_id.endsWith(':User')).toBe(true)
  })

  it('E7-A-03: optional field (name?: string) → property 노드', () => {
    const r = parse(`
      export class User {
        name?: string
      }
    `)
    const node = r.nodes.find((n) => n.type === 'property' && n.name === 'User.name')
    expect(node).toBeDefined()
  })

  it('E7-A-04: initializer 있는 field (count = 0) → property 노드', () => {
    const r = parse(`
      export class C {
        count: number = 0
      }
    `)
    const node = r.nodes.find((n) => n.type === 'property' && n.name === 'C.count')
    expect(node).toBeDefined()
  })

  it('E7-A-05: private field (private x) → property 노드 (exported=false)', () => {
    const r = parse(`
      export class C {
        private secret: string
      }
    `)
    const node = r.nodes.find((n) => n.type === 'property' && n.name === 'C.secret')
    expect(node).toBeDefined()
    expect(node!.exported).toBe(false)
  })
})

// ────────────────────────────────────────────────
// E7-B. TypeORM entity field decorator
// ────────────────────────────────────────────────
describe('E7-B: TypeORM @Column / @PrimaryGeneratedColumn / @OneToMany', () => {
  it('E7-B-01: @PrimaryGeneratedColumn("uuid") → field source decorates edge', () => {
    const r = parse(`
      import { PrimaryGeneratedColumn } from 'typeorm'
      export class User {
        @PrimaryGeneratedColumn('uuid')
        id: string
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'PrimaryGeneratedColumn',
    )
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('uuid')
    expect(e!.target_specifier).toBe('typeorm')
    // source는 id property 노드
    expect(e!.source_id.endsWith(':User.id')).toBe(true)
  })

  it('E7-B-02: @Column({ unique: true }) — 객체 인자 walk (E4)', () => {
    const r = parse(`
      import { Column } from 'typeorm'
      export class User {
        @Column({ unique: true, length: 100 })
        email: string
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Column',
    )
    expect(e).toBeDefined()
    expect(e!.literal_args).toBe(JSON.stringify([{ unique: true, length: 100 }]))
    expect(e!.source_id.endsWith(':User.email')).toBe(true)
  })

  it('E7-B-03: 한 field에 여러 decorator (@Column + @Index)', () => {
    const r = parse(`
      import { Column, Index } from 'typeorm'
      export class User {
        @Column({ unique: true })
        @Index()
        email: string
      }
    `)
    const colEdge = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'Column',
    )
    const idxEdge = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'Index',
    )
    expect(colEdge).toBeDefined()
    expect(idxEdge).toBeDefined()
    // 둘 다 같은 source (User.email property)
    expect(colEdge!.source_id).toBe(idxEdge!.source_id)
    expect(colEdge!.source_id.endsWith(':User.email')).toBe(true)
  })

  it('E7-B-04: @OneToMany — arrow function 인자도 정상 처리', () => {
    const r = parse(`
      import { OneToMany } from 'typeorm'
      import { Order } from './order.entity'
      export class User {
        @OneToMany(() => Order, (order) => order.user)
        orders: Order[]
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'OneToMany',
    )
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('typeorm')
    expect(e!.source_id.endsWith(':User.orders')).toBe(true)
  })
})

// ────────────────────────────────────────────────
// E7-C. Swagger DTO + class-validator (한 field 다중 decorator)
// ────────────────────────────────────────────────
describe('E7-C: Swagger DTO + class-validator', () => {
  it('E7-C-01: @ApiProperty + @IsString + @IsEmail (3 decorator on email field)', () => {
    const r = parse(`
      import { ApiProperty } from '@nestjs/swagger'
      import { IsString, IsEmail } from 'class-validator'
      export class CreateUserDto {
        @ApiProperty({ example: 'tom@x.com' })
        @IsString()
        @IsEmail()
        email: string
      }
    `)
    const targets = r.edges
      .filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':CreateUserDto.email'))
      .map((e) => e.target_symbol)
      .sort()
    expect(targets).toEqual(['ApiProperty', 'IsEmail', 'IsString'])
  })

  it('E7-C-02: @ApiPropertyOptional + @IsOptional', () => {
    const r = parse(`
      import { ApiPropertyOptional } from '@nestjs/swagger'
      import { IsOptional } from 'class-validator'
      export class Dto {
        @ApiPropertyOptional()
        @IsOptional()
        age?: number
      }
    `)
    const targets = r.edges
      .filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':Dto.age'))
      .map((e) => e.target_symbol)
      .sort()
    expect(targets).toEqual(['ApiPropertyOptional', 'IsOptional'])
  })

  it('E7-C-03: ApiProperty 객체 인자 — E4 walk 적용', () => {
    const r = parse(`
      import { ApiProperty } from '@nestjs/swagger'
      export class Dto {
        @ApiProperty({ example: 'Tom', description: 'user name', required: true })
        name: string
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'decorates' &&
        edge.target_symbol === 'ApiProperty' &&
        edge.source_id.endsWith(':Dto.name'),
    )
    expect(e).toBeDefined()
    expect(e!.literal_args).toBe(
      JSON.stringify([{ example: 'Tom', description: 'user name', required: true }]),
    )
  })
})

// ────────────────────────────────────────────────
// E7-D. method 위 다중 decorator (Swagger) — 회귀 보호
// ────────────────────────────────────────────────
describe('E7-D: method 위 다중 decorator (Swagger 패턴)', () => {
  it('E7-D-01: @ApiOperation + @ApiResponse(200) + @ApiResponse(401) + @Get → 4 edges, 같은 source', () => {
    const r = parse(`
      import { Get } from '@nestjs/common'
      import { ApiOperation, ApiResponse } from '@nestjs/swagger'
      export class C {
        @ApiOperation({ summary: 'List' })
        @ApiResponse({ status: 200 })
        @ApiResponse({ status: 401 })
        @Get()
        findAll() { return [] }
      }
    `)
    const decoratesOnFindAll = r.edges.filter(
      (e) => e.relation === 'decorates' && e.source_id.endsWith(':C.findAll'),
    )
    const symbols = decoratesOnFindAll.map((e) => e.target_symbol).sort()
    // ApiResponse는 두 번 나옴
    expect(symbols.filter((s) => s === 'ApiResponse')).toHaveLength(2)
    expect(symbols).toContain('ApiOperation')
    expect(symbols).toContain('Get')
  })
})

