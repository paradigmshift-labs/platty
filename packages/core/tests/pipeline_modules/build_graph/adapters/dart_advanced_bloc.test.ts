/**
 * advanced_bloc — Bloc/Cubit 패턴
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart advanced_bloc', () => {
  it('BL-1 — Cubit extends + emit chain', async () => {
    const r = await parse(`
      import 'package:bloc/bloc.dart' show Cubit;
      class CounterCubit extends Cubit<int> {
        CounterCubit() : super(0);
        void inc() => emit(state + 1);
      }
    `)
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'Cubit')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'inc')).toBe(true)
  })

  it('BL-2 — Bloc with on<Event> handler', async () => {
    const r = await parse(`
      import 'package:bloc/bloc.dart' show Bloc;
      class CounterBloc extends Bloc<dynamic, int> {
        CounterBloc() : super(0) {
          on<Object>((event, emit) => emit(state + 1));
        }
      }
    `)
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'Bloc')).toBe(true)
  })

  it('BL-3 — abstract state class hierarchy', async () => {
    const r = await parse(`
      abstract class CounterState {}
      class CounterInitial extends CounterState {}
      class CounterValue extends CounterState {
        final int count;
        CounterValue(this.count);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'CounterInitial')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'CounterValue')).toBe(true)
  })
})
