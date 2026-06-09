/**
 * 카테고리 L — GraphQL (디스커버리 모드)
 *
 * 목적: api_spec(GraphQL schema/resolver/subscription) 추출이 누락 없이 되도록.
 *
 * 시나리오 — 12종
 *   NestJS GraphQL (1~7):
 *     - @Resolver(() => User) — class-level
 *     - @Query/@Mutation/@Subscription/@ResolveField — return type 함수 인자
 *     - @Args('id') / @Args() input: CreateUserInput — method param decorator
 *   type-graphql (8~10):
 *     - @ObjectType / @Field(() => [String])
 *     - @InputType
 *     - @Authorized([Role.ADMIN])
 *   Pothos (11):
 *     - builder.queryType().field(...) — schema builder chain
 *   Apollo (12):
 *     - resolvers 객체 — { Query: { users: () => ... } } (객체 안 함수)
 *
 * 디스커버리 모드: 일부 expected는 ambitious — 실패 시 §2 BS 목록으로 환류.
 *   - decorator name + specifier 캡처 = 명확히 통과 예상
 *   - type fn 인자 (`() => User`) 안 식별자 추적 = BS-2와 동일 영역, 실패 가능성 높음
 *   - Apollo resolvers 객체 안 함수 = 객체 리터럴 안 식별자 (BS-2)
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/resolver.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('L. GraphQL (디스커버리)', () => {
  // ==================== NestJS GraphQL ====================

  it('GR-01: @Resolver(() => User) — class-level resolver', () => {
    const r = parse(`
      import { Resolver } from '@nestjs/graphql'
      import { User } from './user.entity'
      @Resolver(() => User)
      export class UserResolver {}
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Resolver',
    )
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('@nestjs/graphql')
    // 디스커버리: type fn arg 안 식별자 추적 — User가 어떤 edge로든 연결되어야 이상적
    // 현재는 화살표 함수 인자라 literal_args=[null] 일 것 (BS-2 영역)
    // 이 expect는 ambitious — 실패 = User 식별자 그래프 누락 확인
    const userRef = r.edges.find(
      (edge) => edge.target_symbol === 'User' && edge.source_id.endsWith(':UserResolver'),
    )
    expect(userRef, 'BS-2: type fn 인자 안 식별자(User) 추적 안 됨').toBeDefined()
  })

  it('GR-02: @Query(() => [User]) — return type as fn arg', () => {
    const r = parse(`
      import { Query, Resolver } from '@nestjs/graphql'
      import { User } from './user.entity'
      @Resolver()
      export class UserResolver {
        @Query(() => [User])
        users(): User[] { return [] }
      }
    `)
    const e = r.edges.find(
      (edge) =>
        edge.relation === 'decorates' &&
        edge.target_symbol === 'Query' &&
        edge.source_id.endsWith(':UserResolver.users'),
    )
    expect(e).toBeDefined()
    // return type: User[] → type_ref edge 잡혀야 함 (시그니처 타입)
    const typeRef = r.edges.find(
      (edge) =>
        edge.relation === 'type_ref' &&
        edge.target_symbol === 'User' &&
        edge.source_id.endsWith(':UserResolver.users'),
    )
    expect(typeRef, 'return type User → type_ref').toBeDefined()
  })

  it('GR-03: @Mutation(() => User) — mutation handler', () => {
    const r = parse(`
      import { Mutation, Resolver } from '@nestjs/graphql'
      import { User } from './user.entity'
      @Resolver()
      export class UserResolver {
        @Mutation(() => User)
        createUser(): User { return {} as User }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Mutation',
    )
    expect(e).toBeDefined()
    expect(e!.source_id.endsWith(':UserResolver.createUser')).toBe(true)
  })

  it("GR-04: @Args('id') — string literal arg (method param decorator)", () => {
    const r = parse(`
      import { Args, Query, Resolver } from '@nestjs/graphql'
      import { User } from './user.entity'
      @Resolver()
      export class UserResolver {
        @Query(() => User)
        user(@Args('id') id: string): User { return {} as User }
      }
    `)
    // E3 — method param decorator
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Args',
    )
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('id')
  })

  it('GR-05: @Args() input: CreateUserInput — type 참조', () => {
    const r = parse(`
      import { Args, Mutation, Resolver } from '@nestjs/graphql'
      import { User } from './user.entity'
      import { CreateUserInput } from './dto'
      @Resolver()
      export class UserResolver {
        @Mutation(() => User)
        createUser(@Args() input: CreateUserInput): User { return {} as User }
      }
    `)
    const decoratesArgs = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Args',
    )
    expect(decoratesArgs).toBeDefined()
    // CreateUserInput → type_ref edge (param type)
    const typeRef = r.edges.find(
      (edge) => edge.relation === 'type_ref' && edge.target_symbol === 'CreateUserInput',
    )
    expect(typeRef, 'CreateUserInput → type_ref (param)').toBeDefined()
  })

  it('GR-06: @ResolveField(() => Address) — field resolver', () => {
    const r = parse(`
      import { Parent, ResolveField, Resolver } from '@nestjs/graphql'
      import { User } from './user.entity'
      import { Address } from './address.entity'
      @Resolver(() => User)
      export class UserResolver {
        @ResolveField(() => Address)
        address(@Parent() user: User): Address { return {} as Address }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'ResolveField',
    )
    expect(e).toBeDefined()
    // @Parent() decorator — method param
    const parentDec = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Parent',
    )
    expect(parentDec, '@Parent() method param decorator').toBeDefined()
  })

  it('GR-07: @Subscription(() => Notification) — subscription handler', () => {
    const r = parse(`
      import { Subscription, Resolver } from '@nestjs/graphql'
      import { Notification } from './notification.entity'
      import { PubSub } from 'graphql-subscriptions'
      const pubSub = new PubSub()
      @Resolver()
      export class NotificationResolver {
        @Subscription(() => Notification)
        notificationAdded() { return pubSub.asyncIterator('notificationAdded') }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Subscription',
    )
    expect(e).toBeDefined()
    // pubSub.asyncIterator('notificationAdded') — string literal first_arg
    const callEdge = r.edges.find(
      (edge) =>
        edge.relation === 'calls' && edge.target_symbol === 'asyncIterator',
    )
    expect(callEdge).toBeDefined()
    expect(callEdge!.first_arg).toBe('notificationAdded')
  })

  // ==================== type-graphql ====================

  it('GR-08: @ObjectType + @Field(() => [String]) — schema entity', () => {
    const r = parse(`
      import { ObjectType, Field, ID } from 'type-graphql'
      @ObjectType()
      export class User {
        @Field(() => ID)
        id!: string
        @Field(() => [String])
        roles!: string[]
      }
    `)
    const objType = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'ObjectType',
    )
    expect(objType).toBeDefined()
    // @Field — class field decorator (E7)
    const fieldDec = r.edges.filter(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Field',
    )
    expect(fieldDec.length).toBeGreaterThanOrEqual(2)
    // 디스커버리: () => [String] / () => ID 안 식별자 추적
    const idRef = r.edges.find((e) => e.target_symbol === 'ID')
    expect(idRef, 'BS-2: @Field(() => ID) 안 ID 식별자 추적').toBeDefined()
  })

  it('GR-09: @InputType + @Field({ nullable: true }) — input type', () => {
    const r = parse(`
      import { InputType, Field } from 'type-graphql'
      @InputType()
      export class CreateUserInput {
        @Field()
        name!: string
        @Field({ nullable: true })
        email?: string
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'InputType',
    )
    expect(e).toBeDefined()
    // @Field({ nullable: true }) — 객체 인자 walk (E4) → literal_args에 nullable: true 보존
    const nullableField = r.edges.find(
      (edge) =>
        edge.relation === 'decorates' &&
        edge.target_symbol === 'Field' &&
        edge.literal_args?.includes('nullable'),
    )
    expect(nullableField, 'E4 객체 인자 nullable:true 보존').toBeDefined()
  })

  it('GR-10: @Authorized([Role.ADMIN]) — authorization decorator', () => {
    const r = parse(`
      import { Authorized, Query, Resolver } from 'type-graphql'
      enum Role { ADMIN = 'admin', USER = 'user' }
      @Resolver()
      export class AdminResolver {
        @Authorized([Role.ADMIN])
        @Query(() => String)
        secret(): string { return 'x' }
      }
    `)
    const e = r.edges.find(
      (edge) => edge.relation === 'decorates' && edge.target_symbol === 'Authorized',
    )
    expect(e).toBeDefined()
    // 디스커버리: [Role.ADMIN] — member expression 안 enum 추적
    // 현재 enum value extraction은 E1+enumValueMap에서 처리 — Role.ADMIN이 'admin'으로 풀릴까?
    const literalArgs = e!.literal_args
    expect(
      literalArgs,
      'BS-2: enum member expression Role.ADMIN → 값 또는 식별자 추적',
    ).toBeTruthy()
  })

  // ==================== Pothos (schema builder) ====================

  it('GR-11: builder.queryType().field(...) chain — Pothos schema builder', () => {
    const r = parse(`
      import SchemaBuilder from '@pothos/core'
      const builder = new SchemaBuilder({})
      builder.queryType({
        fields: (t) => ({
          users: t.field({
            type: ['User'],
            resolve: () => [],
          }),
        }),
      })
    `)
    // E8 chain method calls — queryType / field / SchemaBuilder
    const queryType = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'queryType',
    )
    expect(queryType).toBeDefined()
    // chain_path 컬럼에 'builder' prefix 있어야 (E6)
    expect(queryType!.chain_path).toBeTruthy()
    // 디스커버리: t.field 안 resolve fn → 식별자 추적 (BS-2 영역)
    const fieldCall = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'field',
    )
    expect(fieldCall, 'Pothos t.field() chain — 객체 인자 안 함수').toBeDefined()
  })

  // ==================== Apollo Server (resolvers 객체) ====================

  it('GR-12: Apollo resolvers 객체 — { Query: { users: () => ... } }', () => {
    const r = parse(`
      import { ApolloServer } from '@apollo/server'
      import { typeDefs } from './schema'
      import { findAllUsers, findUserById } from './services'
      const resolvers = {
        Query: {
          users: () => findAllUsers(),
          user: (_: unknown, { id }: { id: string }) => findUserById(id),
        },
        Mutation: {
          createUser: () => ({ id: '1', name: 'a' }),
        },
      }
      const server = new ApolloServer({ typeDefs, resolvers })
    `)
    // ApolloServer constructor — calls or instantiates
    const apollo = r.edges.find(
      (edge) => edge.target_symbol === 'ApolloServer' && edge.relation === 'calls',
    )
    expect(apollo).toBeDefined()
    // 디스커버리 핵심: 객체 안 화살표 함수가 findAllUsers/findUserById를 호출 — 추적될까?
    // 현재 어댑터는 module-level resolvers 객체 안의 화살표 함수 호출을 잡지 못할 가능성 (BS-2 / function-scope 한계)
    const findAll = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'findAllUsers',
    )
    expect(findAll, 'BS-2/scope: resolvers 객체 안 화살표 함수 → findAllUsers 호출 추적').toBeDefined()
    const findById = r.edges.find(
      (edge) => edge.relation === 'calls' && edge.target_symbol === 'findUserById',
    )
    expect(findById, 'BS-2/scope: resolvers 객체 안 화살표 함수 → findUserById 호출 추적').toBeDefined()
  })
})
