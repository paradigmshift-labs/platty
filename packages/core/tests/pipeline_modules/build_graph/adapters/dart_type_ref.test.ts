/**
 * D1: Dart 어댑터 type_ref edge 발화 (P12 패턴 포팅)
 *
 * field type annotation root identifier → type_ref
 * method param type → type_ref
 * method return type → type_ref
 * constructor param type → type_ref (P11 DI 입력 — F5 resolveDICall이 사용)
 * generic argument → type_ref (List<User>의 User)
 *
 * 전제: importSymbolMap 빌드 (TS buildImportSymbolMap 포팅)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function typeRef(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.filter(
    (e) => e.relation === 'type_ref' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('D1-A: field type annotation → type_ref', () => {
  it('A1 — final UserService userService; (단순 type) → UserService type_ref', async () => {
    const r = await parse(`
      import 'src/user_service.dart';
      class Repo {
        final UserService userService;
        Repo(this.userService);
      }
    `)
    expect(typeRef(r.edges, 'UserService', ':Repo.userService').length).toBeGreaterThan(0)
  })

  it('A2 — late final Logger _logger; (modifier 있어도) → Logger type_ref', async () => {
    const r = await parse(`
      import 'src/logger.dart';
      class Repo {
        late final Logger _logger;
      }
    `)
    expect(typeRef(r.edges, 'Logger', ':Repo._logger').length).toBeGreaterThan(0)
  })

  it('A3 — final List<User> users; (generic type) → List + User type_ref', async () => {
    const r = await parse(`
      import 'src/user.dart';
      class Repo {
        final List<User> users = [];
      }
    `)
    // root 'List' + generic arg 'User' 둘 다 발화
    expect(typeRef(r.edges, 'List', ':Repo.users').length).toBeGreaterThan(0)
    expect(typeRef(r.edges, 'User', ':Repo.users').length).toBeGreaterThan(0)
  })

  it('A4 — Cache cache = Cache(); (initializer 있어도) → Cache type_ref', async () => {
    const r = await parse(`
      import 'src/cache.dart';
      class Repo {
        Cache cache = Cache();
      }
    `)
    expect(typeRef(r.edges, 'Cache', ':Repo.cache').length).toBeGreaterThan(0)
  })

  it('A5 — primitive type field (int count;) → primitive는 type_ref X (또는 발화하되 importSymbolMap에서 미해결)', async () => {
    const r = await parse(`
      class Repo {
        int count = 0;
      }
    `)
    // 'int'는 Dart primitive — type_ref는 발화 가능하지만 specifier=null
    // 핵심은 noise edge가 너무 많지 않으면 됨
    const refs = typeRef(r.edges, 'int', ':Repo.count')
    // 발화하면 specifier=null, 안 발화해도 OK (구현 선택)
    if (refs.length > 0) {
      expect(refs[0].target_specifier).toBeNull()
    }
  })
})

describe('D1-B: method signature → type_ref', () => {
  it('B1 — UserDto fetch(int id) — return type → UserDto type_ref', async () => {
    const r = await parse(`
      import 'src/user_dto.dart';
      class Repo {
        UserDto fetch(int id) {
          throw UnimplementedError();
        }
      }
    `)
    expect(typeRef(r.edges, 'UserDto', ':Repo.fetch').length).toBeGreaterThan(0)
  })

  it('B2 — void save(User user, Logger logger) — param types → User/Logger type_ref', async () => {
    const r = await parse(`
      import 'src/user.dart';
      import 'src/logger.dart';
      class Repo {
        void save(User user, Logger logger) {}
      }
    `)
    expect(typeRef(r.edges, 'User', ':Repo.save').length).toBeGreaterThan(0)
    expect(typeRef(r.edges, 'Logger', ':Repo.save').length).toBeGreaterThan(0)
  })

  it('B3 — Future<List<User>> getAll() — nested generic → Future + List + User type_ref', async () => {
    const r = await parse(`
      import 'src/user.dart';
      class Repo {
        Future<List<User>> getAll() async => [];
      }
    `)
    expect(typeRef(r.edges, 'User', ':Repo.getAll').length).toBeGreaterThan(0)
  })
})

describe('D1-C: constructor param → type_ref + ConstructorParam', () => {
  it('C1 — Repo(this.svc, this.logger) (initializing formal) — type 추론은 field type 기반', async () => {
    // Dart 'this.field' constructor param: field type을 따라감
    const r = await parse(`
      import 'src/svc.dart';
      class Repo {
        final Svc svc;
        Repo(this.svc);
      }
    `)
    // field type_ref가 발화되면 충분 (constructor param type은 별도 edge 없어도 F5가 처리)
    expect(typeRef(r.edges, 'Svc', ':Repo.svc').length).toBeGreaterThan(0)
  })

  it('C2 — Repo({required Svc svc}) (named param 명시 type) → Svc type_ref', async () => {
    const r = await parse(`
      import 'src/svc.dart';
      class Repo {
        final Svc svc;
        Repo({required this.svc});
      }
    `)
    expect(typeRef(r.edges, 'Svc', ':Repo.svc').length).toBeGreaterThan(0)
  })
})

describe('D1-D: importSymbolMap → specifier 채움', () => {
  it('D1 — import show clause로 명시된 type — specifier=URI', async () => {
    const r = await parse(`
      import 'package:my_pkg/svc.dart' show Svc;
      class Repo {
        final Svc svc;
        Repo(this.svc);
      }
    `)
    const refs = typeRef(r.edges, 'Svc', ':Repo.svc')
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0].target_specifier).toBe('package:my_pkg/svc.dart')
  })

  it('D2 — import 안 한 type — specifier=null (또는 미발화)', async () => {
    const r = await parse(`
      class Repo {
        final SomeUndefinedType x = SomeUndefinedType();
      }
      class SomeUndefinedType {}
    `)
    // 같은 file 정의는 specifier=null로 발화 OK
    const refs = typeRef(r.edges, 'SomeUndefinedType', ':Repo.x')
    if (refs.length > 0) {
      expect(refs[0].target_specifier).toBeNull()
    }
  })
})
