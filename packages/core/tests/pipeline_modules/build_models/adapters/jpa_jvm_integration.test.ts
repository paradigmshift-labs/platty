import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { JvmAstParserAdapter } from '@/pipeline_modules/build_graph/adapters/jvm_ast.js'
import { JpaGraphAdapter } from '@/pipeline_modules/build_models/adapters/jpa.js'

describe('JPA JVM integration — build_graph evidence to build_models adapter', () => {
  let adapter: JvmAstParserAdapter
  beforeAll(async () => { adapter = await JvmAstParserAdapter.create() })
  it('extracts model fields and relations from Java entity source', async () => {
    const db = createTestDb()
    const repoId = 'repo_jpa_integration'
    db.insert(projects).values({ id: 'proj_jpa_integration', name: 'JPA Integration' }).run()
    db.insert(repositories).values({
      id: repoId,
      projectId: 'proj_jpa_integration',
      name: 'jpa-integration',
      repoPath: '/mock/repo',
    }).run()

    const parsed = adapter.parseFile(
      `
        import jakarta.persistence.*;

        @Entity
        @Table(name = "orders")
        class Order {
          @Id
          private Long id;

          @Column(nullable = false)
          private String title;

          @ManyToOne
          @JoinColumn(name = "customer_id")
          private Customer customer;
        }
      `,
      'src/main/java/com/acme/Order.java',
      repoId,
    )

    for (const node of parsed.nodes) {
      db.insert(codeNodes).values({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
      }).run()
    }
    for (const edge of parsed.edges) {
      db.insert(codeEdges).values({
        repoId: edge.repo_id,
        sourceId: edge.source_id,
        targetId: edge.target_id,
        relation: edge.relation,
        targetSpecifier: edge.target_specifier,
        targetSymbol: edge.target_symbol,
        firstArg: edge.first_arg ?? null,
        literalArgs: edge.literal_args ?? null,
        resolveStatus: edge.resolve_status === 'n/a' ? 'pending' : edge.resolve_status,
        confidence: edge.confidence ?? null,
        source: edge.source ?? 'static',
        chainPath: edge.chain_path ?? null,
        typeRefSubtype: edge.type_ref_subtype ?? null,
      }).run()
    }

    const models = await new JpaGraphAdapter().queryFromGraph(db, repoId)

    expect(models).toHaveLength(1)
    expect(models[0].table_name).toBe('orders')
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'id', primary: true, type: 'Int' }))
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'title', nullable: false, type: 'String' }))
    expect(models[0].relations).toContainEqual(expect.objectContaining({
      name: 'customer',
      target_model: 'Customer',
      type: 'manyToOne',
      fk_fields: ['customer_id'],
    }))
  })

  it('extracts model fields and relations from Kotlin primary-constructor entity source', async () => {
    const db = createTestDb()
    const repoId = 'repo_jpa_kotlin_integration'
    db.insert(projects).values({ id: 'proj_jpa_kotlin_integration', name: 'JPA Kotlin Integration' }).run()
    db.insert(repositories).values({
      id: repoId,
      projectId: 'proj_jpa_kotlin_integration',
      name: 'jpa-kotlin-integration',
      repoPath: '/mock/repo',
    }).run()

    const parsed = adapter.parseFile(
      `
        import jakarta.persistence.*

        @Entity
        @Table(name = "orders")
        data class Order(
          @Id
          val id: Long,
          @Column(nullable = false)
          val title: String,
          @ManyToOne
          @JoinColumn(name = "customer_id")
          val customer: Customer,
        )
      `,
      'src/main/kotlin/com/acme/Order.kt',
      repoId,
    )

    for (const node of parsed.nodes) {
      db.insert(codeNodes).values({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
      }).run()
    }
    for (const edge of parsed.edges) {
      db.insert(codeEdges).values({
        repoId: edge.repo_id,
        sourceId: edge.source_id,
        targetId: edge.target_id,
        relation: edge.relation,
        targetSpecifier: edge.target_specifier,
        targetSymbol: edge.target_symbol,
        firstArg: edge.first_arg ?? null,
        literalArgs: edge.literal_args ?? null,
        resolveStatus: edge.resolve_status === 'n/a' ? 'pending' : edge.resolve_status,
        confidence: edge.confidence ?? null,
        source: edge.source ?? 'static',
        chainPath: edge.chain_path ?? null,
        typeRefSubtype: edge.type_ref_subtype ?? null,
      }).run()
    }

    const models = await new JpaGraphAdapter().queryFromGraph(db, repoId)

    expect(models).toHaveLength(1)
    expect(models[0].table_name).toBe('orders')
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'id', primary: true, type: 'Int' }))
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'title', nullable: false, type: 'String' }))
    expect(models[0].relations).toContainEqual(expect.objectContaining({
      name: 'customer',
      target_model: 'Customer',
      type: 'manyToOne',
      fk_fields: ['customer_id'],
    }))
  })

  it('extracts inherited fields from Java mapped superclass source', async () => {
    const db = createTestDb()
    const repoId = 'repo_jpa_mapped_superclass_integration'
    db.insert(projects).values({ id: 'proj_jpa_mapped_superclass_integration', name: 'JPA Mapped Superclass Integration' }).run()
    db.insert(repositories).values({
      id: repoId,
      projectId: 'proj_jpa_mapped_superclass_integration',
      name: 'jpa-mapped-superclass-integration',
      repoPath: '/mock/repo',
    }).run()

    const parsed = adapter.parseFile(
      `
        import jakarta.persistence.*;

        @MappedSuperclass
        class BaseEntity {
          @Id
          private Long id;
        }

        @Entity
        class Order extends BaseEntity {
          @Column(nullable = false)
          private String title;
        }
      `,
      'src/main/java/com/acme/Order.java',
      repoId,
    )

    for (const node of parsed.nodes) {
      db.insert(codeNodes).values({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
      }).run()
    }
    for (const edge of parsed.edges) {
      db.insert(codeEdges).values({
        repoId: edge.repo_id,
        sourceId: edge.source_id,
        targetId: edge.target_id,
        relation: edge.relation,
        targetSpecifier: edge.target_specifier,
        targetSymbol: edge.target_symbol,
        firstArg: edge.first_arg ?? null,
        literalArgs: edge.literal_args ?? null,
        resolveStatus: edge.resolve_status === 'n/a' ? 'pending' : edge.resolve_status,
        confidence: edge.confidence ?? null,
        source: edge.source ?? 'static',
        chainPath: edge.chain_path ?? null,
        typeRefSubtype: edge.type_ref_subtype ?? null,
      }).run()
    }

    const models = await new JpaGraphAdapter().queryFromGraph(db, repoId)

    expect(models).toHaveLength(1)
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'id', primary: true, type: 'Int' }))
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'title', nullable: false, type: 'String' }))
  })

  it('extracts model fields and relations from Kotlin body properties', async () => {
    const db = createTestDb()
    const repoId = 'repo_jpa_kotlin_body_integration'
    db.insert(projects).values({ id: 'proj_jpa_kotlin_body_integration', name: 'JPA Kotlin Body Integration' }).run()
    db.insert(repositories).values({
      id: repoId,
      projectId: 'proj_jpa_kotlin_body_integration',
      name: 'jpa-kotlin-body-integration',
      repoPath: '/mock/repo',
    }).run()

    const parsed = adapter.parseFile(
      `
        import jakarta.persistence.*

        @Entity
        @Table(name = "orders")
        class Order {
          @Id
          var id: Long? = null

          @Column(nullable = false)
          lateinit var title: String

          @ManyToOne(fetch = FetchType.LAZY)
          @JoinColumn(name = "customer_id")
          var customer: Customer? = null
        }
      `,
      'src/main/kotlin/com/acme/Order.kt',
      repoId,
    )

    for (const node of parsed.nodes) {
      db.insert(codeNodes).values({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
      }).run()
    }
    for (const edge of parsed.edges) {
      db.insert(codeEdges).values({
        repoId: edge.repo_id,
        sourceId: edge.source_id,
        targetId: edge.target_id,
        relation: edge.relation,
        targetSpecifier: edge.target_specifier,
        targetSymbol: edge.target_symbol,
        firstArg: edge.first_arg ?? null,
        literalArgs: edge.literal_args ?? null,
        resolveStatus: edge.resolve_status === 'n/a' ? 'pending' : edge.resolve_status,
        confidence: edge.confidence ?? null,
        source: edge.source ?? 'static',
        chainPath: edge.chain_path ?? null,
        typeRefSubtype: edge.type_ref_subtype ?? null,
      }).run()
    }

    const models = await new JpaGraphAdapter().queryFromGraph(db, repoId)

    expect(models).toHaveLength(1)
    expect(models[0].table_name).toBe('orders')
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'id', primary: true, type: 'Int' }))
    expect(models[0].fields).toContainEqual(expect.objectContaining({ name: 'title', nullable: false, type: 'String' }))
    expect(models[0].relations).toContainEqual(expect.objectContaining({
      name: 'customer',
      target_model: 'Customer',
      type: 'manyToOne',
      fk_fields: ['customer_id'],
    }))
  })

  it('extracts embeddable value objects and embedded relations from Java source', async () => {
    const db = createTestDb()
    const repoId = 'repo_jpa_embedded_integration'
    db.insert(projects).values({ id: 'proj_jpa_embedded_integration', name: 'JPA Embedded Integration' }).run()
    db.insert(repositories).values({
      id: repoId,
      projectId: 'proj_jpa_embedded_integration',
      name: 'jpa-embedded-integration',
      repoPath: '/mock/repo',
    }).run()

    const parsed = adapter.parseFile(
      `
        import jakarta.persistence.*;

        @Embeddable
        class Address {
          @Column(nullable = false)
          private String city;
        }

        @Entity
        class Order {
          @Id
          private Long id;

          @Embedded
          private Address address;
        }
      `,
      'src/main/java/com/acme/Order.java',
      repoId,
    )

    for (const node of parsed.nodes) {
      db.insert(codeNodes).values({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
      }).run()
    }
    for (const edge of parsed.edges) {
      db.insert(codeEdges).values({
        repoId: edge.repo_id,
        sourceId: edge.source_id,
        targetId: edge.target_id,
        relation: edge.relation,
        targetSpecifier: edge.target_specifier,
        targetSymbol: edge.target_symbol,
        firstArg: edge.first_arg ?? null,
        literalArgs: edge.literal_args ?? null,
        resolveStatus: edge.resolve_status === 'n/a' ? 'pending' : edge.resolve_status,
        confidence: edge.confidence ?? null,
        source: edge.source ?? 'static',
        chainPath: edge.chain_path ?? null,
        typeRefSubtype: edge.type_ref_subtype ?? null,
      }).run()
    }

    const models = await new JpaGraphAdapter().queryFromGraph(db, repoId)

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

  it('extracts element collection value fields from Java source', async () => {
    const db = createTestDb()
    const repoId = 'repo_jpa_element_collection_integration'
    db.insert(projects).values({ id: 'proj_jpa_element_collection_integration', name: 'JPA Element Collection Integration' }).run()
    db.insert(repositories).values({
      id: repoId,
      projectId: 'proj_jpa_element_collection_integration',
      name: 'jpa-element-collection-integration',
      repoPath: '/mock/repo',
    }).run()

    const parsed = adapter.parseFile(
      `
        import jakarta.persistence.*;
        import java.util.Set;

        @Entity
        class Order {
          @Id
          private Long id;

          @ElementCollection
          private Set<String> tags;
        }
      `,
      'src/main/java/com/acme/Order.java',
      repoId,
    )

    for (const node of parsed.nodes) {
      db.insert(codeNodes).values({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
      }).run()
    }
    for (const edge of parsed.edges) {
      db.insert(codeEdges).values({
        repoId: edge.repo_id,
        sourceId: edge.source_id,
        targetId: edge.target_id,
        relation: edge.relation,
        targetSpecifier: edge.target_specifier,
        targetSymbol: edge.target_symbol,
        firstArg: edge.first_arg ?? null,
        literalArgs: edge.literal_args ?? null,
        resolveStatus: edge.resolve_status === 'n/a' ? 'pending' : edge.resolve_status,
        confidence: edge.confidence ?? null,
        source: edge.source ?? 'static',
        chainPath: edge.chain_path ?? null,
        typeRefSubtype: edge.type_ref_subtype ?? null,
      }).run()
    }

    const models = await new JpaGraphAdapter().queryFromGraph(db, repoId)

    expect(models).toHaveLength(1)
    expect(models[0].fields).toContainEqual(expect.objectContaining({
      name: 'tags',
      nullable: true,
      type: 'String',
    }))
    expect(models[0].relations).toEqual([])
  })

  it('extracts enumerated value fields from Java source', async () => {
    const db = createTestDb()
    const repoId = 'repo_jpa_enumerated_integration'
    db.insert(projects).values({ id: 'proj_jpa_enumerated_integration', name: 'JPA Enumerated Integration' }).run()
    db.insert(repositories).values({
      id: repoId,
      projectId: 'proj_jpa_enumerated_integration',
      name: 'jpa-enumerated-integration',
      repoPath: '/mock/repo',
    }).run()

    const parsed = adapter.parseFile(
      `
        import jakarta.persistence.*;

        enum OrderStatus { DRAFT, PAID }

        @Entity
        class Order {
          @Id
          private Long id;

          @Enumerated(EnumType.STRING)
          private OrderStatus status;
        }
      `,
      'src/main/java/com/acme/Order.java',
      repoId,
    )

    for (const node of parsed.nodes) {
      db.insert(codeNodes).values({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
      }).run()
    }
    for (const edge of parsed.edges) {
      db.insert(codeEdges).values({
        repoId: edge.repo_id,
        sourceId: edge.source_id,
        targetId: edge.target_id,
        relation: edge.relation,
        targetSpecifier: edge.target_specifier,
        targetSymbol: edge.target_symbol,
        firstArg: edge.first_arg ?? null,
        literalArgs: edge.literal_args ?? null,
        resolveStatus: edge.resolve_status === 'n/a' ? 'pending' : edge.resolve_status,
        confidence: edge.confidence ?? null,
        source: edge.source ?? 'static',
        chainPath: edge.chain_path ?? null,
        typeRefSubtype: edge.type_ref_subtype ?? null,
      }).run()
    }

    const models = await new JpaGraphAdapter().queryFromGraph(db, repoId)

    expect(models).toHaveLength(1)
    expect(models[0].fields).toContainEqual(expect.objectContaining({
      name: 'status',
      nullable: true,
      type: 'OrderStatus',
    }))
    expect(models[0].relations).toEqual([])
  })
})
