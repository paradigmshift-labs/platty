/**
 * advanced_riverpod — Provider 패턴 syntax-level
 * (semantic 추적은 P15-Full, 여기는 syntax 발화 회귀 안전망)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart advanced_riverpod', () => {
  it('RV-1 — Provider top-level variable + closure body calls', async () => {
    const r = await parse(`
      import 'package:flutter_riverpod/flutter_riverpod.dart' show Provider;
      import 'package:foo/repo.dart' show UserRepo;
      final userRepoProvider = Provider<UserRepo>((ref) => UserRepo());
    `)
    expect(r.nodes.some((n) => n.type === 'variable' && n.name === 'userRepoProvider')).toBe(true)
  })

  it('RV-2 — AsyncNotifierProvider with class', async () => {
    const r = await parse(`
      import 'package:flutter_riverpod/flutter_riverpod.dart' show AsyncNotifierProvider, AsyncNotifier;
      class CounterNotifier extends AsyncNotifier<int> {
        @override
        Future<int> build() async => 0;
        void inc() {}
      }
      final counterProvider = AsyncNotifierProvider<CounterNotifier, int>(CounterNotifier.new);
    `)
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'AsyncNotifier')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'inc')).toBe(true)
    expect(r.edges.some((e) =>
      e.relation === 'calls' &&
      e.source_id.endsWith(':counterProvider') &&
      e.target_symbol === 'CounterNotifier' &&
      e.chain_path === 'riverpod_provider',
    )).toBe(true)
  })

  it('RV-3 — ConsumerWidget extends + ref.watch chain', async () => {
    const r = await parse(`
      import 'package:flutter_riverpod/flutter_riverpod.dart' show ConsumerWidget, WidgetRef;
      class MyPage extends ConsumerWidget {
        @override
        Widget build(BuildContext context, WidgetRef ref) {
          ref.watch(myProvider);
          return Container();
        }
      }
    `)
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'ConsumerWidget')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'watch' && e.source_id.endsWith(':MyPage.build'))).toBe(true)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'myProvider' && e.chain_path === 'ref.watch()' && e.source_id.endsWith(':MyPage.build'))).toBe(true)
  })

  it('RV-4 — ref.read(provider.notifier).method() chain — syntax 발화', async () => {
    const r = await parse(`
      class S {
        void fn(ref) {
          ref.read(myProvider.notifier).update();
        }
      }
    `)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'read' && e.source_id.endsWith(':S.fn'))).toBe(true)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'myProvider' && e.chain_path === 'ref.read()' && e.source_id.endsWith(':S.fn'))).toBe(true)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'update')).toBe(true)
  })

  it('RV-5 — Family/AutoDispose modifier syntax', async () => {
    const r = await parse(`
      import 'package:flutter_riverpod/flutter_riverpod.dart' show Provider;
      final byIdProvider = Provider.family<int, int>((ref, id) => id);
    `)
    expect(r.nodes.some((n) => n.type === 'variable' && n.name === 'byIdProvider')).toBe(true)
  })

  it('RV-6 — ref method family provider arg is emitted separately', async () => {
    const r = await parse(`
      class S {
        void fn(ref) {
          ref.refresh(postsProvider(search: query).future);
          ref.invalidate(todoProvider(id));
        }
      }
    `)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'postsProvider' && e.chain_path === 'ref.refresh()')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'calls' && e.target_symbol === 'todoProvider' && e.chain_path === 'ref.invalidate()')).toBe(true)
  })
})
