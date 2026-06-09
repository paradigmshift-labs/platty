// JvmAstParserAdapter (P5) — first slice: create() + class/method/field/constructor via shared engine.
import { describe, it, expect, beforeAll } from 'vitest'
import { JvmAstParserAdapter } from '@/pipeline_modules/build_graph/adapters/jvm_ast.js'

let adapter: JvmAstParserAdapter
beforeAll(async () => {
  adapter = await JvmAstParserAdapter.create()
})

const JAVA = `package com.acme.orders;
import com.acme.orders.OrderService;
@RestController
@RequestMapping("/orders")
public class OrderController extends BaseController implements Audited {
  @Autowired
  private final OrderService orderService;
  public OrderController(OrderService orderService) { this.orderService = orderService; }
  @GetMapping("/{id}")
  public Order getOne(Long id) { return orderService.findById(id); }
}`

describe('JvmAstParserAdapter — Java declarations via shared engine (P5 slice 1)', () => {
  it('extracts class + method + field nodes + contains edges through the engine declaration walker', () => {
    const r = adapter.parseFile(JAVA, 'src/main/java/com/acme/orders/OrderController.java', 'r1')

    // class node
    const cls = r.nodes.find((n) => n.type === 'class' && n.name === 'OrderController')
    expect(cls, 'class node').toBeTruthy()

    // method node (fullName = Class.method, via engine processMethod hook)
    const method = r.nodes.find((n) => n.type === 'method' && n.name === 'OrderController.getOne')
    expect(method, 'method node').toBeTruthy()

    // field node (property)
    const field = r.nodes.find((n) => n.type === 'property' && n.name === 'OrderController.orderService')
    expect(field, 'property node').toBeTruthy()

    // class → method/field contains edges (engine buildContainsEdge: resolved, target_symbol = bare)
    const containsMethod = r.edges.find((e) => e.relation === 'contains' && e.target_symbol === 'getOne')
    expect(containsMethod?.resolve_status).toBe('resolved')
    const containsField = r.edges.find((e) => e.relation === 'contains' && e.target_symbol === 'orderService')
    expect(containsField, 'class→field contains').toBeTruthy()

    // constructor → DI params buffered (NestJS-style DI for Spring)
    const ctorParams = r.constructorParams.find((c) => c.className === 'OrderController')
    expect(ctorParams?.params).toContainEqual({ fieldName: 'orderService', typeName: 'OrderService' })

    // engine node-id convention
    expect(method!.id).toBe('r1:src/main/java/com/acme/orders/OrderController.java:OrderController.getOne')
  })

  it('extracts heritage (extends/implements) + annotations (decorates) through shared leaves', () => {
    const r = adapter.parseFile(JAVA, 'src/main/java/com/acme/orders/OrderController.java', 'r1')
    const decorates = r.edges.filter((e) => e.relation === 'decorates')
    // class-level annotations
    expect(decorates.some((e) => e.target_symbol === 'RestController')).toBe(true)
    expect(decorates.some((e) => e.target_symbol === 'RequestMapping' && e.first_arg === '/orders')).toBe(true)
    // method-level annotation (first_arg from annotation_argument_list string literal)
    expect(decorates.some((e) => e.target_symbol === 'GetMapping' && e.first_arg === '/{id}')).toBe(true)
    // field-level annotation
    expect(decorates.some((e) => e.target_symbol === 'Autowired')).toBe(true)
    // heritage
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'BaseController')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'implements' && e.target_symbol === 'Audited')).toBe(true)
  })

  it('extracts calls via the shared engine emitNormalizedCallEdge (JVM = first normalizeCallee consumer)', () => {
    const r = adapter.parseFile(JAVA, 'src/main/java/com/acme/orders/OrderController.java', 'r1')
    // getOne body: orderService.findById(id) → calls edge (member shape, symbol=findById)
    const call = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'findById')
    expect(call, 'orderService.findById calls edge').toBeTruthy()
    expect(call!.resolve_status).toBe('pending')
    // sourced from the method node (not the class/file)
    expect(call!.source_id).toBe('r1:src/main/java/com/acme/orders/OrderController.java:OrderController.getOne')
    // chain_path carries the receiver (member shape)
    expect(call!.chain_path).toBe('orderService')
  })

  it('this-rooted member call carries the full receiver chain (this.field.method → chain_path this.field)', () => {
    // build_relations anchors HTTP/DB receivers on this — previously chain_path was null (receiver dropped).
    const SRC = `package x;\nclass C {\n  private final RestTemplate rt;\n  Order fetch(Long id) { return this.rt.getForObject("u", Order.class); }\n}`
    const r = adapter.parseFile(SRC, 'src/main/java/x/C.java', 'r1')
    const call = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'getForObject')
    expect(call?.chain_path, 'this-member receiver chain regressed').toBe('this.rt')
    expect(call?.target_specifier, 'this-member full callee specifier').toBe('this.rt.getForObject')
  })

  it('extracts imports (file source) + populates importSymbolMap; enum node', () => {
    const r = adapter.parseFile(JAVA, 'src/main/java/com/acme/orders/OrderController.java', 'r1')
    const imp = r.edges.find((e) => e.relation === 'imports' && e.target_symbol === 'OrderService')
    expect(imp?.target_specifier).toBe('com.acme.orders.OrderService')
    expect(imp?.source_id).toBe('r1:src/main/java/com/acme/orders/OrderController.java') // file node

    const e = adapter.parseFile('package x;\npublic enum Status { OPEN, CLOSED }', 'src/main/java/x/Status.java', 'r1')
    expect(e.nodes.some((n) => n.type === 'enum' && n.name === 'Status')).toBe(true)
  })

  it('emits type_ref per TS contract: field (subtype null), method return (return_type), param (method_param)', () => {
    const SRC = `package x;
public class Svc {
  private final OrderRepo repo;
  private int count;
  public Order findOne(Long id, String[] tags) { return repo.get(id); }
  public void clear() {}
}`
    const r = adapter.parseFile(SRC, 'src/main/java/x/Svc.java', 'r1')
    const tr = r.edges.filter((e) => e.relation === 'type_ref')
    // field OrderRepo → type_ref subtype null; primitive `int` field skipped (TS skips primitives)
    expect(tr.some((e) => e.target_symbol === 'OrderRepo' && e.type_ref_subtype === null)).toBe(true)
    expect(tr.some((e) => e.target_symbol === 'count')).toBe(false)
    // return Order → return_type; void clear() skipped
    expect(tr.some((e) => e.target_symbol === 'Order' && e.type_ref_subtype === 'return_type')).toBe(true)
    // params: Long → method_param; String[] array element → String (method_param)
    expect(tr.some((e) => e.target_symbol === 'Long' && e.type_ref_subtype === 'method_param')).toBe(true)
    expect(tr.some((e) => e.target_symbol === 'String' && e.type_ref_subtype === 'method_param')).toBe(true)
    // no uses_type for return/param (TS uses type_ref for those; uses_type only for generic_arg)
    expect(r.edges.some((e) => e.relation === 'uses_type' && e.type_ref_subtype !== 'generic_arg')).toBe(false)
  })

  it('interface extends_interfaces → extends + generic args as uses_type(generic_arg)', () => {
    const SRC = `package x;\npublic interface OrderRepo extends JpaRepository<Order, Long> {}`
    const r = adapter.parseFile(SRC, 'src/main/java/x/OrderRepo.java', 'r1')
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'JpaRepository')).toBe(true)
    const ut = r.edges.filter((e) => e.relation === 'uses_type' && e.type_ref_subtype === 'generic_arg').map((e) => e.target_symbol).sort()
    expect(ut).toEqual(['Long', 'Order'])
  })

  it('annotation type (@interface) emitted as a node (TS-consistent: no file node anywhere)', () => {
    const SRC = `package x;\npublic @interface PublicApi { String value(); }`
    const r = adapter.parseFile(SRC, 'src/main/java/x/PublicApi.java', 'r1')
    expect(r.nodes.some((n) => n.type === 'interface' && n.name === 'PublicApi')).toBe(true)
    // adapter emits NO file node (F2 owns them; TS adapter emits 0)
    expect(r.nodes.some((n) => n.type === 'file')).toBe(false)
  })

  // ── Kotlin (same shared engine, Kotlin-specific hooks) ──
  const KT = `package com.x
import com.x.InvoiceRepository
@RestController
@RequestMapping("/inv")
class InvoiceController(private val repo: InvoiceRepository) {
  @GetMapping("/{id}")
  fun getOne(id: Long): Invoice = repo.findById(id)
}`

  it('Kotlin: class + primary-ctor property/DI + method via shared engine', () => {
    const r = adapter.parseFile(KT, 'src/main/kotlin/com/x/InvoiceController.kt', 'r1')
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'InvoiceController')).toBe(true)
    // primary-constructor `val repo` → property node + contains
    expect(r.nodes.some((n) => n.type === 'property' && n.name === 'InvoiceController.repo')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'contains' && e.target_symbol === 'repo')).toBe(true)
    // DI ctor param buffered
    expect(r.constructorParams.find((c) => c.className === 'InvoiceController')?.params)
      .toContainEqual({ fieldName: 'repo', typeName: 'InvoiceRepository' })
    // method node
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'InvoiceController.getOne')).toBe(true)
    // no file node (TS-consistent)
    expect(r.nodes.some((n) => n.type === 'file')).toBe(false)
  })

  it('Kotlin: annotations (decorates w/ args), type_ref contract, navigation call', () => {
    const r = adapter.parseFile(KT, 'src/main/kotlin/com/x/InvoiceController.kt', 'r1')
    const dec = r.edges.filter((e) => e.relation === 'decorates')
    expect(dec.some((e) => e.target_symbol === 'RestController')).toBe(true)
    expect(dec.some((e) => e.target_symbol === 'RequestMapping' && e.first_arg === '/inv')).toBe(true)
    expect(dec.some((e) => e.target_symbol === 'GetMapping' && e.first_arg === '/{id}')).toBe(true)
    const tr = r.edges.filter((e) => e.relation === 'type_ref')
    expect(tr.some((e) => e.target_symbol === 'InvoiceRepository' && e.type_ref_subtype === null)).toBe(true) // field
    expect(tr.some((e) => e.target_symbol === 'Invoice' && e.type_ref_subtype === 'return_type')).toBe(true)
    expect(tr.some((e) => e.target_symbol === 'Long' && e.type_ref_subtype === 'method_param')).toBe(true)
    // navigation_expression call repo.findById → member shape sourced from the method node
    const call = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'findById')
    expect(call?.chain_path).toBe('repo')
    expect(call?.source_id).toBe('r1:src/main/kotlin/com/x/InvoiceController.kt:InvoiceController.getOne')
  })

  it('Kotlin: interface delegation → extends + generic args as uses_type(generic_arg)', () => {
    const SRC = `package com.x\ninterface InvoiceRepository : JpaRepository<Invoice, Long>`
    const r = adapter.parseFile(SRC, 'src/main/kotlin/com/x/InvoiceRepository.kt', 'r1')
    expect(r.nodes.some((n) => n.type === 'interface' && n.name === 'InvoiceRepository')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'JpaRepository')).toBe(true)
    const ut = r.edges.filter((e) => e.relation === 'uses_type' && e.type_ref_subtype === 'generic_arg').map((e) => e.target_symbol).sort()
    expect(ut).toEqual(['Invoice', 'Long'])
  })
})
