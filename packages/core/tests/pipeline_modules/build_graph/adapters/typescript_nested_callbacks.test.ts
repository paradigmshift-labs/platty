import { describe, expect, it } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import type { CodeEdgeRaw, CodeNodeRaw } from '@/pipeline_modules/build_graph/types.js'

function parse(content: string, filePath = 'src/sample.tsx') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

function findNode(nodes: CodeNodeRaw[], name: string): CodeNodeRaw {
  const node = nodes.find((n) => n.name === name)
  expect(node).toBeDefined()
  return node!
}

function findCallback(nodes: CodeNodeRaw[], role: string): CodeNodeRaw {
  const node = nodes.find(
    (n) => n.type === 'function' && n.origin_kind === 'callback' && n.role === role,
  )
  expect(node).toBeDefined()
  return node!
}

function expectOwnedCall(
  edges: CodeEdgeRaw[],
  sourceId: string,
  targetSymbol: string,
): CodeEdgeRaw {
  const edge = edges.find(
    (e) => e.relation === 'calls' && e.source_id === sourceId && e.target_symbol === targetSymbol,
  )
  expect(edge).toBeDefined()
  return edge!
}

function expectContains(edges: CodeEdgeRaw[], parentId: string, child: CodeNodeRaw): void {
  expect(edges).toContainEqual(expect.objectContaining({
    source_id: parentId,
    target_id: child.id,
    relation: 'contains',
  }))
}

