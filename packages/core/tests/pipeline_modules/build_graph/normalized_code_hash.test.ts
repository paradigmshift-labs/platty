import { describe, expect, it, beforeAll } from 'vitest'
import {
  computeNormalizedCodeHash,
  normalizeCodeForHash,
} from '@/pipeline_modules/build_graph/normalized_code_hash.js'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart.js'

function nodeHash(nodes: Array<{ name: string; normalized_code_hash?: string | null }>, name: string): string {
  const node = nodes.find((n) => n.name === name)
  expect(node, `node ${name} should exist`).toBeTruthy()
  expect(node!.normalized_code_hash).toMatch(/^[a-f0-9]{64}$/)
  return node!.normalized_code_hash!
}

describe('normalized code hash utility', () => {
  it('ignores comments and whitespace outside strings', () => {
    const compact = "async function list(){return service.find('a b')}"
    const noisy = `
      // route helper
      async   function list ( ) {
        /* implementation detail */
        return   service.find('a b')
      }
    `

    expect(normalizeCodeForHash(noisy)).toBe(normalizeCodeForHash(compact))
    expect(computeNormalizedCodeHash(noisy)).toBe(computeNormalizedCodeHash(compact))
  })

  it('preserves identifiers, decorator arguments, and string contents', () => {
    const v1 = "@Get('/orders')\nfunction listOrders(){return '/orders'}"
    const v2 = "@Get('/orders/:id')\nfunction listOrders(){return '/orders'}"
    const v3 = "@Get('/orders')\nfunction fetchOrders(){return '/orders'}"

    expect(computeNormalizedCodeHash(v1)).not.toBe(computeNormalizedCodeHash(v2))
    expect(computeNormalizedCodeHash(v1)).not.toBe(computeNormalizedCodeHash(v3))
  })

  it('preserves TypeScript regex literals that contain comment-like text', () => {
    const compact = 'function parse(){return /https?:\\/\\/api\\/\\*\\/v1/.test(url)}'
    const noisy = `
      function parse() {
        // comment should disappear
        return /https?:\\/\\/api\\/\\*\\/v1/.test(url)
      }
    `
    const changedRegex = 'function parse(){return /https?:\\/\\/api\\/v2/.test(url)}'

    expect(computeNormalizedCodeHash(noisy)).toBe(computeNormalizedCodeHash(compact))
    expect(computeNormalizedCodeHash(noisy)).not.toBe(computeNormalizedCodeHash(changedRegex))
  })
})

describe('TypeScript adapter normalized_code_hash', () => {
  const adapter = new TypeScriptParserAdapter()

  it('hashes method source from first decorator and ignores formatting/comment-only changes', async () => {
    const base = `
class OrderController {
  @Get('/orders')
  @UseGuards(AuthGuard)
  async listOrders() {
    return this.orderService.list()
  }
}
`
    const formatted = `
class OrderController {
  // public route
  @Get('/orders')

  @UseGuards(AuthGuard)
  async   listOrders ( ) {
    /* keep docs stable */
    return   this.orderService.list()
  }
}
`
    const baseResult = await adapter.parseFile(base, 'src/orders.controller.ts', 'r1')
    const formattedResult = await adapter.parseFile(formatted, 'src/orders.controller.ts', 'r1')
    const method = baseResult.nodes.find((n) => n.name === 'OrderController.listOrders')

    expect(method?.line_start).toBe(3)
    expect(nodeHash(baseResult.nodes, 'OrderController.listOrders'))
      .toBe(nodeHash(formattedResult.nodes, 'OrderController.listOrders'))
  })

  it('changes hash for decorator argument, added auth decorator, property option, and function rename', async () => {
    const routeV1 = "class C {\n  @Get('/orders')\n  listOrders(){ return this.svc.list() }\n}"
    const routeV2 = "class C {\n  @Get('/orders/:id')\n  listOrders(){ return this.svc.list() }\n}"
    const routeV3 = "class C {\n  @Get('/orders')\n  @UseGuards(AuthGuard)\n  listOrders(){ return this.svc.list() }\n}"
    const propV1 = "class Model {\n  @Column({ nullable: true })\n  name!: string\n}"
    const propV2 = "class Model {\n  @Column({ nullable: false })\n  name!: string\n}"
    const fnV1 = 'export function listOrders(){ return 1 }'
    const fnV2 = 'export function fetchOrders(){ return 1 }'

    expect(nodeHash((await adapter.parseFile(routeV1, 'src/c.ts', 'r1')).nodes, 'C.listOrders'))
      .not.toBe(nodeHash((await adapter.parseFile(routeV2, 'src/c.ts', 'r1')).nodes, 'C.listOrders'))
    expect(nodeHash((await adapter.parseFile(routeV1, 'src/c.ts', 'r1')).nodes, 'C.listOrders'))
      .not.toBe(nodeHash((await adapter.parseFile(routeV3, 'src/c.ts', 'r1')).nodes, 'C.listOrders'))
    expect(nodeHash((await adapter.parseFile(propV1, 'src/model.ts', 'r1')).nodes, 'Model.name'))
      .not.toBe(nodeHash((await adapter.parseFile(propV2, 'src/model.ts', 'r1')).nodes, 'Model.name'))
    expect(nodeHash((await adapter.parseFile(fnV1, 'src/f.ts', 'r1')).nodes, 'listOrders'))
      .not.toBe(nodeHash((await adapter.parseFile(fnV2, 'src/f.ts', 'r1')).nodes, 'fetchOrders'))
  })

  it('includes class decorators in class range and hash', async () => {
    const classV1 = "@Controller('/orders')\nclass OrderController {}"
    const classV2 = "@Controller('/admin/orders')\nclass OrderController {}"
    const result = await adapter.parseFile(classV1, 'src/orders.controller.ts', 'r1')
    const cls = result.nodes.find((n) => n.name === 'OrderController')

    expect(cls?.line_start).toBe(1)
    expect(nodeHash(result.nodes, 'OrderController'))
      .not.toBe(nodeHash((await adapter.parseFile(classV2, 'src/orders.controller.ts', 'r1')).nodes, 'OrderController'))
  })

  it('keeps the same hash for identical code moved to another file', async () => {
    const content = "export function listOrders(){ return service.list() }"

    expect(nodeHash((await adapter.parseFile(content, 'src/a/orders.ts', 'r1')).nodes, 'listOrders'))
      .toBe(nodeHash((await adapter.parseFile(content, 'src/b/orders.ts', 'r1')).nodes, 'listOrders'))
  })
})

