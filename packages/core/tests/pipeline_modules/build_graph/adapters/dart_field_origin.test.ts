/**
 * D3: Dart 어댑터 fieldOriginsMap 발화 (P15-Lite 패턴 포팅)
 *
 * field origin 추론:
 * - type annotation 우선 (final UserService svc → internal/external by import)
 * - RHS 분석:
 *   - new ClassName() → resolveTypeOrigin
 *   - X.Y member access → reference (cross-file lookup)
 *   - call_expression chain root → unwrap
 * - this.X self chain lookup (같은 class field origin)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function getOrigin(parseResult: any, className: string, fieldName: string) {
  const fieldOrigins = parseResult.fieldOrigins as
    | Map<string, Map<string, { kind: string; typeName?: string }>>
    | undefined
  if (!fieldOrigins) return undefined
  for (const [classKey, fields] of fieldOrigins) {
    if (classKey.endsWith(`:${className}`) || classKey === className) {
      return fields.get(fieldName)
    }
  }
  return undefined
}

describe('D3: field origin 추출 (Dart)', () => {
  it('A1 — type annotation 외부 import → external', async () => {
    const r = await parse(`
      import 'package:dio/dio.dart' show Dio;
      class Repo {
        final Dio dio;
        Repo(this.dio);
      }
    `)
    expect(getOrigin(r, 'Repo', 'dio')).toEqual({ kind: 'external' })
  })

  it('A2 — type annotation 같은 file class → internal', async () => {
    const r = await parse(`
      class CacheWrapper {}
      class Owner {
        final CacheWrapper cache;
        Owner(this.cache);
      }
    `)
    expect(getOrigin(r, 'Owner', 'cache')).toEqual({ kind: 'internal', typeName: 'CacheWrapper' })
  })

  it('A3 — primitive type field (int count = 0) → primitive', async () => {
    const r = await parse(`
      class Repo {
        int count = 0;
      }
    `)
    expect(getOrigin(r, 'Repo', 'count')).toEqual({ kind: 'primitive' })
  })

  it('A4 — RHS new InternalClass() → internal', async () => {
    const r = await parse(`
      class CacheWrapper {}
      class Owner {
        final cache = CacheWrapper();
      }
    `)
    expect(getOrigin(r, 'Owner', 'cache')).toEqual({ kind: 'internal', typeName: 'CacheWrapper' })
  })

  it('A5 — RHS new ImportedClass() → external', async () => {
    const r = await parse(`
      import 'package:dio/dio.dart' show Dio;
      class Repo {
        final dio = Dio();
      }
    `)
    expect(getOrigin(r, 'Repo', 'dio')).toEqual({ kind: 'external' })
  })

  it('A6 — RHS X.Y member access → reference', async () => {
    const r = await parse(`
      import 'src/global.dart' show SGlobal;
      class Repo {
        final prisma = SGlobal.prismaPrimary;
      }
    `)
    expect(getOrigin(r, 'Repo', 'prisma')).toEqual({
      kind: 'reference', rootName: 'SGlobal', memberName: 'prismaPrimary',
    })
  })

  it('A7 — arrow fn field (Function) → function', async () => {
    const r = await parse(`
      class Svc {
        Future<int> Function() compute = () async => 1;
      }
    `)
    expect(getOrigin(r, 'Svc', 'compute')).toEqual({ kind: 'function' })
  })

  it('A8 — RHS literal (string/number) → primitive', async () => {
    const r = await parse(`
      class C {
        final name = 'foo';
      }
    `)
    expect(getOrigin(r, 'C', 'name')).toEqual({ kind: 'primitive' })
  })

  it('A9 — type annotation Function → function, builtin generic → external, unknown type → unknown', async () => {
    const r = await parse(`
      class C {
        Function handler = () {};
        List<String> names = [];
        UnknownType mystery;
      }
    `)
    expect(getOrigin(r, 'C', 'handler')).toEqual({ kind: 'function' })
    expect(getOrigin(r, 'C', 'names')).toEqual({ kind: 'external' })
    expect(getOrigin(r, 'C', 'mystery')).toEqual({ kind: 'unknown' })
  })

  it('A10 — initializer 없거나 알 수 없는 RHS면 unknown으로 남긴다', async () => {
    const r = await parse(`
      dynamic buildValue() => null;
      class C {
        final withoutInitializer;
        final fromCall = buildValue();
      }
    `)
    expect(getOrigin(r, 'C', 'withoutInitializer')).toEqual({ kind: 'unknown' })
    expect(getOrigin(r, 'C', 'fromCall')).toEqual({ kind: 'unknown' })
  })
})
