import { describe, expect, it } from 'vitest'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { JpaGraphAdapter } from '@/pipeline_modules/build_models/adapters/jpa.js'

const PROJ_ID = 'proj_jpa'
const REPO_ID = 'repo_jpa'

function seedDb(db: DB): void {
  db.insert(projects).values({ id: PROJ_ID, name: 'JPA Test' }).run()
  db.insert(repositories).values({
    id: REPO_ID,
    projectId: PROJ_ID,
    name: 'jpa-repo',
    repoPath: '/mock/repo',
  }).run()
}

function addNode(db: DB, opts: { id: string; type: 'class' | 'property'; name: string; signature?: string | null; lineStart?: number }): void {
  db.insert(codeNodes).values({
    id: opts.id,
    repoId: REPO_ID,
    type: opts.type,
    name: opts.name,
    filePath: 'src/main/java/com/acme/Order.java',
    lineStart: opts.lineStart ?? 1,
    lineEnd: opts.lineStart ?? 1,
    signature: opts.signature ?? null,
    exported: opts.type === 'class',
  }).run()
}

function addEdge(db: DB, opts: {
  sourceId: string
  relation: 'contains' | 'decorates' | 'extends' | 'type_ref'
  targetId?: string | null
  targetSymbol?: string | null
  firstArg?: string | null
}): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId: opts.sourceId,
    targetId: opts.targetId ?? null,
    relation: opts.relation,
    targetSymbol: opts.targetSymbol ?? null,
    firstArg: opts.firstArg ?? null,
    resolveStatus: 'pending',
    source: 'static',
  }).run()
}

