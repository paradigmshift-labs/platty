/**
 * F3: mergeRelations 테스트
 * SOT: specs/build_models/specs/f3_merge_relations/spec.md
 */

import { describe, it, expect } from 'vitest'
import type { ModelRaw, ModelField, ModelRelation } from '../../../src/pipeline_modules/build_models/types.js'
import {
  correctTypes,
  generateInverseName,
  getInverseType,
  mergeRelations,
  toCamelCase,
  toPlural,
} from '../../../src/pipeline_modules/build_models/f3_merge_relations.js'

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeField(overrides: Partial<ModelField> & { name: string }): ModelField {
  return { type: 'String', nullable: false, primary: false, unique: false, line: 1, ...overrides }
}

function makeRelation(
  overrides: Partial<ModelRelation> & { name: string; target_model: string; type: ModelRelation['type'] },
): ModelRelation {
  return { line: 1, ...overrides }
}

function makeModel(overrides: Partial<ModelRaw> & { name: string }): ModelRaw {
  const name = overrides.name
  return {
    table_name: name.toLowerCase() + 's',
    comment: '',
    fields: [makeField({ name: 'id', primary: true })],
    relations: [],
    source_file: 'prisma/schema.prisma',
    line_start: 1,
    line_end: 10,
    is_deprecated: false,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('mergeRelations', () => {
  // TC#1: 양방향 명시 — 타입 교정만
  it('TC1: 양방향 명시 (User→orders, Order→user) — 타입 교정, auto_generated 없음', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        relations: [makeRelation({ name: 'orders', target_model: 'Order', type: 'oneToMany' })],
      }),
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId' })],
        relations: [
          makeRelation({ name: 'user', target_model: 'User', type: 'manyToOne', fk_fields: ['userId'] }),
        ],
      }),
    ]

    const result = mergeRelations(models)
    const user = result.find(m => m.name === 'User')!
    const order = result.find(m => m.name === 'Order')!

    expect(user.relations).toHaveLength(1)
    expect(order.relations).toHaveLength(1)
    expect(user.relations[0]!.type).toBe('oneToMany')
    expect(order.relations[0]!.type).toBe('manyToOne')
    expect(user.relations[0]!.auto_generated).toBeUndefined()
    expect(order.relations[0]!.auto_generated).toBeUndefined()
  })

  // TC#2: FK측만 있음 → 역방향(oneToMany) 자동 생성
  it('TC2: Order(user: User @manyToOne) + User 역방향 없음 → User에 orders 자동 생성', () => {
    const models: ModelRaw[] = [
      makeModel({ name: 'User', relations: [] }),
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId' })],
        relations: [
          makeRelation({ name: 'user', target_model: 'User', type: 'manyToOne', fk_fields: ['userId'] }),
        ],
      }),
    ]

    const result = mergeRelations(models)
    const user = result.find(m => m.name === 'User')!
    const order = result.find(m => m.name === 'Order')!

    expect(user.relations).toHaveLength(1)
    const autoRel = user.relations[0]!
    expect(autoRel.name).toBe('orders')
    expect(autoRel.target_model).toBe('Order')
    expect(autoRel.type).toBe('oneToMany')
    expect(autoRel.auto_generated).toBe(true)
    expect(autoRel.fk_fields).toBeUndefined()
    expect(order.relations).toHaveLength(1)
  })

  // TC#3: 1:1 FK측만 있음 → 역방향(oneToOne) 자동 생성
  it('TC3: Profile(user: User @oneToOne @JoinColumn) + User 역방향 없음 → User에 profile 자동 생성', () => {
    const models: ModelRaw[] = [
      makeModel({ name: 'User', relations: [] }),
      makeModel({
        name: 'Profile',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId', unique: true })],
        relations: [
          makeRelation({ name: 'user', target_model: 'User', type: 'oneToOne', fk_fields: ['userId'] }),
        ],
      }),
    ]

    const result = mergeRelations(models)
    const user = result.find(m => m.name === 'User')!
    const autoRel = user.relations[0]!

    expect(autoRel.name).toBe('profile')
    expect(autoRel.target_model).toBe('Profile')
    expect(autoRel.type).toBe('oneToOne')
    expect(autoRel.auto_generated).toBe(true)
  })

  // TC#4: 양방향 명시 FK측 확정 → 타입 교정
  it('TC4: Order(items: OrderItem[]) + OrderItem(order: Order) — FK 기반 타입 교정', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Order',
        relations: [makeRelation({ name: 'items', target_model: 'OrderItem', type: 'oneToMany' })],
      }),
      makeModel({
        name: 'OrderItem',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'orderId' })],
        relations: [
          makeRelation({ name: 'order', target_model: 'Order', type: 'manyToOne', fk_fields: ['orderId'] }),
        ],
      }),
    ]

    const result = mergeRelations(models)
    const order = result.find(m => m.name === 'Order')!
    const item = result.find(m => m.name === 'OrderItem')!

    expect(order.relations[0]!.type).toBe('oneToMany')
    expect(item.relations[0]!.type).toBe('manyToOne')
  })

  // TC#5: M:N 양방향 — manyToMany 교정
  it('TC5: Post(tags: Tag[]) + Tag(posts: Post[]) M:N — manyToMany 교정', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Post',
        relations: [makeRelation({ name: 'tags', target_model: 'Tag', type: 'manyToMany' })],
      }),
      makeModel({
        name: 'Tag',
        relations: [makeRelation({ name: 'posts', target_model: 'Post', type: 'manyToMany' })],
      }),
    ]

    const result = mergeRelations(models)
    const post = result.find(m => m.name === 'Post')!
    const tag = result.find(m => m.name === 'Tag')!

    expect(post.relations[0]!.type).toBe('manyToMany')
    expect(tag.relations[0]!.type).toBe('manyToMany')
    expect(post.relations).toHaveLength(1)
    expect(tag.relations).toHaveLength(1)
  })

  // TC#6: 자기참조 — 역방향 생성 시 자신 sourceRel 제외
  it('TC6: Employee(manager: Employee?) 자기참조 — 역방향 생성, sourceRel 제외', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Employee',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'managerId', nullable: true })],
        relations: [
          makeRelation({ name: 'manager', target_model: 'Employee', type: 'manyToOne', fk_fields: ['managerId'] }),
        ],
      }),
    ]

    const result = mergeRelations(models)
    const emp = result[0]!

    // 역방향 자동 생성
    expect(emp.relations).toHaveLength(2)
    const generated = emp.relations.find(r => r.auto_generated)!
    expect(generated.type).toBe('oneToMany')
    expect(generated.target_model).toBe('Employee')
  })

  // TC#7: @relation("name") 복수 관계 — relation_name 기반 매칭
  it('TC7: 동일 모델 복수 관계 — relation_name 기반 매칭', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        relations: [
          makeRelation({ name: 'authoredPosts', target_model: 'Post', type: 'oneToMany', relation_name: 'PostAuthor' }),
          makeRelation({ name: 'editedPosts', target_model: 'Post', type: 'oneToMany', relation_name: 'PostEditor' }),
        ],
      }),
      makeModel({
        name: 'Post',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'authorId' }), makeField({ name: 'editorId' })],
        relations: [
          makeRelation({ name: 'author', target_model: 'User', type: 'manyToOne', fk_fields: ['authorId'], relation_name: 'PostAuthor' }),
          makeRelation({ name: 'editor', target_model: 'User', type: 'manyToOne', fk_fields: ['editorId'], relation_name: 'PostEditor' }),
        ],
      }),
    ]

    const result = mergeRelations(models)
    const user = result.find(m => m.name === 'User')!
    const post = result.find(m => m.name === 'Post')!

    // 양방향이 모두 이미 있으므로 새 auto_generated 없음
    expect(user.relations).toHaveLength(2)
    expect(post.relations).toHaveLength(2)
    expect(user.relations.every(r => !r.auto_generated)).toBe(true)
  })

  // TC#8: orphan relation — skip
  it('TC8: orphan relation (target_model="Ghost" 없음) — skip, 자동 생성 없음', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        relations: [makeRelation({ name: 'ghost', target_model: 'Ghost', type: 'manyToOne' })],
      }),
    ]

    const result = mergeRelations(models)
    expect(result[0]!.relations).toHaveLength(1)
    expect(result.find(m => m.name === 'Ghost')).toBeUndefined()
  })

  // TC#9: 역방향 이름 충돌 → suffix
  it('TC9: 역방향 이름 충돌 시 suffix 추가', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'orders' })], // 충돌!
        relations: [],
      }),
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId' })],
        relations: [makeRelation({ name: 'user', target_model: 'User', type: 'manyToOne', fk_fields: ['userId'] })],
      }),
    ]

    const result = mergeRelations(models)
    const user = result.find(m => m.name === 'User')!
    const generated = user.relations[0]!

    // 'orders'는 이미 field에 있으므로 suffix 추가
    expect(generated.name).not.toBe('orders')
    expect(generated.auto_generated).toBe(true)
    expect(generated.type).toBe('oneToMany')
  })

  // TC#10: 빈 입력
  it('TC10: models=[] → []', () => {
    expect(mergeRelations([])).toEqual([])
  })

  // TC#11: 멱등성 — 2번 호출 시 deep equal
  it('TC11: 멱등성 — 동일 입력 2회 호출 결과 deep equal', () => {
    const models: ModelRaw[] = [
      makeModel({ name: 'User', relations: [] }),
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId' })],
        relations: [makeRelation({ name: 'user', target_model: 'User', type: 'manyToOne', fk_fields: ['userId'] })],
      }),
    ]

    const r1 = mergeRelations(models)
    const r2 = mergeRelations(models)
    expect(r1).toEqual(r2)
  })

  // TC#12: auto_generated 재처리 skip
  it('TC12: 이미 auto_generated 관계는 재처리 skip', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        relations: [
          makeRelation({ name: 'orders', target_model: 'Order', type: 'oneToMany', auto_generated: true }),
        ],
      }),
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId' })],
        relations: [makeRelation({ name: 'user', target_model: 'User', type: 'manyToOne', fk_fields: ['userId'] })],
      }),
    ]

    const result = mergeRelations(models)
    const user = result.find(m => m.name === 'User')!
    // auto_generated는 재처리되지 않아야 함 — 역방향(User→Order)이 이미 있으므로 새 생성 없음
    expect(user.relations).toHaveLength(1)
  })

  // TC#13: 양쪽 fk_fields — correctTypes no-op
  it('TC13: 양쪽 모두 fk_fields (Prisma 불가 케이스) — correctTypes no-op', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'A',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'bId' })],
        relations: [makeRelation({ name: 'b', target_model: 'B', type: 'oneToOne', fk_fields: ['bId'] })],
      }),
      makeModel({
        name: 'B',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'aId' })],
        relations: [makeRelation({ name: 'a', target_model: 'A', type: 'oneToOne', fk_fields: ['aId'] })],
      }),
    ]

    const result = mergeRelations(models)
    const a = result.find(m => m.name === 'A')!
    const b = result.find(m => m.name === 'B')!

    // no-op — 타입 변경 없음
    expect(a.relations[0]!.type).toBe('oneToOne')
    expect(b.relations[0]!.type).toBe('oneToOne')
  })

  // TC#14: implicit M:N (fk 없음, 양쪽 oneToMany) → manyToMany 교정
  it('TC14: implicit M:N (@relation 없음, F2에서 둘 다 oneToMany) → manyToMany 교정', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Post',
        relations: [makeRelation({ name: 'tags', target_model: 'Tag', type: 'oneToMany' })],
      }),
      makeModel({
        name: 'Tag',
        relations: [makeRelation({ name: 'posts', target_model: 'Post', type: 'oneToMany' })],
      }),
    ]

    const result = mergeRelations(models)
    const post = result.find(m => m.name === 'Post')!
    const tag = result.find(m => m.name === 'Tag')!

    expect(post.relations[0]!.type).toBe('manyToMany')
    expect(tag.relations[0]!.type).toBe('manyToMany')
  })

  // TC#15: duplicate relation_name 후보 → null → auto_generated
  it('TC15: duplicate relation_name 후보 2개 → findInverse null → auto_generated 생성', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId' })],
        relations: [
          makeRelation({ name: 'user', target_model: 'User', type: 'manyToOne', fk_fields: ['userId'], relation_name: 'UserOrder' }),
        ],
      }),
      makeModel({
        name: 'User',
        relations: [
          // 두 관계 모두 relation_name='UserOrder' — 후보 2개
          makeRelation({ name: 'primaryOrders', target_model: 'Order', type: 'oneToMany', relation_name: 'UserOrder' }),
          makeRelation({ name: 'secondaryOrders', target_model: 'Order', type: 'oneToMany', relation_name: 'UserOrder' }),
        ],
      }),
    ]

    // relation_name 'UserOrder' 후보가 2개이므로 매칭 실패 → auto_generated 생성
    // (findInverse: matched.length !== 1 → null)
    const result = mergeRelations(models)
    const user = result.find(m => m.name === 'User')!

    // 기존 2개 + auto_generated 1개
    expect(user.relations).toHaveLength(3)
    const generated = user.relations.find(r => r.auto_generated === true)!
    expect(generated).toBeDefined()
    expect(generated.target_model).toBe('Order')
  })

  // 원본 불변 검증
  it('원본 ModelRaw[] 불변 — mergeRelations 호출 후 원본 변경 없음', () => {
    const models: ModelRaw[] = [
      makeModel({ name: 'User', relations: [] }),
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true }), makeField({ name: 'userId' })],
        relations: [makeRelation({ name: 'user', target_model: 'User', type: 'manyToOne', fk_fields: ['userId'] })],
      }),
    ]

    const originalUserRelationsLength = models[0]!.relations.length
    mergeRelations(models)
    expect(models[0]!.relations.length).toBe(originalUserRelationsLength)
  })
})

