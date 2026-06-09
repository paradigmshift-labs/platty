/**
 * 카테고리 B — TypeORM 고급 관계 + 시간 컬럼
 *
 * 시나리오:
 *   - @ManyToOne / @OneToOne / @ManyToMany / @JoinColumn / @JoinTable
 *   - @CreateDateColumn / @UpdateDateColumn / @DeleteDateColumn
 *   - @VersionColumn / @RelationId
 *   - @Tree / @PrimaryColumn / @Generated
 *   - @AfterLoad / @BeforeInsert (lifecycle hook decorator)
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/e.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('B. TypeORM 고급 관계', () => {
  it('B-01: @ManyToOne(() => User, user => user.orders) — relation', () => {
    const r = parse(`
      import { ManyToOne } from 'typeorm'
      import { User } from './user'
      export class Order {
        @ManyToOne(() => User, (user) => user.orders)
        user: User
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'ManyToOne',
    )
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('typeorm')
    expect(e!.source_id.endsWith(':Order.user')).toBe(true)
  })

  it('B-02: @ManyToOne + @JoinColumn 복합 — 한 field에 두 decorator', () => {
    const r = parse(`
      import { ManyToOne, JoinColumn } from 'typeorm'
      import { User } from './user'
      export class Order {
        @ManyToOne(() => User)
        @JoinColumn({ name: 'user_id' })
        user: User
      }
    `)
    const decorates = r.edges.filter(
      (e) => e.relation === 'decorates' && e.source_id.endsWith(':Order.user'),
    )
    const symbols = decorates.map((e) => e.target_symbol).sort()
    expect(symbols).toEqual(['JoinColumn', 'ManyToOne'])
    const join = decorates.find((e) => e.target_symbol === 'JoinColumn')
    expect(join!.literal_args).toBe(JSON.stringify([{ name: 'user_id' }]))
  })

  it('B-03: @OneToOne + @JoinColumn', () => {
    const r = parse(`
      import { OneToOne, JoinColumn } from 'typeorm'
      import { Profile } from './profile'
      export class User {
        @OneToOne(() => Profile)
        @JoinColumn()
        profile: Profile
      }
    `)
    const symbols = r.edges
      .filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':User.profile'))
      .map((e) => e.target_symbol)
      .sort()
    expect(symbols).toEqual(['JoinColumn', 'OneToOne'])
  })

  it('B-04: @ManyToMany + @JoinTable({ name, joinColumn, inverseJoinColumn })', () => {
    const r = parse(`
      import { ManyToMany, JoinTable } from 'typeorm'
      import { Tag } from './tag'
      export class Post {
        @ManyToMany(() => Tag)
        @JoinTable({ name: 'post_tags', joinColumn: { name: 'post_id' } })
        tags: Tag[]
      }
    `)
    const join = r.edges.find(
      (e) => e.relation === 'decorates' && e.target_symbol === 'JoinTable',
    )
    expect(join).toBeDefined()
    expect(join!.literal_args).toBe(
      JSON.stringify([{ name: 'post_tags', joinColumn: { name: 'post_id' } }]),
    )
  })

  it('B-05: @CreateDateColumn() / @UpdateDateColumn() / @DeleteDateColumn() — lifecycle 시간', () => {
    const r = parse(`
      import { CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm'
      export class Audit {
        @CreateDateColumn()
        createdAt: Date

        @UpdateDateColumn()
        updatedAt: Date

        @DeleteDateColumn()
        deletedAt?: Date
      }
    `)
    const cd = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'CreateDateColumn')
    const ud = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'UpdateDateColumn')
    const dd = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'DeleteDateColumn')
    expect(cd?.source_id.endsWith(':Audit.createdAt')).toBe(true)
    expect(ud?.source_id.endsWith(':Audit.updatedAt')).toBe(true)
    expect(dd?.source_id.endsWith(':Audit.deletedAt')).toBe(true)
  })

  it('B-06: @VersionColumn — 낙관적 잠금 컬럼', () => {
    const r = parse(`
      import { VersionColumn } from 'typeorm'
      export class E { @VersionColumn() version: number }
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'VersionColumn')
    expect(e).toBeDefined()
  })

  it('B-07: @RelationId(o => o.user) — 관계 id 추출', () => {
    const r = parse(`
      import { RelationId, ManyToOne } from 'typeorm'
      import { User } from './user'
      export class Order {
        @ManyToOne(() => User)
        user: User

        @RelationId((order: Order) => order.user)
        userId: string
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'RelationId')
    expect(e).toBeDefined()
    expect(e!.source_id.endsWith(':Order.userId')).toBe(true)
  })

  it('B-08: @PrimaryColumn() vs @PrimaryGeneratedColumn() — 둘 다 잡힘', () => {
    const r = parse(`
      import { PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm'
      export class A { @PrimaryColumn() id: string }
      export class B { @PrimaryGeneratedColumn('uuid') id: string }
    `)
    const a = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'PrimaryColumn')
    const b = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'PrimaryGeneratedColumn')
    expect(a?.source_id.endsWith(':A.id')).toBe(true)
    expect(b?.source_id.endsWith(':B.id')).toBe(true)
    expect(b!.first_arg).toBe('uuid')
  })

  it('B-09: @AfterLoad / @BeforeInsert — entity lifecycle hook (method-level)', () => {
    const r = parse(`
      import { AfterLoad, BeforeInsert } from 'typeorm'
      export class User {
        @AfterLoad()
        afterLoad() {}

        @BeforeInsert()
        beforeInsert() {}
      }
    `)
    const al = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'AfterLoad')
    const bi = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'BeforeInsert')
    expect(al?.source_id.endsWith(':User.afterLoad')).toBe(true)
    expect(bi?.source_id.endsWith(':User.beforeInsert')).toBe(true)
  })

  it('B-10: @Entity({ name, schema, synchronize: false }) — class-level 객체 인자', () => {
    const r = parse(`
      import { Entity } from 'typeorm'
      @Entity({ name: 'users', schema: 'public', synchronize: false })
      export class User {}
    `)
    const e = r.edges.find((edge) => edge.relation === 'decorates' && edge.target_symbol === 'Entity')
    expect(e).toBeDefined()
    expect(e!.literal_args).toBe(
      JSON.stringify([{ name: 'users', schema: 'public', synchronize: false }]),
    )
  })
})
