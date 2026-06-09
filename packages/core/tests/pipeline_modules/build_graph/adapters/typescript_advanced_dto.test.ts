/**
 * 카테고리 C — DTO nested validation + Transform
 *
 * 시나리오:
 *   - @Type(() => SubDto) — class-transformer
 *   - @ValidateNested() / @ValidateNested({ each: true })
 *   - @Transform(({ value }) => ...)
 *   - @Expose() / @Exclude()
 *   - enum DTO field — @ApiProperty({ enum: Status })
 *   - @IsArray + @ArrayMinSize, @IsEnum(Status), @IsObject
 *   - @ApiHideProperty
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/d.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('C. DTO nested validation + Transform', () => {
  it('C-01: @Type(() => SubDto) + @ValidateNested() — nested DTO', () => {
    const r = parse(`
      import { Type } from 'class-transformer'
      import { ValidateNested } from 'class-validator'
      import { AddressDto } from './address.dto'
      export class CreateUserDto {
        @ValidateNested()
        @Type(() => AddressDto)
        address: AddressDto
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':CreateUserDto.address'))
      .map((e) => e.target_symbol)
      .sort()
    expect(symbols).toEqual(['Type', 'ValidateNested'])
  })

  it('C-02: @ValidateNested({ each: true }) — array of nested', () => {
    const r = parse(`
      import { Type } from 'class-transformer'
      import { ValidateNested, IsArray } from 'class-validator'
      import { ItemDto } from './item.dto'
      export class CartDto {
        @IsArray()
        @ValidateNested({ each: true })
        @Type(() => ItemDto)
        items: ItemDto[]
      }
    `)
    const vn = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'ValidateNested',
    )
    expect(vn).toBeDefined()
    expect(vn!.literal_args).toBe(JSON.stringify([{ each: true }]))
  })

  it('C-03: @Transform(({ value }) => value.toLowerCase()) — value 변환', () => {
    const r = parse(`
      import { Transform } from 'class-transformer'
      export class Dto {
        @Transform(({ value }) => value.toLowerCase())
        email: string
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'Transform')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('class-transformer')
    expect(e!.source_id.endsWith(':Dto.email')).toBe(true)
  })

  it('C-04: @Expose() / @Exclude() — serialization 제어', () => {
    const r = parse(`
      import { Expose, Exclude } from 'class-transformer'
      export class UserDto {
        @Expose()
        id: string

        @Exclude()
        password: string
      }
    `)
    const expose = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'Expose')
    const exclude = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'Exclude')
    expect(expose?.source_id.endsWith(':UserDto.id')).toBe(true)
    expect(exclude?.source_id.endsWith(':UserDto.password')).toBe(true)
  })

  it('C-05: enum DTO field — @ApiProperty({ enum: Status, enumName: "Status" })', () => {
    const r = parse(`
      import { ApiProperty } from '@nestjs/swagger'
      import { Status } from './status.enum'
      export class Dto {
        @ApiProperty({ enum: Status, enumName: 'Status' })
        status: Status
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'ApiProperty',
    )
    expect(e).toBeDefined()
    // Status 식별자는 객체 walk에서 null로 (E4 spec)
    expect(e!.literal_args).toBe(JSON.stringify([{ enum: null, enumName: 'Status' }]))
  })

  it('C-06: @IsEnum(Status) + @IsArray + @ArrayMinSize(1)', () => {
    const r = parse(`
      import { IsEnum, IsArray, ArrayMinSize } from 'class-validator'
      import { Status } from './status.enum'
      export class Dto {
        @IsArray()
        @ArrayMinSize(1)
        @IsEnum(Status, { each: true })
        statuses: Status[]
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':Dto.statuses'))
      .map((e) => e.target_symbol)
      .sort()
    expect(symbols).toEqual(['ArrayMinSize', 'IsArray', 'IsEnum'])
    const arrayMin = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'ArrayMinSize',
    )
    expect(arrayMin!.literal_args).toBe(JSON.stringify([1]))
  })

  it('C-07: @IsObject + @ValidateIf(o => o.type === "X")', () => {
    const r = parse(`
      import { IsObject, ValidateIf } from 'class-validator'
      export class Dto {
        type: string
        @ValidateIf((o) => o.type === 'X')
        @IsObject()
        config?: any
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':Dto.config'))
      .map((e) => e.target_symbol)
      .sort()
    expect(symbols).toEqual(['IsObject', 'ValidateIf'])
  })

  it('C-08: @ApiHideProperty + @Exclude() — 응답에서 숨김', () => {
    const r = parse(`
      import { ApiHideProperty } from '@nestjs/swagger'
      import { Exclude } from 'class-transformer'
      export class Dto {
        @ApiHideProperty()
        @Exclude()
        internalKey: string
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':Dto.internalKey'))
      .map((e) => e.target_symbol)
      .sort()
    expect(symbols).toEqual(['ApiHideProperty', 'Exclude'])
  })
})
