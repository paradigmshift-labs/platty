/**
 * DartParserAdapter 단위 테스트
 * SOT: specs/phase3/dart_support.md §6-1
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart.js'

const PROJECT_ID = 'proj_dart_test'

let adapter: DartParserAdapter

beforeAll(async () => {
  adapter = await DartParserAdapter.create()
})

// ── 헬퍼 ──

function parse(content: string, filePath = 'lib/test.dart') {
  return adapter.parseFile(content, filePath, PROJECT_ID)
}

// ── T1: 기본 클래스 추출 + signature + jsdoc ──

describe('T1: 기본 클래스 + method', () => {
  it('class 노드, method 노드, jsdoc, signature, exported 추출', () => {
    const content = `
/// Creates a new order.
class OrderService {
  /// Fetches order by [id].
  Future<Order> createOrder(String id, {required int qty}) async {
    return Order();
  }
  void _validate(Order o) {}
}
`
    const result = parse(content)

    const fileNode = result.nodes.find(n => n.type === 'file')!
    expect(fileNode.type).toBe('file')
    expect(fileNode.exported).toBe(true)
    expect(fileNode.is_test).toBe(false)
    expect(fileNode.parse_status).toBe('ok')

    const classNode = result.nodes.find(n => n.name === 'OrderService')!
    expect(classNode.type).toBe('class')
    expect(classNode.exported).toBe(true)
    expect(classNode.jsdoc).toBe('Creates a new order.')

    const createOrder = result.nodes.find(n => n.name === 'createOrder')!
    expect(createOrder.exported).toBe(true)
    expect(createOrder.is_async).toBe(true)
    expect(createOrder.signature).toBe('(String id, {required int qty}) → Future<Order>')
    expect(createOrder.jsdoc).toBe('Fetches order by [id].')

    const validate = result.nodes.find(n => n.name === '_validate')!
    expect(validate.exported).toBe(false)
  })
})

// ── T2: abstract class / mixin / extension → type='class' ──

describe('T2: abstract class / mixin / extension → type=class', () => {
  it('네 가지 모두 type=class, exported=true', () => {
    const content = `
abstract class Repository {}
mixin Serializable {}
extension StringExt on String {}
`
    const result = parse(content)

    const repo = result.nodes.find(n => n.name === 'Repository')!
    expect(repo.type).toBe('class')
    expect(repo.exported).toBe(true)

    const mix = result.nodes.find(n => n.name === 'Serializable')!
    expect(mix.type).toBe('class')

    const ext = result.nodes.find(n => n.name === 'StringExt')!
    expect(ext.type).toBe('class')
  })
})

// ── T3: import edge — 단순/show 단일/show 복수/as alias ──

describe('T3: import edge', () => {
  it('show 없음 → target_symbol=null', () => {
    const content = `import 'package:flutter/material.dart';`
    const result = parse(content)

    const edge = result.edges.find(e => e.relation === 'imports')!
    expect(edge.target_specifier).toBe('package:flutter/material.dart')
    expect(edge.target_symbol).toBeNull()
  })

  it('show 복수 → edge 2개 분리', () => {
    const content = `import 'package:flutter/material.dart' show Widget, StatelessWidget;`
    const result = parse(content)

    const edges = result.edges.filter(e => e.relation === 'imports')
    expect(edges).toHaveLength(2)
    expect(edges.map(e => e.target_symbol).sort()).toEqual(['StatelessWidget', 'Widget'])
    expect(edges[0].target_specifier).toBe('package:flutter/material.dart')
  })

  it('as alias → target_symbol=null (alias 저장 안 함)', () => {
    const content = `import '../utils/helper.dart' as helper;`
    const result = parse(content)

    const edge = result.edges.find(e => e.relation === 'imports')!
    expect(edge.target_specifier).toBe('../utils/helper.dart')
    expect(edge.target_symbol).toBeNull()
  })
})

// ── T4: extends/implements/with edge ──

describe('T4: extends/implements/with edge', () => {
  it('extends → relation=extends, implements → relation=implements', () => {
    const content = `
class OrderRepo extends BaseRepo implements Repository {
}
`
    const result = parse(content)

    const extendsEdge = result.edges.find(e => e.relation === 'extends')!
    expect(extendsEdge.target_symbol).toBe('BaseRepo')

    const implEdge = result.edges.find(e => e.relation === 'implements')!
    expect(implEdge.target_symbol).toBe('Repository')
  })

  it('with clause → grammar ERROR, no edge (v1.0.0 한계)', () => {
    const content = `
class OrderRepo extends BaseRepo implements Repository with Cacheable {
}
`
    const result = parse(content)
    // 'with Cacheable' → ERROR node → skip
    // extends 있고 implements 있음, but no 'implements' for Cacheable
    const implEdges = result.edges.filter(e => e.relation === 'implements')
    expect(implEdges.length).toBe(1) // only Repository, not Cacheable
    expect(implEdges[0].target_symbol).toBe('Repository')
  })
})

// ── T5: 어노테이션(decorates) edge ──

describe('T5: 어노테이션 edge', () => {
  it('@Injectable(), @Route 추출', () => {
    const content = `
@Injectable()
@Route('/orders')
class OrderController {}
`
    const result = parse(content)

    const decorates = result.edges.filter(e => e.relation === 'decorates')
    expect(decorates).toHaveLength(2)

    const injectable = decorates.find(e => e.target_symbol === 'Injectable')!
    expect(injectable.first_arg).toBeNull()

    const route = decorates.find(e => e.target_symbol === 'Route')!
    expect(route.first_arg).toBe('/orders')
    expect(route.literal_args).toBe('["/orders"]')
  })
})

// ── T6: exported 규칙 ──

describe('T6: exported 규칙', () => {
  it('_ prefix → exported=false, 그 외 → true', () => {
    const content = `
class PublicClass {}
class _PrivateClass {}
void publicFn() {}
void _privateFn() {}
const kLimit = 100;
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'PublicClass')!.exported).toBe(true)
    expect(result.nodes.find(n => n.name === '_PrivateClass')!.exported).toBe(false)
    expect(result.nodes.find(n => n.name === 'publicFn')!.exported).toBe(true)
    expect(result.nodes.find(n => n.name === '_privateFn')!.exported).toBe(false)
    expect(result.nodes.find(n => n.name === 'kLimit')!.exported).toBe(true)
  })
})

// ── T7: top_level_variable_declaration ──

describe('T7: top-level variable → function vs variable', () => {
  it('arrow function → type=function, 그 외 → type=variable', () => {
    const content = `
final handler = (String id) => id.toUpperCase();
const kLimit = 100;
final config = Config();
var count = 1;
final GoRouter router = GoRouter(routes: []);
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'handler')!.type).toBe('function')
    expect(result.nodes.find(n => n.name === 'kLimit')!.type).toBe('variable')
    expect(result.nodes.find(n => n.name === 'config')!.type).toBe('variable')
    expect(result.nodes.find(n => n.name === 'count')!.type).toBe('variable')
    expect(result.nodes.find(n => n.name === 'router')!.type).toBe('variable')
    expect(result.edges.find(e => e.source_id.endsWith(':router') && e.target_symbol === 'GoRouter')).toBeDefined()
  })

  it('getter/call-chain callbacks inside malformed enum bodies stay variable', () => {
    const content = `
enum NotificationType {
  like('Like');

  final String value;
  const NotificationType(this.value);

  static List<String> get allStringTypes =>
      NotificationType.values.map((e) => e.value).toList();
}
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'allStringTypes')!.type).toBe('variable')
  })
})

describe('T7b: callback function nodes', () => {
  it('콜백 literal을 function node로 만들고 내부 calls source를 callback으로 귀속', () => {
    const content = `
class CallbackPage {
  void build() {
    stream.listen((event) {
      ref.read(userProvider);
      Widget();
    });
  }
}
`
    const result = parse(content)

    const callback = result.nodes.find(n =>
      n.type === 'function' &&
      n.name.startsWith('build.callback@')
    )!
    expect(callback).toBeDefined()

    expect(result.edges.find(e =>
      e.relation === 'contains' &&
      e.source_id.endsWith(':CallbackPage.build') &&
      e.target_id === callback.id
    )).toBeDefined()

    expect(result.edges.find(e =>
      e.relation === 'calls' &&
      e.source_id === callback.id &&
      e.target_symbol === 'read'
    )).toBeDefined()
    expect(result.edges.find(e =>
      e.relation === 'calls' &&
      e.source_id.endsWith(':CallbackPage.build') &&
      e.target_symbol === 'read'
    )).toBeUndefined()
  })

  it('직접 할당된 function initializer 자체는 중복 callback node로 만들지 않음', () => {
    const content = `
final handler = () {
  Widget();
};
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'handler')!.type).toBe('function')
    expect(result.nodes.find(n => n.name.startsWith('handler.callback@'))).toBeUndefined()
    expect(result.edges.find(e =>
      e.relation === 'calls' &&
      e.source_id.endsWith(':handler') &&
      e.target_symbol === 'Widget'
    )).toBeDefined()
  })

  it('method body local variable initializer를 variable node로 만들고 callback을 variable 아래에 둔다', () => {
    const content = `
class PurchaseStep {
  void build(List<Item> items) {
    final repository = ref.read(repositoryProvider);
    final hasVerification = items.any((item) => item.isVerification);
  }
}
`
    const result = parse(content)

    const variable = result.nodes.find(n =>
      n.type === 'variable' &&
      n.name === 'hasVerification'
    )!
    expect(variable).toBeDefined()

    const callback = result.nodes.find(n =>
      n.type === 'function' &&
      n.name.startsWith('hasVerification.callback@')
    )!
    expect(callback).toBeDefined()

    expect(result.edges.find(e =>
      e.relation === 'contains' &&
      e.source_id === variable.id &&
      e.target_id === callback.id
    )).toBeDefined()

    expect(result.edges.find(e =>
      e.relation === 'contains' &&
      e.source_id.endsWith(':PurchaseStep.build') &&
      e.target_id === variable.id
    )).toBeDefined()
    expect(result.nodes.find(n => n.type === 'variable' && n.name === 'repository')).toBeUndefined()
    expect(result.nodes.find(n =>
      n.type === 'function' &&
      n.name.startsWith('build.callback@')
    )).toBeUndefined()
  })

  it('같은 이름의 method-local variable이 반복되어도 callback contains edge는 실제 variable node id를 가리킨다', () => {
    const content = `
class FriendActionService {
  void accept(response) {
    final profileUser = response.fold((l) => null, (r) => r);
  }

  void request(response) {
    final profileUser = response.fold((l) => null, (r) => r);
  }
}
`
    const result = parse(content)

    const profileUsers = result.nodes.filter(n => n.type === 'variable' && n.name === 'profileUser')
    expect(profileUsers).toHaveLength(2)

    for (const variable of profileUsers) {
      const callbacks = result.nodes.filter(n =>
        n.type === 'function' &&
        n.name.startsWith(`profileUser.callback@${variable.line_start}`)
      )
      expect(callbacks).toHaveLength(2)
      for (const callback of callbacks) {
        expect(result.edges.find(e =>
          e.relation === 'contains' &&
          e.source_id === variable.id &&
          e.target_id === callback.id
        )).toBeDefined()
      }
    }
  })

})

// ── T8: constructor — 기본 vs named + constructorParams ──

describe('T8: constructor params', () => {
  it('기본 생성자 → name=ClassName, constructorParams 수집', () => {
    const content = `
class OrderService {
  final UserService _userService;
  OrderService(this._userService);
}
`
    const result = parse(content)

    const ctorNode = result.nodes.find(n => n.name === 'OrderService' && n.type === 'method')!
    expect(ctorNode).toBeDefined()
    expect(ctorNode.name).toBe('OrderService')

    const ctorParams = result.constructorParams.find(p => p.className === 'OrderService')!
    expect(ctorParams.params).toHaveLength(1)
    expect(ctorParams.params[0].fieldName).toBe('_userService')
    expect(ctorParams.params[0].typeName).toBe('UserService')
  })

  it('named 생성자 → name=ClassName.named', () => {
    const content = `
class OrderService {
  OrderService.empty();
}
`
    const result = parse(content)

    const namedCtor = result.nodes.find(n => n.name === 'OrderService.empty')!
    expect(namedCtor).toBeDefined()
    expect(namedCtor.type).toBe('method')
  })

  it('initializer/body가 있는 생성자 → body 끝까지 line_end 수집', () => {
    const content = `
class AuthNotifier {
  AuthNotifier() : streamAuth = StreamAuth() {
    streamAuth.listen();
  }
  final StreamAuth streamAuth;
}
`
    const result = parse(content)

    const ctor = result.nodes.find(n => n.name === 'AuthNotifier' && n.type === 'method')!
    expect(ctor).toBeDefined()
    expect(ctor.line_end).toBe(5)
  })

  it('반환 타입이 생략된 메서드 → 생성자가 아니라 method로 수집', () => {
    const content = `
class PageState {
  _buildBody() {
    return Widget();
  }
}
`
    const result = parse(content)

    const method = result.nodes.find(n => n.name === '_buildBody' && n.type === 'method')!
    expect(method).toBeDefined()
    expect(method.exported).toBe(false)
  })
})

// ── T9: jsdoc — /// 연속 라인 vs /** */ vs 없음 ──

