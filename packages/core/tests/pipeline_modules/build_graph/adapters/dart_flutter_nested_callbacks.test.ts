import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import type { CodeEdgeRaw, CodeNodeRaw } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/checkout.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function nodeByName(nodes: CodeNodeRaw[], name: string) {
  return nodes.find((node) => node.name === name)
}

function callbackByRole(nodes: CodeNodeRaw[], role: string) {
  return nodes.find((node) =>
    node.type === 'function' &&
    node.origin_kind === 'callback' &&
    node.role === role
  )
}

function callbacksByRole(nodes: CodeNodeRaw[], role: string) {
  return nodes.filter((node) =>
    node.type === 'function' &&
    node.origin_kind === 'callback' &&
    node.role === role
  )
}

function contains(edges: CodeEdgeRaw[], sourceId: string, targetId: string) {
  return edges.find((edge) =>
    edge.relation === 'contains' &&
    edge.source_id === sourceId &&
    edge.target_id === targetId
  )
}

function callFrom(edges: CodeEdgeRaw[], sourceId: string, targetSymbol: string) {
  return edges.find((edge) =>
    edge.relation === 'calls' &&
    edge.source_id === sourceId &&
    edge.target_symbol === targetSymbol
  )
}

describe('Dart Flutter nested callback graph nodes', () => {
  it('preserves StatefulWidget State methods while sourcing onPressed calls from a callback node', async () => {
    const r = await parse(`
      import 'package:flutter/material.dart';

      class CheckoutPage extends StatefulWidget {
        const CheckoutPage({super.key});
        @override
        State<CheckoutPage> createState() => _CheckoutPageState();
      }

      class _CheckoutPageState extends State<CheckoutPage> {
        final CheckoutCubit controller;
        _CheckoutPageState(this.controller);

        @override
        void initState() {
          super.initState();
        }

        @override
        Widget build(BuildContext context) {
          return ElevatedButton(
            onPressed: () async {
              await controller.submit();
              Navigator.of(context).pushNamed('/done');
            },
            child: const Text('Done'),
          );
        }
      }

      class CheckoutCubit extends Cubit<CheckoutState> {
        final CheckoutRepo repo;
        CheckoutCubit(this.repo) : super(CheckoutState.idle());

        Future<void> submit() async {
          await repo.submit();
          emit(CheckoutState.done());
        }
      }

      class CheckoutState {
        final String status;
        const CheckoutState(this.status);
        factory CheckoutState.idle() => const CheckoutState('idle');
        factory CheckoutState.done() => const CheckoutState('done');
      }

      class CheckoutRepo {
        Future<void> submit() async {}
      }
    `)

    const stateClassName = '_CheckoutPageState'
    const stateClass = nodeByName(r.nodes, stateClassName)
    const initState = nodeByName(r.nodes, 'initState')
    const build = nodeByName(r.nodes, 'build')
    const cubitSubmit = r.nodes.find((node) =>
      node.type === 'method' &&
      node.name === 'submit' &&
      node.id.endsWith(':CheckoutCubit.submit')
    )
    expect(stateClass).toMatchObject({ type: 'class', name: stateClassName })
    expect(initState).toMatchObject({
      type: 'method',
      parent_node_id: stateClass!.id,
      origin_kind: 'class_member',
      role: 'initState',
    })
    expect(build).toMatchObject({
      type: 'method',
      parent_node_id: stateClass!.id,
      origin_kind: 'class_member',
      role: 'build',
    })
    expect(cubitSubmit).toMatchObject({
      type: 'method',
      parent_node_id: nodeByName(r.nodes, 'CheckoutCubit')!.id,
      origin_kind: 'class_member',
      role: 'submit',
    })

    const onPressed = callbackByRole(r.nodes, 'onPressed')
    expect(onPressed).toMatchObject({
      type: 'function',
      parent_node_id: build!.id,
      origin_kind: 'callback',
      role: 'onPressed',
      is_async: true,
    })
    expect(contains(r.edges, build!.id, onPressed!.id)).toBeDefined()
    expect(callFrom(r.edges, onPressed!.id, 'submit')).toBeDefined()
    expect(callFrom(r.edges, onPressed!.id, 'of')).toBeDefined()
    expect(callFrom(r.edges, onPressed!.id, 'pushNamed')).toBeDefined()
    expect(callFrom(r.edges, build!.id, 'submit')).toBeUndefined()
    expect(callFrom(r.edges, build!.id, 'pushNamed')).toBeUndefined()

    const modelCallbackNodes = r.nodes.filter((node) =>
      node.origin_kind === 'callback' &&
      node.parent_node_id === nodeByName(r.nodes, 'CheckoutState')?.id
    )
    expect(modelCallbackNodes).toHaveLength(0)
  })

  it('creates semantic callback roles for Dart collections and Flutter builder/listener arguments', async () => {
    const r = await parse(`
      import 'package:flutter/widgets.dart';
      import 'package:flutter_bloc/flutter_bloc.dart';

      class CheckoutList extends StatelessWidget {
        final CheckoutRepository repository;
        final AnalyticsService service;
        final List<Item> items;
        const CheckoutList(this.repository, this.service, this.items, {super.key});

        @override
        Widget build(BuildContext context) {
          final loaded = items.map((item) => repository.load(item.id)).toList();
          return BlocConsumer<CheckoutCubit, CheckoutState>(
            listener: (context, state) {
              service.track();
            },
            builder: (context, state) => const SizedBox(),
          );
        }
      }
    `, 'lib/checkout_list.dart')

    const build = nodeByName(r.nodes, 'build')
    const mapCallback = callbackByRole(r.nodes, 'mapCallback')
    const listener = callbackByRole(r.nodes, 'listener')
    const builder = callbackByRole(r.nodes, 'builder')
    const loaded = nodeByName(r.nodes, 'loaded')

    expect(mapCallback).toMatchObject({
      parent_node_id: loaded!.id,
      origin_kind: 'callback',
      role: 'mapCallback',
    })
    expect(listener).toMatchObject({
      parent_node_id: build!.id,
      origin_kind: 'callback',
      role: 'listener',
    })
    expect(builder).toMatchObject({
      parent_node_id: build!.id,
      origin_kind: 'callback',
      role: 'builder',
    })
    expect(callFrom(r.edges, mapCallback!.id, 'load')).toBeDefined()
    expect(callFrom(r.edges, listener!.id, 'track')).toBeDefined()
    expect(contains(r.edges, loaded!.id, mapCallback.id)).toBeDefined()
    expect(contains(r.edges, build!.id, listener.id)).toBeDefined()
    expect(contains(r.edges, build!.id, builder!.id)).toBeDefined()

    const loadCalls = r.edges.filter((edge) =>
      edge.relation === 'calls' &&
      edge.target_symbol === 'load'
    )
    const mapCallbacksAtSameRange = r.nodes.filter((node) =>
      node.type === 'function' &&
      node.origin_kind === 'callback' &&
      node.line_start === mapCallback.line_start &&
      node.line_end === mapCallback.line_end
    )
    expect(mapCallbacksAtSameRange).toHaveLength(1)
    expect(loadCalls).toHaveLength(1)
    expect(loadCalls[0]!.source_id).toBe(mapCallback.id)
  })

  it('keeps nested collection callbacks under their own semantic role inside Flutter callbacks', async () => {
    const r = await parse(`
      import 'package:flutter/widgets.dart';

      class CheckoutActions extends StatelessWidget {
        final List<Item> items;
        final CheckoutRepository repository;
        const CheckoutActions(this.items, this.repository, {super.key});

        @override
        Widget build(BuildContext context) {
          return Button(
            onPressed: () {
              items.map((item) => repository.load(item.id)).toList();
            },
          );
        }
      }
    `, 'lib/checkout_actions.dart')

    const build = nodeByName(r.nodes, 'build')
    const onPressed = callbackByRole(r.nodes, 'onPressed')
    const mapCallback = callbackByRole(r.nodes, 'mapCallback')
    expect(callbacksByRole(r.nodes, 'onPressed')).toHaveLength(1)
    expect(callbacksByRole(r.nodes, 'mapCallback')).toHaveLength(1)
    expect(onPressed).toMatchObject({
      parent_node_id: build!.id,
      origin_kind: 'callback',
      role: 'onPressed',
    })
    expect(mapCallback).toMatchObject({
      parent_node_id: onPressed!.id,
      origin_kind: 'callback',
      role: 'mapCallback',
    })

    const callbacksAtMapRange = r.nodes.filter((node) =>
      node.type === 'function' &&
      node.origin_kind === 'callback' &&
      node.line_start === mapCallback!.line_start &&
      node.line_end === mapCallback!.line_end
    )
    const loadCalls = r.edges.filter((edge) =>
      edge.relation === 'calls' &&
      edge.target_symbol === 'load'
    )
    expect(callbacksAtMapRange).toHaveLength(1)
    expect(loadCalls).toHaveLength(1)
    expect(loadCalls[0]!.source_id).toBe(mapCallback!.id)
  })

  it('uses deterministic callback ids and does not duplicate closure nodes for the same source range', async () => {
    const source = `
      class S {
        void build(controller) {
          Button(onPressed: () => controller.submit());
        }
      }
    `
    const first = await parse(source, 'lib/stable.dart')
    const second = await parse(source, 'lib/stable.dart')

    const firstCallbackIds = first.nodes
      .filter((node) => node.origin_kind === 'callback')
      .map((node) => node.id)
      .sort()
    const secondCallbackIds = second.nodes
      .filter((node) => node.origin_kind === 'callback')
      .map((node) => node.id)
      .sort()

    expect(firstCallbackIds).toEqual(secondCallbackIds)
    expect(firstCallbackIds).toHaveLength(new Set(firstCallbackIds).size)
    expect(firstCallbackIds).toHaveLength(1)
  })
})
