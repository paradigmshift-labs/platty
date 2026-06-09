import { describe, it, expect } from 'vitest'
import { validateModels } from '../../../src/pipeline_modules/build_models/f4_validate_models.js'
import type { ModelRaw, ModelField, ModelRelation } from '../../../src/pipeline_modules/build_models/types.js'

function makeField(overrides: Partial<ModelField> & { name: string }): ModelField {
  return {
    type: 'String',
    nullable: false,
    primary: false,
    unique: false,
    line: 1,
    ...overrides,
  }
}

function makeRelation(
  overrides: Partial<ModelRelation> & { name: string; target_model: string },
): ModelRelation {
  return {
    type: 'manyToOne',
    line: 1,
    ...overrides,
  }
}

function makeModel(overrides: Partial<ModelRaw> & { name: string }): ModelRaw {
  return {
    table_name: overrides.name.toLowerCase(),
    comment: '',
    fields: [],
    relations: [],
    source_file: 'schema.prisma',
    line_start: 1,
    line_end: 10,
    is_deprecated: false,
    ...overrides,
  }
}

describe('validateModels', () => {
  // T-F4-01
  it('빈 배열 입력 → { models: [], verdicts: [] }', () => {
    const input: ModelRaw[] = []

    const result = validateModels(input)

    expect(result.models).toEqual([])
    expect(result.verdicts).toEqual([])
  })

  // T-F4-02
  it('User+Order+OrderItem+Product+Category 정상 → verdicts 빈 배열', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [
          makeField({ name: 'id', type: 'String', primary: true }),
          makeField({ name: 'email', type: 'String', unique: true }),
          makeField({ name: 'name', type: 'String', nullable: true }),
        ],
        relations: [
          makeRelation({ name: 'orders', target_model: 'Order', type: 'oneToMany' }),
        ],
      }),
      makeModel({
        name: 'Order',
        fields: [
          makeField({ name: 'id', type: 'String', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
          makeField({ name: 'total', type: 'Int' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'manyToOne',
            fk_fields: ['userId'], references: ['id'],
          }),
          makeRelation({ name: 'items', target_model: 'OrderItem', type: 'oneToMany', auto_generated: true }),
        ],
      }),
      makeModel({
        name: 'OrderItem',
        fields: [
          makeField({ name: 'id', type: 'String', primary: true }),
          makeField({ name: 'orderId', type: 'String' }),
          makeField({ name: 'productId', type: 'String' }),
          makeField({ name: 'quantity', type: 'Int' }),
        ],
        relations: [
          makeRelation({
            name: 'order', target_model: 'Order', type: 'manyToOne',
            fk_fields: ['orderId'], references: ['id'],
          }),
          makeRelation({
            name: 'product', target_model: 'Product', type: 'manyToOne',
            fk_fields: ['productId'], references: ['id'],
          }),
        ],
      }),
      makeModel({
        name: 'Product',
        fields: [
          makeField({ name: 'id', type: 'String', primary: true }),
          makeField({ name: 'name', type: 'String' }),
          makeField({ name: 'price', type: 'Float' }),
          makeField({ name: 'categoryId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'category', target_model: 'Category', type: 'manyToOne',
            fk_fields: ['categoryId'], references: ['id'],
          }),
          makeRelation({ name: 'orderItems', target_model: 'OrderItem', type: 'oneToMany' }),
        ],
      }),
      makeModel({
        name: 'Category',
        fields: [
          makeField({ name: 'id', type: 'String', primary: true }),
          makeField({ name: 'name', type: 'String' }),
          makeField({ name: 'parentId', type: 'String', nullable: true }),
        ],
        relations: [
          makeRelation({
            name: 'parent', target_model: 'Category', type: 'manyToOne',
            fk_fields: ['parentId'], references: ['id'],
          }),
          makeRelation({ name: 'products', target_model: 'Product', type: 'oneToMany' }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
    expect(result.models).toHaveLength(5)
  })

  // T-F4-03
  it('result.models === input (참조 동일성)', () => {
    const input: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
      }),
    ]

    const result = validateModels(input)

    expect(result.models).toBe(input)
  })

  // T-F4-04
  it('primary=true 필드 없음 → warning NO_PK', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'AnalyticsView',
        fields: [
          makeField({ name: 'label', type: 'String', primary: false }),
          makeField({ name: 'value', type: 'Int', primary: false }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'AnalyticsView',
      level: 'warning',
      code: 'NO_PK',
      detail: 'No primary key found',
    })
  })

  // T-F4-05
  it('fields 빈 배열 → warning NO_PK', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'EmptyModel',
        fields: [],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'EmptyModel',
      level: 'warning',
      code: 'NO_PK',
      detail: 'No primary key found',
    })
  })

  // T-F4-06
  it('복합키 (primary=true 2개) → NO_PK 없음', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'OrderItem',
        fields: [
          makeField({ name: 'orderId', type: 'String', primary: true }),
          makeField({ name: 'productId', type: 'String', primary: true }),
          makeField({ name: 'quantity', type: 'Int' }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
  })

  // T-F4-07
  it('target_model이 modelNameSet에 없음 → warning ORPHAN_RELATION', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Order',
        fields: [makeField({ name: 'id', primary: true })],
        relations: [
          makeRelation({ name: 'customer', target_model: 'Customer' }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Order',
      level: 'warning',
      code: 'ORPHAN_RELATION',
      detail: "Relation target 'Customer' not found for 'customer'",
    })
  })

  // T-F4-08
  it('target_model=자기자신 → ORPHAN 없음', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Category',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'parentId', type: 'String', nullable: true }),
        ],
        relations: [
          makeRelation({
            name: 'parent', target_model: 'Category', type: 'manyToOne',
            fk_fields: ['parentId'], references: ['id'],
          }),
          makeRelation({ name: 'children', target_model: 'Category', type: 'oneToMany' }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
  })

  // T-F4-09
  it('fk_fields의 필드가 모델 fields에 없음 → error FK_MISMATCH', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
      }),
      makeModel({
        name: 'Order',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'total', type: 'Int' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'manyToOne',
            fk_fields: ['userId'], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Order',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "FK field 'userId' not found in 'Order'",
    })
  })

  // T-F4-10
  it('references의 필드가 target_model fields에 없음 → error FK_MISMATCH', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'email', type: 'String' }),
        ],
      }),
      makeModel({
        name: 'Profile',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'oneToOne',
            fk_fields: ['userId'], references: ['uuid'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Profile',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "Reference field 'uuid' not found in 'User'",
    })
  })

  // T-F4-11
  it('target 미존재 + references 있음 → ORPHAN만, FK_MISMATCH(references) 없음', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Order',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'manyToOne',
            fk_fields: ['userId'], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    const orphans = result.verdicts.filter(v => v.code === 'ORPHAN_RELATION')
    const fkMismatches = result.verdicts.filter(v => v.code === 'FK_MISMATCH')

    expect(orphans).toHaveLength(1)
    expect(orphans[0]!.detail).toBe("Relation target 'User' not found for 'user'")
    expect(fkMismatches).toHaveLength(0)
  })

  // T-F4-12
  it('fk_fields ["a","b"] 중 "b"만 없음 → FK_MISMATCH 1건', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Target',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'code', type: 'String' }),
        ],
      }),
      makeModel({
        name: 'Source',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'targetId', type: 'String' }),
          // 'targetCode' 필드 없음
        ],
        relations: [
          makeRelation({
            name: 'target', target_model: 'Target', type: 'manyToOne',
            fk_fields: ['targetId', 'targetCode'], references: ['id', 'code'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Source',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "FK field 'targetCode' not found in 'Source'",
    })
  })

  // T-F4-13
  it('references ["x","y"] 둘 다 없음 → FK_MISMATCH 2건', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Target',
        fields: [
          makeField({ name: 'id', primary: true }),
        ],
      }),
      makeModel({
        name: 'Source',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'fkA', type: 'String' }),
          makeField({ name: 'fkB', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'target', target_model: 'Target', type: 'manyToOne',
            fk_fields: ['fkA', 'fkB'], references: ['nonExistX', 'nonExistY'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(2)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Source',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "Reference field 'nonExistX' not found in 'Target'",
    })
    expect(result.verdicts[1]).toEqual({
      model_name: 'Source',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "Reference field 'nonExistY' not found in 'Target'",
    })
  })

  // T-F4-14
  it('fk_fields undefined (리스트측 관계) → FK 검증 skip', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
        relations: [
          makeRelation({
            name: 'orders', target_model: 'Order', type: 'oneToMany',
            // fk_fields: undefined (기본값)
          }),
        ],
      }),
      makeModel({
        name: 'Order',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
  })

  // T-F4-15
  it('fk_fields 빈 배열 → FK 검증 skip (반복 대상 없음)', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
      }),
      makeModel({
        name: 'Profile',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'oneToOne',
            fk_fields: [], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
  })

  // T-F4-16
  it('같은 필드명 2회 → warning DUPLICATE_FIELD 1건', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Broken',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'email', type: 'String', line: 2 }),
          makeField({ name: 'email', type: 'String', nullable: true, line: 3 }),
        ],
      }),
    ]

    const result = validateModels(models)

    const dupVerdicts = result.verdicts.filter(v => v.code === 'DUPLICATE_FIELD')
    expect(dupVerdicts).toHaveLength(1)
    expect(dupVerdicts[0]).toEqual({
      model_name: 'Broken',
      level: 'warning',
      code: 'DUPLICATE_FIELD',
      detail: "Duplicate field 'email'",
    })
  })

  // T-F4-17
  it('같은 필드명 3회 이상 → verdict 1건 (필드명당 1건)', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'TripleDup',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'status', type: 'String', line: 2 }),
          makeField({ name: 'status', type: 'Int', line: 3 }),
          makeField({ name: 'status', type: 'Boolean', line: 4 }),
        ],
      }),
    ]

    const result = validateModels(models)

    const dupVerdicts = result.verdicts.filter(v => v.code === 'DUPLICATE_FIELD')
    expect(dupVerdicts).toHaveLength(1)
    expect(dupVerdicts[0]).toEqual({
      model_name: 'TripleDup',
      level: 'warning',
      code: 'DUPLICATE_FIELD',
      detail: "Duplicate field 'status'",
    })
  })

  // T-F4-18
  it('여러 필드명 각각 중복 → 각 필드명에 대해 verdict 1건씩', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'MultiDup',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'name', type: 'String', line: 2 }),
          makeField({ name: 'name', type: 'String', line: 3 }),
          makeField({ name: 'email', type: 'String', line: 4 }),
          makeField({ name: 'email', type: 'String', line: 5 }),
          makeField({ name: 'age', type: 'Int', line: 6 }),
        ],
      }),
    ]

    const result = validateModels(models)

    const dupVerdicts = result.verdicts.filter(v => v.code === 'DUPLICATE_FIELD')
    expect(dupVerdicts).toHaveLength(2)
    expect(dupVerdicts.map(v => v.detail)).toEqual(
      expect.arrayContaining([
        "Duplicate field 'name'",
        "Duplicate field 'email'",
      ]),
    )
  })

  // T-F4-19
  it('1개 모델에 NO_PK + FK_MISMATCH → warning+error 혼재, 모델 제외 없음', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
      }),
      makeModel({
        name: 'BadView',
        fields: [
          makeField({ name: 'label', type: 'String' }),
          makeField({ name: 'userId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'manyToOne',
            fk_fields: ['missingFk'], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.models).toHaveLength(2)
    expect(result.models).toBe(models)

    const badViewVerdicts = result.verdicts.filter(v => v.model_name === 'BadView')
    expect(badViewVerdicts).toHaveLength(2)

    expect(badViewVerdicts[0]).toEqual({
      model_name: 'BadView',
      level: 'warning',
      code: 'NO_PK',
      detail: 'No primary key found',
    })
    expect(badViewVerdicts[1]).toEqual({
      model_name: 'BadView',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "FK field 'missingFk' not found in 'BadView'",
    })
  })

  // T-F4-20
  it('NO_PK + ORPHAN + FK_MISMATCH + DUPLICATE → 4종 verdict', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'NoPkView',
        fields: [
          makeField({ name: 'label', type: 'String', line: 2 }),
          makeField({ name: 'value', type: 'Int', line: 3 }),
          makeField({ name: 'label', type: 'String', nullable: true, line: 4 }),
        ],
      }),
      makeModel({
        name: 'BadRelation',
        fields: [
          makeField({ name: 'id', primary: true, line: 10 }),
          makeField({ name: 'name', type: 'String', line: 11 }),
        ],
        relations: [
          makeRelation({
            name: 'owner', target_model: 'User', type: 'manyToOne',
            fk_fields: ['ownerId'], references: ['id'], line: 12,
          }),
          makeRelation({
            name: 'ghost', target_model: 'DeletedModel', type: 'manyToOne',
            fk_fields: ['ghostId'], references: ['uid'], line: 13,
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.models).toBe(models)
    expect(result.verdicts).toHaveLength(6)

    expect(result.verdicts[0]).toEqual({
      model_name: 'NoPkView', level: 'warning', code: 'NO_PK',
      detail: 'No primary key found',
    })
    expect(result.verdicts[1]).toEqual({
      model_name: 'NoPkView', level: 'warning', code: 'DUPLICATE_FIELD',
      detail: "Duplicate field 'label'",
    })
    expect(result.verdicts[2]).toEqual({
      model_name: 'BadRelation', level: 'warning', code: 'ORPHAN_RELATION',
      detail: "Relation target 'User' not found for 'owner'",
    })
    expect(result.verdicts[3]).toEqual({
      model_name: 'BadRelation', level: 'error', code: 'FK_MISMATCH',
      detail: "FK field 'ownerId' not found in 'BadRelation'",
    })
    expect(result.verdicts[4]).toEqual({
      model_name: 'BadRelation', level: 'warning', code: 'ORPHAN_RELATION',
      detail: "Relation target 'DeletedModel' not found for 'ghost'",
    })
    expect(result.verdicts[5]).toEqual({
      model_name: 'BadRelation', level: 'error', code: 'FK_MISMATCH',
      detail: "FK field 'ghostId' not found in 'BadRelation'",
    })
  })

  // T-F4-21
  it('verdicts 순서: models 순서 → 규칙 순서 (NO_PK→DUPLICATE→ORPHAN→FK)', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'ModelB',
        fields: [
          makeField({ name: 'x', type: 'String', line: 1 }),
          makeField({ name: 'x', type: 'String', line: 2 }),
        ],
        relations: [
          makeRelation({ name: 'missing', target_model: 'Ghost' }),
        ],
      }),
      makeModel({
        name: 'ModelA',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'fk', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'ref', target_model: 'ModelB', type: 'manyToOne',
            fk_fields: ['nonExist'], references: ['x'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(4)

    const codes = result.verdicts.map(v => `${v.model_name}:${v.code}`)
    expect(codes).toEqual([
      'ModelB:NO_PK',
      'ModelB:DUPLICATE_FIELD',
      'ModelB:ORPHAN_RELATION',
      'ModelA:FK_MISMATCH',
    ])
  })

  // T-F4-22
  it('100+ 필드 거대 모델 → 성능 문제 없이 정상 검증', () => {
    const fields: ModelField[] = [
      makeField({ name: 'id', primary: true, line: 1 }),
    ]
    for (let i = 1; i <= 150; i++) {
      fields.push(makeField({ name: `field_${i}`, type: 'String', line: i + 1 }))
    }

    const relations: ModelRelation[] = []
    for (let i = 1; i <= 20; i++) {
      relations.push(
        makeRelation({
          name: `rel_${i}`, target_model: 'LegacyModel', type: 'manyToOne',
          fk_fields: [`field_${i}`], references: ['id'], line: 200 + i,
        }),
      )
    }

    const models: ModelRaw[] = [
      makeModel({
        name: 'LegacyModel',
        fields: [
          makeField({ name: 'id', primary: true }),
          ...Array.from({ length: 50 }, (_, i) =>
            makeField({ name: `col_${i}`, type: 'String', line: i + 2 }),
          ),
        ],
      }),
      makeModel({
        name: 'GiantModel',
        fields,
        relations,
      }),
    ]

    const start = performance.now()
    const result = validateModels(models)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
    expect(result.verdicts).toEqual([])
    expect(result.models).toHaveLength(2)
  })

  // T-F4-23
  it('같은 모델에 2개 관계 → 각 관계별 독립 검증', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'email', type: 'String' }),
        ],
      }),
      makeModel({
        name: 'Message',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'senderId', type: 'String' }),
          makeField({ name: 'receiverId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'sender', target_model: 'User', type: 'manyToOne',
            fk_fields: ['senderId'], references: ['id'],
          }),
          makeRelation({
            name: 'receiver', target_model: 'User', type: 'manyToOne',
            fk_fields: ['receiverId'], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
  })

  // T-F4-24
  it('auto_generated 관계도 동일 규칙 적용', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
        relations: [
          makeRelation({
            name: 'posts', target_model: 'DeletedPost', type: 'oneToMany',
            auto_generated: true,
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'User',
      level: 'warning',
      code: 'ORPHAN_RELATION',
      detail: "Relation target 'DeletedPost' not found for 'posts'",
    })
  })

  // T-F4-25
  it('FK_MISMATCH error 모델이 result.models에 포함 (불변식 #4)', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Good',
        fields: [makeField({ name: 'id', primary: true })],
      }),
      makeModel({
        name: 'Broken',
        fields: [
          makeField({ name: 'id', primary: true }),
        ],
        relations: [
          makeRelation({
            name: 'ref', target_model: 'Good', type: 'manyToOne',
            fk_fields: ['missingFk'], references: ['id'],
          }),
        ],
      }),
      makeModel({
        name: 'AlsoGood',
        fields: [makeField({ name: 'id', primary: true })],
      }),
    ]

    const result = validateModels(models)

    expect(result.models).toHaveLength(3)
    expect(result.models).toBe(models)
    expect(result.models.map((m: ModelRaw) => m.name)).toEqual(['Good', 'Broken', 'AlsoGood'])

    const errors = result.verdicts.filter(v => v.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.model_name).toBe('Broken')
  })

  // T-F4-26
  it('모든 모델 PK 없음 → NO_PK warning N건 (모델 수만큼)', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'ViewA',
        fields: [makeField({ name: 'col1', type: 'String' })],
      }),
      makeModel({
        name: 'ViewB',
        fields: [makeField({ name: 'col2', type: 'Int' })],
      }),
      makeModel({
        name: 'ViewC',
        fields: [
          makeField({ name: 'col3', type: 'String' }),
          makeField({ name: 'col4', type: 'Boolean' }),
        ],
      }),
    ]

    const result = validateModels(models)

    const noPkVerdicts = result.verdicts.filter(v => v.code === 'NO_PK')
    expect(noPkVerdicts).toHaveLength(3)
    expect(noPkVerdicts.map(v => v.model_name)).toEqual(['ViewA', 'ViewB', 'ViewC'])
    noPkVerdicts.forEach(v => {
      expect(v.level).toBe('warning')
      expect(v.detail).toBe('No primary key found')
    })

    expect(result.models).toHaveLength(3)
    expect(result.models).toBe(models)
  })

  // T-F4-27
  it('fk_fields ["a","b"] 중 "a"만 없음 → FK_MISMATCH 1건', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Target',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'code', type: 'String' }),
        ],
      }),
      makeModel({
        name: 'Source',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'targetCode', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'target', target_model: 'Target', type: 'manyToOne',
            fk_fields: ['targetId', 'targetCode'], references: ['id', 'code'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    const fkErrors = result.verdicts.filter(v => v.code === 'FK_MISMATCH')
    expect(fkErrors).toHaveLength(1)
    expect(fkErrors[0]).toEqual({
      model_name: 'Source',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "FK field 'targetId' not found in 'Source'",
    })
  })

  // T-F4-28
  it('target ORPHAN + fk_fields 미존재 → ORPHAN + FK_MISMATCH(fk), references skip', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Order',
        fields: [
          makeField({ name: 'id', primary: true }),
        ],
        relations: [
          makeRelation({
            name: 'ghost', target_model: 'NonExistent', type: 'manyToOne',
            fk_fields: ['ghostFk'], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(2)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Order',
      level: 'warning',
      code: 'ORPHAN_RELATION',
      detail: "Relation target 'NonExistent' not found for 'ghost'",
    })
    expect(result.verdicts[1]).toEqual({
      model_name: 'Order',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "FK field 'ghostFk' not found in 'Order'",
    })
  })

  // T-F4-29
  it('references=[] → FK_MISMATCH(ref) 미발생', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
      }),
      makeModel({
        name: 'Profile',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'oneToOne',
            fk_fields: ['userId'], references: [],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
  })

  // T-F4-30
  it('fk_fields=[] 통과 + references에 미존재 필드 → FK_MISMATCH(ref) 1건', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
      }),
      makeModel({
        name: 'Profile',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'oneToOne',
            fk_fields: [], references: ['nonExistField'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Profile',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "Reference field 'nonExistField' not found in 'User'",
    })
  })

  // T-F4-31
  it('동일 target 2개 관계 중 1개만 FK 오류 → 오류 관계만 verdict', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'email', type: 'String' }),
        ],
      }),
      makeModel({
        name: 'Message',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'senderId', type: 'String' }),
          // 'receiverId' 없음
        ],
        relations: [
          makeRelation({
            name: 'sender', target_model: 'User', type: 'manyToOne',
            fk_fields: ['senderId'], references: ['id'],
          }),
          makeRelation({
            name: 'receiver', target_model: 'User', type: 'manyToOne',
            fk_fields: ['receiverId'], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(1)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Message',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "FK field 'receiverId' not found in 'Message'",
    })
  })

  // T-F4-32
  it('2개 관계 각각 ORPHAN+FK → 관계별 교차 순서 (ORPHAN→FK, ORPHAN→FK)', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Broken',
        fields: [
          makeField({ name: 'id', primary: true }),
        ],
        relations: [
          makeRelation({
            name: 'relA', target_model: 'GhostA', type: 'manyToOne',
            fk_fields: ['fkA'], references: ['id'],
          }),
          makeRelation({
            name: 'relB', target_model: 'GhostB', type: 'manyToOne',
            fk_fields: ['fkB'], references: ['id'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    const codes = result.verdicts.map(v => v.code)
    expect(codes).toEqual([
      'ORPHAN_RELATION',
      'FK_MISMATCH',
      'ORPHAN_RELATION',
      'FK_MISMATCH',
    ])
    expect(result.verdicts[0]!.detail).toContain('GhostA')
    expect(result.verdicts[1]!.detail).toContain('fkA')
    expect(result.verdicts[2]!.detail).toContain('GhostB')
    expect(result.verdicts[3]!.detail).toContain('fkB')
  })

  // T-F4-33
  it('fk_fields 오류 + references 오류 → FK(fk) 먼저, FK(ref) 나중', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'Target',
        fields: [
          makeField({ name: 'id', primary: true }),
        ],
      }),
      makeModel({
        name: 'Source',
        fields: [
          makeField({ name: 'id', primary: true }),
        ],
        relations: [
          makeRelation({
            name: 'ref', target_model: 'Target', type: 'manyToOne',
            fk_fields: ['missingFk'], references: ['realCol'],
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toHaveLength(2)
    expect(result.verdicts[0]).toEqual({
      model_name: 'Source',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "FK field 'missingFk' not found in 'Source'",
    })
    expect(result.verdicts[1]).toEqual({
      model_name: 'Source',
      level: 'error',
      code: 'FK_MISMATCH',
      detail: "Reference field 'realCol' not found in 'Target'",
    })
  })

  // T-F4-34
  it('references undefined → references 검증 skip', () => {
    const models: ModelRaw[] = [
      makeModel({
        name: 'User',
        fields: [makeField({ name: 'id', primary: true })],
      }),
      makeModel({
        name: 'Order',
        fields: [
          makeField({ name: 'id', primary: true }),
          makeField({ name: 'userId', type: 'String' }),
        ],
        relations: [
          makeRelation({
            name: 'user', target_model: 'User', type: 'manyToOne',
            fk_fields: ['userId'],
            // references: undefined
          }),
        ],
      }),
    ]

    const result = validateModels(models)

    expect(result.verdicts).toEqual([])
  })
})