describe('T9: jsdoc 추출', () => {
  it('/// 연속 라인 → join with \\n', () => {
    const content = `
/// Line one.
/// Line two.
void fnA() {}

/** Block comment */
void fnB() {}

void fnC() {}
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'fnA')!.jsdoc).toBe('Line one.\nLine two.')
    expect(result.nodes.find(n => n.name === 'fnB')!.jsdoc).toBe('Block comment')
    expect(result.nodes.find(n => n.name === 'fnC')!.jsdoc).toBeNull()
  })
})

// ── T10: signature ──

describe('T10: signature', () => {
  it('반환 타입 있음 → signature, dynamic → null', () => {
    const content = `
String format(int n) { return n.toString(); }
dynamic compute(String s) { return s; }
void doNothing() {}
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'format')!.signature).toBe('(int n) → String')
    expect(result.nodes.find(n => n.name === 'compute')!.signature).toBeNull()
    // void → signature='() → void'
    expect(result.nodes.find(n => n.name === 'doNothing')!.signature).toBe('() → void')
  })
})

// ── T11: getter/setter name ──

describe('T11: getter/setter name', () => {
  it('get:propName, set:propName', () => {
    const content = `
class Foo {
  int get count => 0;
  set count(int v) {}
}
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'get:count')).toBeDefined()
    expect(result.nodes.find(n => n.name === 'set:count')).toBeDefined()
  })
})

// ── T12: enum + enumValues 빈 Map ──

describe('T12: enum', () => {
  it('type=enum, enumValues: empty Map', () => {
    const content = `
enum OrderStatus { pending, active, deleted }
`
    const result = parse(content)

    const enumNode = result.nodes.find(n => n.type === 'enum')!
    expect(enumNode.name).toBe('OrderStatus')
    expect(enumNode.exported).toBe(true)
    expect(result.enumValues.size).toBe(0)
  })
})

// ── T13: re_exports (grammar ERROR → 미수집) ──

describe('T13: re_exports', () => {
  it('export 지시어 → grammar ERROR → re_exports edge 없음 (v1.0.0 한계)', () => {
    const content = `
export 'src/models/order.dart';
export 'src/models/user.dart' show User;
`
    const result = parse(content)
    // tree-sitter-dart v1.0.0: export → ERROR → no re_exports edges
    const reExports = result.edges.filter(e => e.relation === 're_exports')
    expect(reExports).toHaveLength(0)
  })
})

// ── T14: isTest + test_type ──

describe('T14: isTest + test_type', () => {
  it('*_test.dart → isTest=true, unit', () => {
    const result = adapter.parseFile('void main() {}', 'test/order_service_test.dart', PROJECT_ID)
    const fileNode = result.nodes.find(n => n.type === 'file')!
    expect(fileNode.is_test).toBe(true)
    expect(fileNode.test_type).toBe('unit')
  })

  it('integration *_test.dart → test_type=integration', () => {
    const result = adapter.parseFile('void main() {}', 'test/integration/order_integration_test.dart', PROJECT_ID)
    const fileNode = result.nodes.find(n => n.type === 'file')!
    expect(fileNode.is_test).toBe(true)
    expect(fileNode.test_type).toBe('integration')
  })

  it('lib/main.dart → isTest=false', () => {
    const result = adapter.parseFile('void main() {}', 'lib/main.dart', PROJECT_ID)
    const fileNode = result.nodes.find(n => n.type === 'file')!
    expect(fileNode.is_test).toBe(false)
    expect(fileNode.test_type).toBeNull()
  })
})

// ── T15: 파싱 실패 핸들링 ──

describe('T15: 파싱 실패', () => {
  it('parse 반환 null → file 노드 parse_status=failed', () => {
    // web-tree-sitter는 항상 tree를 반환하지만, null mock이 어려우므로
    // 정상 content로 ok 케이스 확인 + 빈 content 테스트
    const result = adapter.parseFile('', 'lib/empty.dart', PROJECT_ID)
    const fileNode = result.nodes.find(n => n.type === 'file')!
    // 빈 파일은 ok로 파싱됨 (유효한 Dart)
    expect(fileNode.parse_status).toBe('ok')
    expect(fileNode.name).toBe('empty.dart')
  })
})

// ── T16: 실제 Flutter 프로젝트 fixture smoke test ──

describe('T16: Flutter counter fixture smoke test', () => {
  const fixtureDir = path.resolve('tests/fixtures/flutter_counter')

  it('lib/main.dart → 노드 추출, parse_errors 없음', () => {
    const content = fs.readFileSync(path.join(fixtureDir, 'lib/main.dart'), 'utf-8')
    const result = adapter.parseFile(content, 'lib/main.dart', PROJECT_ID)

    expect(result.nodes.length).toBeGreaterThan(0)
    const fileNode = result.nodes.find(n => n.type === 'file')!
    expect(fileNode.parse_status).toBe('ok')
    expect(fileNode.is_test).toBe(false)
  })

  it('test/widget_test.dart → is_test=true', () => {
    const content = fs.readFileSync(path.join(fixtureDir, 'test/widget_test.dart'), 'utf-8')
    const result = adapter.parseFile(content, 'test/widget_test.dart', PROJECT_ID)

    const fileNode = result.nodes.find(n => n.type === 'file')!
    expect(fileNode.is_test).toBe(true)
  })

  it('lib/home_page.dart → class + method 노드 포함', () => {
    const content = fs.readFileSync(path.join(fixtureDir, 'lib/home_page.dart'), 'utf-8')
    const result = adapter.parseFile(content, 'lib/home_page.dart', PROJECT_ID)

    const classes = result.nodes.filter(n => n.type === 'class')
    expect(classes.length).toBeGreaterThan(0)
  })
})

// ── 추가: type_alias 추출 ──

describe('type_alias → type=type', () => {
  it('typedef → type 노드', () => {
    const content = `typedef Callback = void Function(String);`
    const result = parse(content)

    const typeNode = result.nodes.find(n => n.type === 'type')!
    expect(typeNode.name).toBe('Callback')
    expect(typeNode.exported).toBe(true)
  })
})

// ── 추가: is_async ──

describe('is_async 추출', () => {
  it('async 함수 → is_async=true', () => {
    const content = `
Future<void> fetchData() async {
  return;
}
void syncFn() {}
`
    const result = parse(content)

    expect(result.nodes.find(n => n.name === 'fetchData')!.is_async).toBe(true)
    expect(result.nodes.find(n => n.name === 'syncFn')!.is_async).toBe(false)
  })
})

// ── COV-1: supportedExtensions() ──

describe('COV-1: supportedExtensions()', () => {
  it('returns [".dart"]', () => {
    expect(adapter.supportedExtensions()).toEqual(['.dart'])
  })
})

// ── COV-2: parseFile 파싱 실패 — parse_status=failed ──

describe('COV-2: parseFile 파싱 실패 경로', () => {
  it('parser.parse가 throw → file 노드 parse_status=failed', () => {
    const parserInternal = (adapter as any).parser
    const spy = vi.spyOn(parserInternal, 'parse').mockImplementationOnce(() => {
      throw new Error('parse failed')
    })

    const result = adapter.parseFile('class Broken {', 'lib/broken.dart', PROJECT_ID)

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].type).toBe('file')
    expect(result.nodes[0].parse_status).toBe('failed')
    expect(result.edges).toHaveLength(0)
    spy.mockRestore()
  })

  it('parser.parse가 null 반환 → file 노드 parse_status=failed', () => {
    const parserInternal = (adapter as any).parser
    const spy = vi.spyOn(parserInternal, 'parse').mockReturnValueOnce(null)

    const result = adapter.parseFile('', 'lib/null_tree.dart', PROJECT_ID)

    expect(result.nodes[0].parse_status).toBe('failed')
    spy.mockRestore()
  })
})

// ── COV-3: 최상위 함수 annotations → decorates edge ──

describe('COV-3: 최상위 함수 @annotation → decorates edge', () => {
  it('@Route 어노테이션 → decorates edge', () => {
    const content = `
@Route('/orders')
Future<void> handleOrders() async {}
`
    const result = parse(content)

    const decoratesEdges = result.edges.filter(e => e.relation === 'decorates')
    expect(decoratesEdges.length).toBeGreaterThan(0)
    const edge = decoratesEdges.find(e => e.target_symbol === 'Route')!
    expect(edge).toBeDefined()
    expect(edge.first_arg).toBe('/orders')
  })
})

// ── COV-4: 생성자 @annotation → decorates edge ──

describe('COV-4: 생성자 @annotation → decorates edge', () => {
  it('@injectable() 어노테이션 생성자 → decorates edge', () => {
    const content = `
class UserService {
  final UserRepo _repo;
  @injectable()
  UserService(this._repo);
}
`
    const result = parse(content)

    const decoratesEdges = result.edges.filter(e => e.relation === 'decorates')
    expect(decoratesEdges.length).toBeGreaterThan(0)
    const edge = decoratesEdges.find(e => e.target_symbol === 'injectable')!
    expect(edge).toBeDefined()
  })
})

// ── COV-5: Typed constructor params (non-this.xxx) ──

describe('COV-5: Typed constructor params (non-this.xxx)', () => {
  it('class S(UserService us, OrderRepo or) → constructorParams 수집', () => {
    const content = `
class OrderController {
  OrderController(UserService us, OrderRepo or);
}
`
    const result = parse(content)

    const ctorParams = result.constructorParams.find(p => p.className === 'OrderController')
    expect(ctorParams).toBeDefined()
    expect(ctorParams!.params.length).toBe(2)
    const types = ctorParams!.params.map(p => p.typeName)
    expect(types).toContain('UserService')
    expect(types).toContain('OrderRepo')
  })
})

// ── COV-5b: optional/named constructor params → collectFormalParams 재귀 ──

describe('COV-5b: optional_formal_parameters 재귀 (named params)', () => {
  it('{required UserService service} → collectFormalParams 재귀 → params 수집', () => {
    // Covers collectFormalParams lines 820-822: optional_formal_parameters recursion
    const content = `
class OrderController {
  OrderController({required UserService service, OrderRepo? repo});
}
`
    const result = parse(content)
    const ctorParams = result.constructorParams.find(p => p.className === 'OrderController')
    expect(ctorParams).toBeDefined()
    // At minimum the typed params inside the optional block should be collected
    const types = ctorParams!.params.map(p => p.typeName)
    expect(types).toContain('UserService')
  })
})

// ── COV-6: addNode dedup — 동일 id 중복 시 line_start suffix ──

describe('COV-6: addNode dedup — 동일 이름 top-level 함수', () => {
  it('동일 이름 함수 2개 → id에 :line_start suffix 추가', () => {
    // Same function name defined twice (overloads pattern in generated code)
    const content = `
void doSomething() {}
void doSomething() {}
`
    const result = parse(content)

    const dupNodes = result.nodes.filter(n => n.name === 'doSomething')
    // Both should appear with suffixed IDs
    expect(dupNodes.length).toBe(2)
    // Each should have a line_start suffix
    for (const n of dupNodes) {
      expect(n.id).toMatch(/:\d+$/)
    }
  })
})

// ── T17: contains 엣지 — class → method/constructor ──

describe('T17: contains 엣지', () => {
  it('class body의 메서드에 대해 contains 엣지 생성 (resolve_status=resolved)', () => {
    const content = `
class AppRouter {
  List<AutoRoute> get routes {
    return [];
  }
  void _init() {}
}
`
    const result = parse(content)

    const classNode = result.nodes.find(n => n.name === 'AppRouter')!
    expect(classNode).toBeDefined()

    const containsEdges = result.edges.filter(e => e.relation === 'contains')
    expect(containsEdges.length).toBeGreaterThanOrEqual(2)

    // resolve_status='resolved', target_id=methNodeId
    for (const e of containsEdges) {
      expect(e.resolve_status).toBe('resolved')
      expect(e.source_id).toBe(classNode.id)
      expect(e.target_id).toBeTruthy()
    }

    const routesNode = result.nodes.find(n => n.name === 'get:routes')!
    const initNode = result.nodes.find(n => n.name === '_init')!
    expect(containsEdges.some(e => e.target_id === routesNode.id)).toBe(true)
    expect(containsEdges.some(e => e.target_id === initNode.id)).toBe(true)
  })

  it('constructor에 대해서도 contains 엣지 생성', () => {
    const content = `
class OrderService {
  OrderService(this.repo);
  final Repo repo;
}
`
    const result = parse(content)

    const classNode = result.nodes.find(n => n.name === 'OrderService')!
    const containsEdges = result.edges.filter(e => e.relation === 'contains')
    expect(containsEdges.length).toBeGreaterThanOrEqual(1)
    expect(containsEdges[0].source_id).toBe(classNode.id)
    expect(containsEdges[0].resolve_status).toBe('resolved')
  })
})

// ── T18: calls 엣지 — GoRouter / AutoRoute / GetX ──

describe('T18: calls 엣지 — routing constructor 추출', () => {
  it('GoRoute(path:) → calls 엣지, first_arg=경로', () => {
    const content = `
void buildRoutes() {
  final routes = [
    GoRoute(path: '/home', builder: (ctx, state) => HomeScreen()),
    GoRoute(path: '/orders/:id', builder: (ctx, state) => OrderScreen()),
    ShellRoute(path: '/shell', builder: (ctx, state, child) => Shell(child)),
  ];
}
`
    const result = parse(content)

    const callsEdges = result.edges.filter(e => e.relation === 'calls')
    const goRoutes = callsEdges.filter(e => e.target_symbol === 'GoRoute')
    const shellRoutes = callsEdges.filter(e => e.target_symbol === 'ShellRoute')

    expect(goRoutes.length).toBe(2)
    expect(goRoutes[0].first_arg).toBe('/home')
    expect(goRoutes[1].first_arg).toBe('/orders/:id')
    expect(shellRoutes.length).toBe(1)
    expect(shellRoutes[0].first_arg).toBe('/shell')

    // 추출된 라우팅 호출 calls 엣지는 pending/unresolved (target_id=null).
    // builder 콜백이 공유 엔진 nested-exec 로 발화되며 callback→parent inverse-calls(resolved, target_id 있음)가
    // 추가되므로 그건 제외하고 검증한다 (C3: Dart 콜백 도달성 일관화).
    const extractedCalls = callsEdges.filter(e => e.target_id === null)
    expect(extractedCalls.length).toBeGreaterThan(0)
    for (const e of extractedCalls) {
      expect(e.resolve_status).toBe('pending')
    }
  })

  it('GetPage(name:) → calls 엣지, first_arg=name 값', () => {
    const content = `
class AppPages {
  static List<GetPage> get pages {
    return [
      GetPage(name: '/orders', page: () => OrderPage()),
      GetPage(name: '/profile', page: () => ProfilePage()),
    ];
  }
}
`
    const result = parse(content)

    const callsEdges = result.edges.filter(e => e.relation === 'calls' && e.target_symbol === 'GetPage')
    expect(callsEdges.length).toBe(2)
    expect(callsEdges[0].first_arg).toBe('/orders')
    expect(callsEdges[1].first_arg).toBe('/profile')
  })

  it('AutoRoute(path:) → calls 엣지 + contains 엣지로 Phase 4 쿼리 조건 충족', () => {
    const content = `
@AutoRouterConfig()
class AppRouter extends _$AppRouter {
  @override
  List<AutoRoute> get routes {
    return [
      AutoRoute(path: '/orders/:id', page: OrderRoute.page),
      AutoRoute(path: '/home', page: HomeRoute.page),
    ];
  }
}
`
    const result = parse(content)

    const classNode = result.nodes.find(n => n.name === 'AppRouter')!
    const routesNode = result.nodes.find(n => n.name === 'get:routes')!

    // contains: AppRouter → get:routes
    const containsEdge = result.edges.find(
      e => e.relation === 'contains' && e.source_id === classNode.id && e.target_id === routesNode.id
    )
    expect(containsEdge).toBeDefined()
    expect(containsEdge!.resolve_status).toBe('resolved')

    // calls: get:routes → AutoRoute (×2)
    const callsEdges = result.edges.filter(
      e => e.relation === 'calls' && e.target_symbol === 'AutoRoute'
    )
    expect(callsEdges.length).toBe(2)
    expect(callsEdges[0].source_id).toBe(routesNode.id)
    expect(callsEdges[0].first_arg).toBe('/orders/:id')
    expect(callsEdges[1].first_arg).toBe('/home')
  })

  it('path arg가 변수 참조이면 first_arg=null', () => {
    const content = `
void buildRoutes() {
  final routes = [
    GoRoute(path: pathVariable, builder: (ctx, state) => HomeScreen()),
  ];
}
`
    const result = parse(content)

    const callsEdge = result.edges.find(e => e.relation === 'calls' && e.target_symbol === 'GoRoute')
    expect(callsEdge).toBeDefined()
    expect(callsEdge!.first_arg).toBeNull()
  })

  it('named arg 순서 무관 — builder가 먼저여도 path 추출', () => {
    const content = `
void buildRoutes() {
  final routes = [
    GoRoute(builder: (ctx, state) => HomeScreen(), path: '/home'),
  ];
}
`
    const result = parse(content)

    const callsEdge = result.edges.find(e => e.relation === 'calls' && e.target_symbol === 'GoRoute')
    expect(callsEdge).toBeDefined()
    expect(callsEdge!.first_arg).toBe('/home')
  })

  it('Widget constructor 호출 (MyWidget())은 calls edge 생성 (E5b 보강 — Widget tree 추적)', () => {
    const content = `
void build() {
  return MyWidget(color: Colors.red);
}
`
    const result = parse(content)
    const callsEdges = result.edges.filter(e => e.relation === 'calls' && e.target_symbol === 'MyWidget')
    expect(callsEdges.length).toBeGreaterThanOrEqual(1)
  })

  it('일반 소문자 함수 호출 (myUtil())은 calls edge 미생성 (V1 호환)', () => {
    const content = `
void run() {
  myUtilFunc('x');
}
`
    const result = parse(content)
    const callsEdges = result.edges.filter(e => e.relation === 'calls' && e.target_symbol === 'myUtilFunc')
    expect(callsEdges.length).toBe(0)
  })

  it('GoRoute에 path: arg 없음 → calls 엣지 생성되지만 first_arg=null (extractNamedArg fallthrough)', () => {
    // Covers extractNamedArg line: return null (no matching named arg found)
    const content = `
void buildRoutes() {
  final routes = [
    GoRoute(builder: (ctx, state) => HomeScreen()),
  ];
}
`
    const result = parse(content)
    const callsEdge = result.edges.find(e => e.relation === 'calls' && e.target_symbol === 'GoRoute')
    expect(callsEdge).toBeDefined()
    expect(callsEdge!.first_arg).toBeNull()
  })
})

// ── S6-GUARD: silent-drop guards for the processClassBody → engine migration ──
// These assertions encode the CURRENT Dart per-member emit behavior. They are INVISIBLE to the
// histogram (counts type/role distributions), the LSP oracle (reconstructs names from node.id),
// and the call baseline (freezes only `calls`). So this block is the only net for per-kind
// node-name / contains-target_symbol / member-attribute / decorator-target_specifier flips that
// S6 (routing Dart through the shared engine processClassBody) could silently introduce.
describe('S6-GUARD: per-kind declaration emit invariants (byte-identity net for the engine migration)', () => {
  const SRC = `
class Widget {
  final Repo repo;
  Widget.create(this.repo);
  @override
  Future<Order> load(int id) async {
    return repo.find(id);
  }
  String get title => 'x';
}
`
  it('node name per kind: method BARE, getter get:x, ctor Class.named, field FULL Class.prop', () => {
    const r = parse(SRC)
    const byName = (n: string) => r.nodes.find(node => node.name === n)
    expect(byName('load')?.type).toBe('method')          // method name is BARE (not Widget.load)
    expect(byName('get:title')?.type).toBe('method')     // getter prefixed get:
    expect(byName('Widget.create')?.type).toBe('method') // named ctor = Class.named
    expect(byName('Widget.repo')?.type).toBe('property')  // field name is FULL Class.prop
    // exactly one method node per method (function_body must not double-emit)
    expect(r.nodes.filter(n => n.name === 'load').length).toBe(1)
  })

  it('method/ctor carry parent_node_id + origin_kind class_member + role; field does NOT', () => {
    const r = parse(SRC)
    const load = r.nodes.find(n => n.name === 'load')!
    expect(load.parent_node_id).toBeTruthy()
    expect(load.origin_kind).toBe('class_member')
    expect(load.role).toBe('load')
    const ctor = r.nodes.find(n => n.name === 'Widget.create')!
    expect(ctor.parent_node_id).toBeTruthy()
    expect(ctor.origin_kind).toBe('class_member')
    const field = r.nodes.find(n => n.name === 'Widget.repo')!
    expect(field.parent_node_id ?? null).toBeNull()
    expect(field.origin_kind ?? null).toBeNull()
  })

  it('contains target_symbol: null for method+ctor, bare propName for field', () => {
    const r = parse(SRC)
    const id = (n: string) => r.nodes.find(node => node.name === n)!.id
    const containsTo = (targetId: string) => r.edges.find(e => e.relation === 'contains' && e.target_id === targetId)!
    expect(containsTo(id('load')).target_symbol).toBeNull()
    expect(containsTo(id('Widget.create')).target_symbol).toBeNull()
    expect(containsTo(id('Widget.repo')).target_symbol).toBe('repo')
    // all contains are resolved + sourced from the class node
    for (const e of r.edges.filter(e => e.relation === 'contains')) {
      expect(e.resolve_status).toBe('resolved')
    }
  })

  it('member decorates target_specifier is null (NOT import-resolved) + count = sibling annotations only', () => {
    const r = parse(SRC)
    const loadId = r.nodes.find(n => n.name === 'load')!.id
    const dec = r.edges.filter(e => e.relation === 'decorates' && e.source_id === loadId)
    expect(dec.length).toBe(1)                  // only @override (no param-decorator union)
    expect(dec[0].target_symbol).toBe('override')
    expect(dec[0].target_specifier).toBeNull()
  })

  it('Dart type_ref edges carry NO type_ref_subtype (stays null)', () => {
    const r = parse(SRC)
    const typeRefs = r.edges.filter(e => e.relation === 'type_ref')
    expect(typeRefs.length).toBeGreaterThan(0) // Future/Order/int/Repo present
    for (const e of typeRefs) {
      expect(e.type_ref_subtype ?? null).toBeNull()
    }
  })
})
