import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { spring } from '@/pipeline_modules/build_route/adapters/spring.js'
import { TEST_REPO as REPO, n, e, loaded, resetEdgeId } from '../helpers/graph_builders.js'

function makeController(opts: { decorator?: 'RestController' | 'Controller'; path?: string | null; filePath?: string } = {}) {
  resetEdgeId()
  const filePath = opts.filePath ?? 'src/main/java/com/acme/UserController.java'
  const ctrl = n({ id: `${REPO}:${filePath}:UserController`, type: 'class', filePath, name: 'UserController' })
  const controllerDecor = e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: opts.decorator ?? 'RestController' })
  const requestMappingDecor = opts.path === null
    ? e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'RequestMapping' })
    : e({ sourceId: ctrl.id, relation: 'decorates', targetSymbol: 'RequestMapping', firstArg: opts.path ?? '/api/users' })
  return { ctrl, controllerDecor, requestMappingDecor }
}

function makeMethod(parentId: string, opts: { name?: string; decorator: string; firstArg?: string | null; filePath?: string }) {
  const filePath = opts.filePath ?? 'src/main/java/com/acme/UserController.java'
  const method = n({ id: `${parentId}.${opts.name ?? 'handle'}`, type: 'method', filePath, name: opts.name ?? 'handle' })
  const contains = e({ sourceId: parentId, targetId: method.id, relation: 'contains' })
  const decor = opts.firstArg === null
    ? e({ sourceId: method.id, relation: 'decorates', targetSymbol: opts.decorator })
    : e({ sourceId: method.id, relation: 'decorates', targetSymbol: opts.decorator, firstArg: opts.firstArg ?? null })
  return { method, contains, decor }
}

