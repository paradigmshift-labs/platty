import { beforeAll, describe, expect, it } from 'vitest'
import { JvmAstParserAdapter } from '@/pipeline_modules/build_graph/adapters/jvm_ast.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { spring } from '@/pipeline_modules/build_route/adapters/spring.js'
import { loaded } from '../helpers/graph_builders.js'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'

describe('Spring JVM integration — build_graph evidence to build_route rule engine', () => {
  let adapter: JvmAstParserAdapter
  beforeAll(async () => { adapter = await JvmAstParserAdapter.create() })
  it('extracts route entrypoint from Java Spring controller source', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.web.bind.annotation.*;

        @RestController
        @RequestMapping("/api/orders")
        class OrderController {
          @GetMapping("/{id}")
          public OrderDto get(@PathVariable Long id) {
            return service.find(id);
          }
        }
      `,
      'src/main/java/com/acme/OrderController.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toHaveLength(1)
    expect(result.entryPoints[0]).toMatchObject({
      framework: 'spring',
      kind: 'api',
      httpMethod: 'GET',
      fullPath: '/api/orders/:id',
    })
  })

  it('extracts WebFlux functional route entrypoint from RequestPredicates graph evidence', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.context.annotation.Bean;
        import org.springframework.web.reactive.function.server.*;

        class Routes {
          @Bean
          public RouterFunction<ServerResponse> route(OrderHandler handler) {
            return RouterFunctions.route(RequestPredicates.POST("/orders"), handler::create);
          }
        }
      `,
      'src/main/java/com/acme/Routes.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toContainEqual(expect.objectContaining({
      framework: 'spring',
      kind: 'api',
      httpMethod: 'POST',
      fullPath: '/orders',
    }))
  })

  it('extracts WebFlux static-import route and andRoute predicates', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.context.annotation.Bean;
        import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
        import static org.springframework.web.reactive.function.server.RequestPredicates.POST;
        import static org.springframework.web.reactive.function.server.RouterFunctions.route;

        class Routes {
          @Bean
          public RouterFunction<ServerResponse> route(OrderHandler handler) {
            return route(GET("/orders"), handler::list)
              .andRoute(POST("/orders"), handler::create);
          }
        }
      `,
      'src/main/java/com/acme/Routes.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ httpMethod: 'GET', fullPath: '/orders' }),
      expect.objectContaining({ httpMethod: 'POST', fullPath: '/orders' }),
    ]))
  })

  // KNOWN LIMITATION (tree-sitter-kotlin grammar): `annotation class X` (custom composed-mapping
  // annotations) is misparsed as an infix_expression(`annotation` `class` `X`) instead of a
  // class_declaration, and the misparse CASCADES to corrupt the following class. The AST adapter is
  // grammar-bound (the old regex adapter sidestepped this with text patterns). Recovering declarations
  // from the infix_expression garbage would re-introduce fragile pattern-matching, so this composed-
  // annotation-alias case is a documented gap until the Kotlin grammar handles `annotation class`.
  it.skip('extracts Kotlin composed mapping annotation routes through alias evidence', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.web.bind.annotation.GetMapping
        import org.springframework.web.bind.annotation.RequestMapping
        import org.springframework.web.bind.annotation.RestController

        @GetMapping
        annotation class PublicGet

        @RestController
        @RequestMapping("/api")
        class OrderController {
          @PublicGet("/orders")
          fun list(): List<OrderDto> = orderService.list()
        }
      `,
      'src/main/kotlin/com/acme/OrderController.kt',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toContainEqual(expect.objectContaining({
      framework: 'spring',
      kind: 'api',
      httpMethod: 'GET',
      fullPath: '/api/orders',
      confidence: 'low',
    }))
  })

  it('extracts Java RequestMapping routes with RequestMethod named args', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.web.bind.annotation.*;

        @RestController
        @RequestMapping("/api")
        class OrderController {
          @RequestMapping(method = { RequestMethod.POST }, value = { "/orders" })
          public OrderDto create() {
            return service.create();
          }
        }
      `,
      'src/main/java/com/acme/OrderController.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toContainEqual(expect.objectContaining({
      framework: 'spring',
      kind: 'api',
      httpMethod: 'POST',
      fullPath: '/api/orders',
    }))
  })

  it('extracts Spring websocket message mapping entrypoints from JVM decorators', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.messaging.handler.annotation.MessageMapping;
        import org.springframework.messaging.simp.annotation.SubscribeMapping;

        class ChatSocket {
          @MessageMapping("/chat.send")
          public void send(ChatMessage message) {}

          @SubscribeMapping("/presence")
          public Presence presence() { return new Presence(); }
        }
      `,
      'src/main/java/com/acme/ChatSocket.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ framework: 'spring', kind: 'event', fullPath: '/chat.send' }),
      expect.objectContaining({ framework: 'spring', kind: 'event', fullPath: '/presence' }),
    ]))
  })

  it('expands Java RequestMapping routes with value arrays', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.web.bind.annotation.*;

        @RestController
        @RequestMapping("/api")
        class OrderController {
          @RequestMapping(method = RequestMethod.GET, value = { "/orders", "/purchases" })
          public List<OrderDto> list() {
            return service.list();
          }
        }
      `,
      'src/main/java/com/acme/OrderController.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ httpMethod: 'GET', fullPath: '/api/orders' }),
      expect.objectContaining({ httpMethod: 'GET', fullPath: '/api/purchases' }),
    ]))
  })

  it('extracts Kotlin WebFlux router DSL routes', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.context.annotation.Bean
        import org.springframework.web.reactive.function.server.coRouter

        class Routes {
          @Bean
          fun route(handler: OrderHandler) = coRouter {
            GET("/orders", handler::list)
            POST("/orders", handler::create)
          }
        }
      `,
      'src/main/kotlin/com/acme/Routes.kt',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ httpMethod: 'GET', fullPath: '/orders' }),
      expect.objectContaining({ httpMethod: 'POST', fullPath: '/orders' }),
    ]))
  })

  it('expands Spring mapping routes with path arrays', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.web.bind.annotation.*;

        @RestController
        @RequestMapping("/api")
        class OrderController {
          @GetMapping(path = { "/orders", "/purchases" })
          public List<OrderDto> list() {
            return service.list();
          }
        }
      `,
      'src/main/java/com/acme/OrderController.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ httpMethod: 'GET', fullPath: '/api/orders' }),
      expect.objectContaining({ httpMethod: 'GET', fullPath: '/api/purchases' }),
    ]))
  })

  it('extracts Spring Scheduled job entrypoints from Java source', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.scheduling.annotation.Scheduled;
        import org.springframework.stereotype.Component;

        @Component
        class BillingJob {
          @Scheduled(cron = "0 0 * * * *")
          public void reconcile() {
            service.reconcile();
          }
        }
      `,
      'src/main/java/com/acme/jobs/BillingJob.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toContainEqual(expect.objectContaining({
      framework: 'spring',
      kind: 'job',
      handlerNodeId: 'repo_spring:src/main/java/com/acme/jobs/BillingJob.java:BillingJob.reconcile',
    }))
  })

  it('extracts Spring EventListener entrypoints from Java source', async () => {
    const parsed = adapter.parseFile(
      `
        import org.springframework.context.event.EventListener;
        import org.springframework.stereotype.Component;

        @Component
        class OrderListener {
          @EventListener(OrderPaidEvent.class)
          public void onOrderPaid(OrderPaidEvent event) {
            service.handle(event);
          }
        }
      `,
      'src/main/java/com/acme/events/OrderListener.java',
      'repo_spring',
    )
    const graph = createGraphIndex({
      nodes: parsed.nodes.map((node): CodeNode => ({
        id: node.id,
        repoId: node.repo_id,
        type: node.type,
        filePath: node.file_path,
        name: node.name,
        lineStart: node.line_start,
        lineEnd: node.line_end,
        signature: node.signature,
        exported: node.exported,
        isDefaultExport: false,
        isAsync: node.is_async,
        isTest: node.is_test,
        testType: node.test_type,
        docComment: node.jsdoc,
        parseStatus: node.parse_status,
        createdAt: '2026-05-22',
      } as CodeNode)),
      edges: parsed.edges.map((edge, index): CodeEdge => ({
        id: index + 1,
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
        createdAt: '2026-05-22',
      } as CodeEdge)),
    })

    const result = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: 'repo_spring' })

    expect(result.entryPoints).toContainEqual(expect.objectContaining({
      framework: 'spring',
      kind: 'event',
      fullPath: 'OrderPaidEvent.class',
      handlerNodeId: 'repo_spring:src/main/java/com/acme/events/OrderListener.java:OrderListener.onOrderPaid',
    }))
  })
})