describe('TypeScript nested callback graph nodes', () => {
  it('emits a queryFn callback node and sources repository calls from it', () => {
    const r = parse(`
      import { useQuery } from '@tanstack/react-query'
      import { auth } from './auth'

      export function ProfilePage() {
        return useQuery({
          queryKey: ['profile'],
          queryFn: () => auth.getMyProfile(),
        })
      }
    `)

    const parent = findNode(r.nodes, 'ProfilePage')
    const callback = findCallback(r.nodes, 'queryFn')

    expect(callback).toMatchObject({
      parent_node_id: parent.id,
      exported: false,
      is_async: false,
    })
    expectContains(r.edges, parent.id, callback)
    expectOwnedCall(r.edges, callback.id, 'getMyProfile')
    expect(r.edges.find((e) => e.relation === 'calls' && e.source_id === parent.id && e.target_symbol === 'getMyProfile')).toBeUndefined()
  })

  it('uses deterministic callback roles for React effects, JSX events, array callbacks, transactions, and routes', () => {
    const r = parse(`
      import { useEffect } from 'react'
      import { navigate } from './router'

      export function OrdersPage({ api, items, repo, service, auth, router, prisma }: any) {
        useEffect(() => api.refresh(), [])
        const buttons = <button onClick={() => navigate('/orders')}>Orders</button>
        items.map((item: any) => repo.load(item.id))
        prisma.$transaction(async (tx: any) => tx.order.deleteMany())
        router.get('/orders', async (req: any, res: any) => service.list())
        router.get('/secure-orders', auth, async (req: any, res: any) => service.list())
        return buttons
      }
    `)

    const parent = findNode(r.nodes, 'OrdersPage')
    const expected = [
      ['useEffectCallback', 'refresh'],
      ['onClick', 'navigate'],
      ['mapCallback', 'load'],
      ['transactionCallback', 'deleteMany'],
    ] as const

    for (const [role, call] of expected) {
      const callback = findCallback(r.nodes, role)
      expect(callback.parent_node_id).toBe(parent.id)
      expectContains(r.edges, parent.id, callback)
      expectOwnedCall(r.edges, callback.id, call)
    }

    const routeHandlers = r.nodes.filter(
      (n) => n.type === 'function' && n.origin_kind === 'callback' && n.role === 'routeHandler',
    )
    expect(routeHandlers).toHaveLength(2)
    expect(new Set(routeHandlers.map((n) => n.id)).size).toBe(routeHandlers.length)
    for (const handler of routeHandlers) {
      expect(handler.parent_node_id).toBe(parent.id)
      expectContains(r.edges, parent.id, handler)
      expectOwnedCall(r.edges, handler.id, 'list')
    }
  })

  it('emits nested function declaration nodes and sources calls from the nested function', () => {
    const r = parse(`
      export function handler() {
        function load() {
          return repo.load()
        }
        return load()
      }
    `)

    const parent = findNode(r.nodes, 'handler')
    const nested = r.nodes.find(
      (n) => n.type === 'function' && n.origin_kind === 'nested_function' && n.role === 'nestedFunction' && n.name.includes('load'),
    )

    expect(nested).toBeDefined()
    expect(nested!.parent_node_id).toBe(parent.id)
    expectContains(r.edges, parent.id, nested!)
    expectOwnedCall(r.edges, nested!.id, 'load')
    expectOwnedCall(r.edges, parent.id, 'load')
  })

  it('keeps callback ids deterministic and does not add object repository method nodes', () => {
    const content = `
      export function Page({ items, repo }: any) {
        items.map((item: any) => repo.load(item.id))
        items.filter((item: any) => repo.visible(item.id))
        return null
      }

      export const repository = {
        async find() {
          return repo.find()
        },
      }
    `
    const first = parse(content)
    const second = parse(content)

    const firstCallbackIds = first.nodes
      .filter((n) => n.origin_kind === 'callback')
      .map((n) => n.id)
      .sort()
    const secondCallbackIds = second.nodes
      .filter((n) => n.origin_kind === 'callback')
      .map((n) => n.id)
      .sort()

    expect(firstCallbackIds).toEqual(secondCallbackIds)
    expect(new Set(firstCallbackIds).size).toBe(firstCallbackIds.length)
    expect(firstCallbackIds.every((id) => /Page:(mapCallback|filterCallback):\d+:\d+$/.test(id))).toBe(true)

    const repositoryNodes = first.nodes.filter((n) => n.name.startsWith('repository'))
    expect(repositoryNodes).toHaveLength(1)
    expect(repositoryNodes[0].type).toBe('variable')
  })

  it('does not create a file-level duplicate callback for wrapped function initializers', () => {
    const r = parse(`
      const createPost = asyncHandler(async (req: any) => {
        return service.create(req.body)
      })
    `)

    const callbacks = r.nodes.filter((n) => n.origin_kind === 'callback')
    expect(callbacks).toHaveLength(0)

    const createPost = findNode(r.nodes, 'createPost')
    expectOwnedCall(r.edges, createPost.id, 'create')
    expect(r.edges.find((e) => e.relation === 'calls' && e.source_id === 'r1:src/sample.tsx' && e.target_symbol === 'create')).toBeUndefined()
  })

  it('uses the nearest semantic owner for callbacks nested inside queryFn bodies', () => {
    const r = parse(`
      import { useQuery } from '@tanstack/react-query'

      export function Page({ items, repo }: any) {
        return useQuery({
          queryKey: ['items'],
          queryFn: () => items.map((item: any) => repo.load(item.id)),
        })
      }
    `)

    const queryFn = findCallback(r.nodes, 'queryFn')
    const mapCallback = findCallback(r.nodes, 'mapCallback')

    expect(queryFn.name).toBe('Page.callback@7')
    expect(mapCallback.name).toBe('Page.callback@7.callback@7')
    expect(mapCallback.parent_node_id).toBe(queryFn.id)
    expectContains(r.edges, queryFn.id, mapCallback)
    expectOwnedCall(r.edges, mapCallback.id, 'load')
  })

  it('uses collection callback role inside JSX event callback bodies', () => {
    const r = parse(`
      export function Page({ items, repo }: any) {
        return <button onClick={() => items.map((item: any) => repo.load(item.id))}>Load</button>
      }
    `)

    const page = findNode(r.nodes, 'Page')
    const onClickCallbacks = r.nodes.filter(
      (n) => n.type === 'function' && n.origin_kind === 'callback' && n.role === 'onClick',
    )
    expect(onClickCallbacks).toHaveLength(1)

    const onClick = onClickCallbacks[0]
    const mapCallback = findCallback(r.nodes, 'mapCallback')

    expect(onClick.parent_node_id).toBe(page.id)
    expect(mapCallback.parent_node_id).toBe(onClick.id)
    expectContains(r.edges, page.id, onClick)
    expectContains(r.edges, onClick.id, mapCallback)
    expectOwnedCall(r.edges, mapCallback.id, 'load')
  })

  it('does not classify non-route get callbacks as route handlers', () => {
    const r = parse(`
      export function loadCached(cache: any, service: any) {
        return cache.get('user', () => service.load())
      }
    `)

    const routeCallbacks = r.nodes.filter(
      (n) => n.origin_kind === 'callback' && (n.role === 'routeHandler' || n.role === 'middleware'),
    )
    expect(routeCallbacks).toHaveLength(0)

    const callback = findCallback(r.nodes, 'callback')
    expect(callback.parent_node_id).toBe('r1:src/sample.tsx:loadCached')
    expectOwnedCall(r.edges, callback.id, 'load')
  })

  it('classifies path-mounted Express use callbacks as middleware', () => {
    const r = parse(`
      export function mount(app: any, service: any) {
        app.use('/admin', (req: any, res: any, next: any) => service.load())
      }
    `)

    const middleware = findCallback(r.nodes, 'middleware')
    expect(middleware.parent_node_id).toBe('r1:src/sample.tsx:mount')
    expectOwnedCall(r.edges, middleware.id, 'load')
  })

  it('sources array find callbacks from the containing class method', () => {
    const r = parse(`
      export class UsersService {
        private readonly users = [{ username: 'john' }]

        async findOne(username: string) {
          return this.users.find((user) => user.username === username)
        }
      }
    `, 'src/users/users.service.ts')

    const method = findNode(r.nodes, 'UsersService.findOne')
    const callback = findCallback(r.nodes, 'findCallback')

    expect(callback.name).toBe('UsersService.findOne.callback@6')
    expect(callback.parent_node_id).toBe(method.id)
    expectContains(r.edges, method.id, callback)
  })

  it('sources returned function expressions from the containing function', () => {
    const r = parse(`
      export function format(path: string) {
        const obj = require(path)
        return function(req: any, res: any) {
          res.format(obj)
        }
      }
    `, 'src/format.ts')

    const parent = findNode(r.nodes, 'format')
    const callback = findCallback(r.nodes, 'returnedFunction')

    expect(callback.name).toBe('format.callback@4')
    expect(callback.parent_node_id).toBe(parent.id)
    expectContains(r.edges, parent.id, callback)
    expectOwnedCall(r.edges, callback.id, 'format')
  })

  it('emits a callback node for a function passed to a constructor and sources nested callback calls', () => {
    const r = parse(`
      export class MetricsService {
        setup(list: any, observe: any) {
          const obs = new ResourceObserver((entries: any) => {
            entries.getRecords().forEach((entry: any) => {
              observe(entry.value)
            })
          })
          return obs
        }
      }
    `, 'src/metrics.service.ts')

    const method = findNode(r.nodes, 'MetricsService.setup')
    const ctorCallback = findNode(r.nodes, 'MetricsService.setup.callback@4')
    const forEachCallback = findCallback(r.nodes, 'forEachCallback')

    // The constructor-argument function becomes its own callback node owned by the method.
    expect(ctorCallback.type).toBe('function')
    expect(ctorCallback.origin_kind).toBe('callback')
    expect(ctorCallback.role).toBe('callback')
    expect(ctorCallback.parent_node_id).toBe(method.id)
    expectContains(r.edges, method.id, ctorCallback)

    // The nested forEach callback is owned by the constructor callback, not the method.
    expect(forEachCallback.parent_node_id).toBe(ctorCallback.id)
    expectContains(r.edges, ctorCallback.id, forEachCallback)

    // Body calls are sourced from their nearest owner, not bubbled up to the method.
    expectOwnedCall(r.edges, ctorCallback.id, 'forEach')
    expectOwnedCall(r.edges, forEachCallback.id, 'observe')
    expect(
      r.edges.find(
        (e) => e.relation === 'calls' && e.source_id === method.id && e.target_symbol === 'observe',
      ),
    ).toBeUndefined()
  })

  it.skip('sources the concise-body arrow returned by a curried arrow from the outer function', () => {
    const r = parse(`
      export const errorMiddleware = (): ErrorRequestHandler => (unknownError: any, req: any, res: any, next: any) => {
        const err = handleError(unknownError)
        res.status(err.httpStatusCode).send(err)
      }
    `, 'src/error.middleware.ts')

    const parent = findNode(r.nodes, 'errorMiddleware')
    const callback = findCallback(r.nodes, 'returnedFunction')

    // The inner arrow is the concise (expression) body of the outer arrow — a
    // reachable returned function, owned by the variable's function node.
    expect(callback.name).toBe('errorMiddleware.callback@2')
    expect(callback.parent_node_id).toBe(parent.id)
    expectContains(r.edges, parent.id, callback)
    expectOwnedCall(r.edges, callback.id, 'handleError')
    expect(
      r.edges.find(
        (e) => e.relation === 'calls' && e.source_id === parent.id && e.target_symbol === 'handleError',
      ),
    ).toBeUndefined()
  })

  it('emits a callback node for an arrow property of an object passed to a constructor argument', () => {
    const r = parse(`
      export function initServer(schema: any) {
        return new ApolloServer({
          schema,
          formatError: (gqlFormattedError: any, error: any) => {
            return handleError(error)
          },
        })
      }
    `, 'src/graphql/index.ts')

    const parent = findNode(r.nodes, 'initServer')
    const callback = findCallback(r.nodes, 'callback')

    // The object literal is the argument of `new ApolloServer(...)` — the arrow
    // property is a reachable callback owned by the enclosing function.
    expect(callback.name).toBe('initServer.callback@5')
    expect(callback.parent_node_id).toBe(parent.id)
    expectContains(r.edges, parent.id, callback)
    expectOwnedCall(r.edges, callback.id, 'handleError')
    expect(
      r.edges.find(
        (e) => e.relation === 'calls' && e.source_id === parent.id && e.target_symbol === 'handleError',
      ),
    ).toBeUndefined()
  })

  it('emits a callback node for an arrow property of a returned object literal', () => {
    const r = parse(`
      export function createDummyPubSub(pubsub: any) {
        return {
          asyncIterator: (triggers: any) => pubsub.asyncIterator(triggers),
        }
      }
    `, 'src/pubsub/index.ts')

    const parent = findNode(r.nodes, 'createDummyPubSub')
    const callback = findCallback(r.nodes, 'callback')

    // The object literal is the value of a return statement — the arrow property
    // is a reachable callback owned by the enclosing function.
    expect(callback.name).toBe('createDummyPubSub.callback@4')
    expect(callback.parent_node_id).toBe(parent.id)
    expectContains(r.edges, parent.id, callback)
    expectOwnedCall(r.edges, callback.id, 'asyncIterator')
    expect(
      r.edges.find(
        (e) => e.relation === 'calls' && e.source_id === parent.id && e.target_symbol === 'asyncIterator',
      ),
    ).toBeUndefined()
  })

  it('sources a calls edge to the enclosing class for a this-rooted chained call invocation', () => {
    // `this.href(req)()` — the outer `()` invokes the function returned by
    // `this.href(req)`. The callee is a `call_expression` whose chain roots at
    // `this`, so a language service resolves the receiver to the enclosing class.
    // build_graph must mirror that: emit a calls edge to the class node.
    const r = parse(`
      class PaginationMiddleware {
        private getArrayPages(req: any) {
          return (limit: number) => {
            return this.href(req)().replace('a', 'b');
          };
        }
        private href(req: any) { return () => ''; }
      }
    `, 'src/pagination.middleware.ts')

    const cls = findNode(r.nodes, 'PaginationMiddleware')
    const callback = findNode(r.nodes, 'PaginationMiddleware.getArrayPages.callback@4')

    const edge = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.source_id === callback.id &&
        e.target_id === cls.id &&
        e.target_symbol === 'PaginationMiddleware',
    )
    expect(edge).toBeDefined()
    expect(edge!.resolve_status).toBe('resolved')
  })

  it('sources a calls edge to the enclosing class for a this-rooted computed-member call', () => {
    // `this.logger[level](msg)` — the callee is a `subscript_expression` whose
    // receiver chain roots at `this`. A language service resolves `this` to the
    // enclosing class, so build_graph must emit a calls edge to the class node
    // (otherwise the method's only call site is dropped entirely).
    const r = parse(`
      class Logger {
        private logger: any;
        log(level: 'info' | 'error', msg: string, metadata?: any) {
          this.logger[level](msg, metadata);
        }
      }
    `, 'src/logger.helper.ts')

    const cls = findNode(r.nodes, 'Logger')
    const method = findNode(r.nodes, 'Logger.log')

    const edge = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.source_id === method.id &&
        e.target_id === cls.id &&
        e.target_symbol === 'Logger',
    )
    expect(edge).toBeDefined()
    expect(edge!.resolve_status).toBe('resolved')
  })

  it('uses the bare method name as target_symbol for the inverse calls edge from a callback to its parent method', () => {
    // A class method that returns a callback (Express asyncHandler shape). The
    // callback gets an inverse-of-contains `calls` edge to its enclosing method
    // so downstream reachability (build_docs traverseCallEdges, which inner-joins
    // on target_id IS NOT NULL) keeps the parent's context. target_symbol must be
    // the callee's bare symbol (`handler`) — matching how every other resolved
    // calls edge stores the symbol — not the qualified owner.method name.
    const r = parse(`
      class AsyncHandler {
        static handler(theFunc: any) {
          return (req: any, res: any, next: any) => {
            Promise.resolve(theFunc(req, res, next)).catch(next)
          }
        }
      }
    `, 'src/async-handler.middleware.ts')

    const method = findNode(r.nodes, 'AsyncHandler.handler')
    const callback = findNode(r.nodes, 'AsyncHandler.handler.callback@4')

    const edge = r.edges.find(
      (e) =>
        e.relation === 'calls' &&
        e.source_id === callback.id &&
        e.target_id === method.id,
    )
    expect(edge).toBeDefined()
    expect(edge!.resolve_status).toBe('resolved')
    // bare last segment, not the qualified `AsyncHandler.handler`
    expect(edge!.target_symbol).toBe('handler')
  })

  it('emits a nested node for a function expression assigned to a property and sources its body calls', () => {
    const r = parse(`
      export function wrap(descriptorFn: any) {
        return function (descriptor: any) {
          descriptor.value = async function (...args: any[]) {
            descriptorFn(args)
            return descriptor.original.apply(this, args)
          }
          return descriptor
        }
      }
    `, 'src/wrap.ts')

    const wrap = findNode(r.nodes, 'wrap')
    const outer = findNode(r.nodes, 'wrap.callback@3')
    const assigned = findNode(r.nodes, 'wrap.callback@3.callback@4')

    // The RHS function expression becomes its own nested node owned by the outer callback.
    expect(assigned.type).toBe('function')
    expect(assigned.origin_kind).toBe('callback')
    expect(assigned.parent_node_id).toBe(outer.id)
    expectContains(r.edges, outer.id, assigned)

    // Its body calls are sourced from the assigned function, not the outer callback.
    expectOwnedCall(r.edges, assigned.id, 'descriptorFn')
    expectOwnedCall(r.edges, assigned.id, 'apply')
    expect(
      r.edges.find(
        (e) => e.relation === 'calls' && e.source_id === outer.id && e.target_symbol === 'descriptorFn',
      ),
    ).toBeUndefined()

    // wrap (file-level) should not absorb the inner calls either.
    expect(
      r.edges.find(
        (e) => e.relation === 'calls' && e.source_id === wrap.id && e.target_symbol === 'descriptorFn',
      ),
    ).toBeUndefined()
  })
})