describe('Spring api_handler — MVC annotation controllers', () => {
  it('RestController + RequestMapping + GetMapping composes fullPath', async () => {
    const { ctrl, controllerDecor, requestMappingDecor } = makeController({ path: '/api/users' })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'GetMapping', firstArg: '/{id}', name: 'get' })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [controllerDecor, requestMappingDecor, contains, decor] })

    const r = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('GET')
    expect(r.entryPoints[0].fullPath).toBe('/api/users/:id')
    expect(r.entryPoints[0].handlerNodeId).toBe(method.id)
  })

  it('Controller + PostMapping works for Kotlin source graphs too', async () => {
    const filePath = 'src/main/kotlin/com/acme/UserController.kt'
    const { ctrl, controllerDecor, requestMappingDecor } = makeController({ decorator: 'Controller', path: 'users', filePath })
    const { method, contains, decor } = makeMethod(ctrl.id, { decorator: 'PostMapping', firstArg: '', name: 'create', filePath })
    const graph = createGraphIndex({ nodes: [ctrl, method], edges: [controllerDecor, requestMappingDecor, contains, decor] })

    const r = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].httpMethod).toBe('POST')
    expect(r.entryPoints[0].fullPath).toBe('/users')
  })

  it('method mapping outside a Spring controller is ignored', async () => {
    const filePath = 'src/main/java/com/acme/UserService.java'
    const service = n({ id: `${REPO}:${filePath}:UserService`, type: 'class', filePath, name: 'UserService' })
    const method = n({ id: `${service.id}.get`, type: 'method', filePath, name: 'get' })
    const contains = e({ sourceId: service.id, targetId: method.id, relation: 'contains' })
    const decor = e({ sourceId: method.id, relation: 'decorates', targetSymbol: 'GetMapping', firstArg: '/x' })
    const graph = createGraphIndex({ nodes: [service, method], edges: [contains, decor] })

    const r = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(0)
  })

  it('@Scheduled service methods emit job entrypoints', async () => {
    resetEdgeId()
    const filePath = 'src/main/java/com/acme/jobs/BillingJob.java'
    const jobClass = n({ id: `${REPO}:${filePath}:BillingJob`, type: 'class', filePath, name: 'BillingJob' })
    const job = n({ id: `${jobClass.id}.reconcile`, type: 'method', filePath, name: 'BillingJob.reconcile' })
    const contains = e({ sourceId: jobClass.id, targetId: job.id, relation: 'contains' })
    const decor = e({ sourceId: job.id, relation: 'decorates', targetSymbol: 'Scheduled', firstArg: '0 0 * * * *' })
    const graph = createGraphIndex({ nodes: [jobClass, job], edges: [contains, decor] })

    const r = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0]).toMatchObject({
      framework: 'spring',
      kind: 'job',
      handlerNodeId: job.id,
    })
  })

  it('@EventListener service methods emit event entrypoints', async () => {
    resetEdgeId()
    const filePath = 'src/main/java/com/acme/events/OrderListener.java'
    const listenerClass = n({ id: `${REPO}:${filePath}:OrderListener`, type: 'class', filePath, name: 'OrderListener' })
    const listener = n({ id: `${listenerClass.id}.onOrderPaid`, type: 'method', filePath, name: 'OrderListener.onOrderPaid' })
    const contains = e({ sourceId: listenerClass.id, targetId: listener.id, relation: 'contains' })
    const decor = e({ sourceId: listener.id, relation: 'decorates', targetSymbol: 'EventListener', firstArg: 'OrderPaidEvent' })
    const graph = createGraphIndex({ nodes: [listenerClass, listener], edges: [contains, decor] })

    const r = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0]).toMatchObject({
      framework: 'spring',
      kind: 'event',
      fullPath: 'OrderPaidEvent',
      handlerNodeId: listener.id,
    })
  })

  it('@MessageMapping and @SubscribeMapping methods emit event entrypoints', async () => {
    resetEdgeId()
    const filePath = 'src/main/java/com/acme/ws/ChatSocket.java'
    const socketClass = n({ id: `${REPO}:${filePath}:ChatSocket`, type: 'class', filePath, name: 'ChatSocket' })
    const send = n({ id: `${socketClass.id}.send`, type: 'method', filePath, name: 'ChatSocket.send' })
    const presence = n({ id: `${socketClass.id}.presence`, type: 'method', filePath, name: 'ChatSocket.presence' })
    const containsSend = e({ sourceId: socketClass.id, targetId: send.id, relation: 'contains' })
    const containsPresence = e({ sourceId: socketClass.id, targetId: presence.id, relation: 'contains' })
    const messageDecor = e({ sourceId: send.id, relation: 'decorates', targetSymbol: 'MessageMapping', firstArg: '/chat.send' })
    const subscribeDecor = e({ sourceId: presence.id, relation: 'decorates', targetSymbol: 'SubscribeMapping', firstArg: '/presence' })
    const graph = createGraphIndex({ nodes: [socketClass, send, presence], edges: [containsSend, containsPresence, messageDecor, subscribeDecor] })

    const r = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: REPO })

    expect(r.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        framework: 'spring',
        kind: 'event',
        fullPath: '/chat.send',
        handlerNodeId: send.id,
      }),
      expect.objectContaining({
        framework: 'spring',
        kind: 'event',
        fullPath: '/presence',
        handlerNodeId: presence.id,
      }),
    ]))
  })

  it('@ExceptionHandler advice methods emit event entrypoints', async () => {
    resetEdgeId()
    const filePath = 'src/main/java/com/acme/errors/ApiErrorAdvice.java'
    const adviceClass = n({ id: `${REPO}:${filePath}:ApiErrorAdvice`, type: 'class', filePath, name: 'ApiErrorAdvice' })
    const handler = n({ id: `${adviceClass.id}.handleIllegalArgument`, type: 'method', filePath, name: 'ApiErrorAdvice.handleIllegalArgument' })
    const contains = e({ sourceId: adviceClass.id, targetId: handler.id, relation: 'contains' })
    const decor = e({ sourceId: handler.id, relation: 'decorates', targetSymbol: 'ExceptionHandler', firstArg: 'IllegalArgumentException.class' })
    const graph = createGraphIndex({ nodes: [adviceClass, handler], edges: [contains, decor] })

    const r = await runRuleEngine({ adapters: [loaded(spring)], graph, repoId: REPO })

    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0]).toMatchObject({
      framework: 'spring',
      kind: 'event',
      fullPath: 'IllegalArgumentException.class',
      handlerNodeId: handler.id,
    })
  })
})