describe('Dart adapter normalized_code_hash', () => {
  let adapter: DartParserAdapter

  beforeAll(async () => {
    adapter = await DartParserAdapter.create()
  })

  it('hashes annotated method source from first annotation and ignores formatting/comment-only changes', () => {
    const base = `
class OrderPage {
  @override
  Future<void> build() async {
    return render();
  }
}
`
    const formatted = `
class OrderPage {
  // Flutter override
  @override

  Future<void>   build ( ) async {
    /* docs stable */
    return   render();
  }
}
`
    const baseResult = adapter.parseFile(base, 'lib/order_page.dart', 'r1')
    const formattedResult = adapter.parseFile(formatted, 'lib/order_page.dart', 'r1')
    const method = baseResult.nodes.find((n) => n.name === 'build')

    expect(method?.line_start).toBe(3)
    expect(nodeHash(baseResult.nodes, 'build'))
      .toBe(nodeHash(formattedResult.nodes, 'build'))
  })

  it('changes hash for annotation argument and function rename, while moved files stay stable', () => {
    const annV1 = "class M {\n  @JsonKey(name: 'id')\n  final String id;\n}"
    const annV2 = "class M {\n  @JsonKey(name: 'order_id')\n  final String id;\n}"
    const fnV1 = 'Future<void> loadOrders() async { return fetch(); }'
    const fnV2 = 'Future<void> fetchOrders() async { return fetch(); }'
    const moved = 'Future<void> loadOrders() async { return fetch(); }'

    expect(nodeHash(adapter.parseFile(annV1, 'lib/m.dart', 'r1').nodes, 'M.id'))
      .not.toBe(nodeHash(adapter.parseFile(annV2, 'lib/m.dart', 'r1').nodes, 'M.id'))
    expect(nodeHash(adapter.parseFile(fnV1, 'lib/a.dart', 'r1').nodes, 'loadOrders'))
      .not.toBe(nodeHash(adapter.parseFile(fnV2, 'lib/a.dart', 'r1').nodes, 'fetchOrders'))
    expect(nodeHash(adapter.parseFile(moved, 'lib/a.dart', 'r1').nodes, 'loadOrders'))
      .toBe(nodeHash(adapter.parseFile(moved, 'lib/b.dart', 'r1').nodes, 'loadOrders'))
  })

  it('includes class and field annotations in range and hash', () => {
    const classV1 = "@RoutePage(name: 'orders')\nclass OrderPage {}"
    const classV2 = "@RoutePage(name: 'adminOrders')\nclass OrderPage {}"
    const fieldV1 = "class M {\n  @JsonKey(name: 'id')\n  final String id;\n}"
    const result = adapter.parseFile(classV1, 'lib/order_page.dart', 'r1')
    const cls = result.nodes.find((n) => n.name === 'OrderPage')
    const field = adapter.parseFile(fieldV1, 'lib/m.dart', 'r1').nodes.find((n) => n.name === 'M.id')

    expect(cls?.line_start).toBe(1)
    expect(field?.line_start).toBe(2)
    expect(nodeHash(result.nodes, 'OrderPage'))
      .not.toBe(nodeHash(adapter.parseFile(classV2, 'lib/order_page.dart', 'r1').nodes, 'OrderPage'))
  })
})