describe('JpaGraphAdapter', () => {
  it('extracts JPA entity fields and table metadata from graph evidence', async () => {
    const db = createTestDb()
    seedDb(db)

    const entityId = `${REPO_ID}:Order.java:Order`
    addNode(db, { id: entityId, type: 'class', name: 'Order' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Entity' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Table', firstArg: '{ name: "orders" }' })

    const id = `${entityId}.id`
    const title = `${entityId}.title`
    addNode(db, { id, type: 'property', name: 'id', signature: 'Long', lineStart: 4 })
    addNode(db, { id: title, type: 'property', name: 'title', signature: 'String', lineStart: 7 })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: id, targetSymbol: 'id' })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: title, targetSymbol: 'title' })
    addEdge(db, { sourceId: id, relation: 'decorates', targetSymbol: 'Id' })
    addEdge(db, { sourceId: id, relation: 'decorates', targetSymbol: 'GeneratedValue' })
    addEdge(db, { sourceId: id, relation: 'type_ref', targetSymbol: 'Long' })
    addEdge(db, { sourceId: title, relation: 'decorates', targetSymbol: 'Column', firstArg: '{ nullable: false, unique: true }' })
    addEdge(db, { sourceId: title, relation: 'type_ref', targetSymbol: 'String' })

    const models = await new JpaGraphAdapter().queryFromGraph(db, REPO_ID)

    expect(models).toHaveLength(1)
    expect(models[0].name).toBe('Order')
    expect(models[0].table_name).toBe('orders')
    expect(models[0].fields).toContainEqual(expect.objectContaining({
      name: 'id',
      type: 'Int',
      primary: true,
    }))
    expect(models[0].fields).toContainEqual(expect.objectContaining({
      name: 'title',
      type: 'String',
      nullable: false,
      unique: true,
    }))
  })

  it('extracts JPA relations from relation annotations and type refs', async () => {
    const db = createTestDb()
    seedDb(db)

    const entityId = `${REPO_ID}:Order.java:Order`
    const customerId = `${entityId}.customer`
    addNode(db, { id: entityId, type: 'class', name: 'Order' })
    addNode(db, { id: customerId, type: 'property', name: 'customer', signature: 'Customer' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Entity' })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: customerId, targetSymbol: 'customer' })
    addEdge(db, { sourceId: customerId, relation: 'decorates', targetSymbol: 'ManyToOne' })
    addEdge(db, { sourceId: customerId, relation: 'decorates', targetSymbol: 'JoinColumn', firstArg: '{ name: "customer_id" }' })
    addEdge(db, { sourceId: customerId, relation: 'type_ref', targetSymbol: 'Customer' })

    const models = await new JpaGraphAdapter().queryFromGraph(db, REPO_ID)

    expect(models[0].relations).toEqual([
      expect.objectContaining({
        name: 'customer',
        target_model: 'Customer',
        type: 'manyToOne',
        fk_fields: ['customer_id'],
      }),
    ])
  })

  it('includes fields inherited from JPA mapped superclasses', async () => {
    const db = createTestDb()
    seedDb(db)

    const baseId = `${REPO_ID}:BaseEntity.java:BaseEntity`
    const entityId = `${REPO_ID}:Order.java:Order`
    const id = `${baseId}.id`
    const title = `${entityId}.title`
    addNode(db, { id: baseId, type: 'class', name: 'BaseEntity' })
    addNode(db, { id: entityId, type: 'class', name: 'Order' })
    addNode(db, { id, type: 'property', name: 'id', signature: 'Long' })
    addNode(db, { id: title, type: 'property', name: 'title', signature: 'String' })
    addEdge(db, { sourceId: baseId, relation: 'decorates', targetSymbol: 'MappedSuperclass' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Entity' })
    addEdge(db, { sourceId: entityId, relation: 'extends', targetSymbol: 'BaseEntity', targetId: baseId })
    addEdge(db, { sourceId: baseId, relation: 'contains', targetId: id, targetSymbol: 'id' })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: title, targetSymbol: 'title' })
    addEdge(db, { sourceId: id, relation: 'decorates', targetSymbol: 'Id' })
    addEdge(db, { sourceId: id, relation: 'type_ref', targetSymbol: 'Long' })
    addEdge(db, { sourceId: title, relation: 'decorates', targetSymbol: 'Column' })
    addEdge(db, { sourceId: title, relation: 'type_ref', targetSymbol: 'String' })

    const models = await new JpaGraphAdapter().queryFromGraph(db, REPO_ID)

    expect(models).toHaveLength(1)
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'id', primary: true, type: 'Int' }))
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'title', type: 'String' }))
  })

  it('extracts embeddable value objects and embedded relations', async () => {
    const db = createTestDb()
    seedDb(db)

    const entityId = `${REPO_ID}:Order.java:Order`
    const embeddableId = `${REPO_ID}:Address.java:Address`
    const addressProp = `${entityId}.address`
    const cityProp = `${embeddableId}.city`
    addNode(db, { id: entityId, type: 'class', name: 'Order' })
    addNode(db, { id: embeddableId, type: 'class', name: 'Address' })
    addNode(db, { id: addressProp, type: 'property', name: 'address', signature: 'Address' })
    addNode(db, { id: cityProp, type: 'property', name: 'city', signature: 'String' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Entity' })
    addEdge(db, { sourceId: embeddableId, relation: 'decorates', targetSymbol: 'Embeddable' })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: addressProp, targetSymbol: 'address' })
    addEdge(db, { sourceId: embeddableId, relation: 'contains', targetId: cityProp, targetSymbol: 'city' })
    addEdge(db, { sourceId: addressProp, relation: 'decorates', targetSymbol: 'Embedded' })
    addEdge(db, { sourceId: addressProp, relation: 'type_ref', targetSymbol: 'Address' })
    addEdge(db, { sourceId: cityProp, relation: 'decorates', targetSymbol: 'Column', firstArg: '{ nullable: false }' })
    addEdge(db, { sourceId: cityProp, relation: 'type_ref', targetSymbol: 'String' })

    const models = await new JpaGraphAdapter().queryFromGraph(db, REPO_ID)

    expect(models).toHaveLength(2)
    expect(models.find((model) => model.name === 'Address')?.fields).toContainEqual(expect.objectContaining({
      name: 'city',
      nullable: false,
      type: 'String',
    }))
    expect(models.find((model) => model.name === 'Order')?.relations).toContainEqual(expect.objectContaining({
      name: 'address',
      target_model: 'Address',
      type: 'embedded',
    }))
  })

  it('extracts JPA element collections as value fields', async () => {
    const db = createTestDb()
    seedDb(db)

    const entityId = `${REPO_ID}:Order.java:Order`
    const tags = `${entityId}.tags`
    addNode(db, { id: entityId, type: 'class', name: 'Order' })
    addNode(db, { id: tags, type: 'property', name: 'tags', signature: 'String' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Entity' })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: tags, targetSymbol: 'tags' })
    addEdge(db, { sourceId: tags, relation: 'decorates', targetSymbol: 'ElementCollection' })
    addEdge(db, { sourceId: tags, relation: 'type_ref', targetSymbol: 'String' })

    const models = await new JpaGraphAdapter().queryFromGraph(db, REPO_ID)

    expect(models).toHaveLength(1)
    expect(models[0].fields).toContainEqual(expect.objectContaining({
      name: 'tags',
      nullable: true,
      type: 'String',
    }))
    expect(models[0].relations).toEqual([])
  })

  it('extracts JPA enumerated fields without requiring Column', async () => {
    const db = createTestDb()
    seedDb(db)

    const entityId = `${REPO_ID}:Order.java:Order`
    const status = `${entityId}.status`
    addNode(db, { id: entityId, type: 'class', name: 'Order' })
    addNode(db, { id: status, type: 'property', name: 'status', signature: 'OrderStatus' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Entity' })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: status, targetSymbol: 'status' })
    addEdge(db, { sourceId: status, relation: 'decorates', targetSymbol: 'Enumerated', firstArg: 'EnumType.STRING' })
    addEdge(db, { sourceId: status, relation: 'type_ref', targetSymbol: 'OrderStatus' })

    const models = await new JpaGraphAdapter().queryFromGraph(db, REPO_ID)

    expect(models).toHaveLength(1)
    expect(models[0].fields).toContainEqual(expect.objectContaining({
      name: 'status',
      nullable: true,
      type: 'OrderStatus',
    }))
    expect(models[0].relations).toEqual([])
  })

  it('extracts JPA Lob fields without requiring Column', async () => {
    const db = createTestDb()
    seedDb(db)

    const entityId = `${REPO_ID}:Article.java:Article`
    const body = `${entityId}.body`
    addNode(db, { id: entityId, type: 'class', name: 'Article' })
    addNode(db, { id: body, type: 'property', name: 'body', signature: 'String' })
    addEdge(db, { sourceId: entityId, relation: 'decorates', targetSymbol: 'Entity' })
    addEdge(db, { sourceId: entityId, relation: 'contains', targetId: body, targetSymbol: 'body' })
    addEdge(db, { sourceId: body, relation: 'decorates', targetSymbol: 'Lob' })
    addEdge(db, { sourceId: body, relation: 'type_ref', targetSymbol: 'String' })

    const models = await new JpaGraphAdapter().queryFromGraph(db, REPO_ID)

    expect(models).toHaveLength(1)
    expect(models[0].fields).toContainEqual(expect.objectContaining({
      name: 'body',
      nullable: true,
      type: 'String',
    }))
    expect(models[0].relations).toEqual([])
  })
})