describe('relation helper branches', () => {
  it('toCamelCase: empty name stays empty', () => {
    expect(toCamelCase('')).toBe('')
  })

  it('toPlural: y, es, s suffix branches', () => {
    expect(toPlural('')).toBe('')
    expect(toPlural('Category')).toBe('Categories')
    expect(toPlural('Box')).toBe('Boxes')
    expect(toPlural('Order')).toBe('Orders')
  })

  it('getInverseType: manyToMany keeps manyToMany', () => {
    expect(getInverseType('oneToMany')).toBe('manyToOne')
    expect(getInverseType('manyToMany')).toBe('manyToMany')
  })

  it('generateInverseName: existing base name collision uses relation_name suffix', () => {
    const target = makeModel({
      name: 'User',
      relations: [makeRelation({ name: 'orders', target_model: 'Order', type: 'oneToMany' })],
    })
    const sourceRel = makeRelation({
      name: 'user',
      target_model: 'User',
      type: 'manyToOne',
      relation_name: 'UserOrders',
    })

    expect(generateInverseName('Order', sourceRel, target)).toBe('orders_UserOrders')
  })

  it('correctTypes: oneToOne FK side keeps inverse oneToOne', () => {
    const source = makeRelation({
      name: 'profile',
      target_model: 'Profile',
      type: 'oneToOne',
      fk_fields: ['profileId'],
    })
    const inverse = makeRelation({ name: 'user', target_model: 'User', type: 'oneToMany' })

    correctTypes(source, inverse)

    expect(source.type).toBe('oneToOne')
    expect(inverse.type).toBe('oneToOne')
  })
})
