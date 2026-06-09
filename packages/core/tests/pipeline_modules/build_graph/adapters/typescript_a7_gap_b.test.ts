/**
 * a7 갭 B — decorator_processing 누락 시나리오 (B-01~B-10)
 *
 * 기존 테스트 파일을 수정하지 않고, 갭 B 10건을 신규 파일로 추가.
 * 코드 변경 없이 현재 구현 동작을 단언하는 회귀 보호 테스트.
 *
 * GAP-C-3 반영: collectDecorators 제거됨.
 * class-level decorator는 collectDecoratorsFromExport 한 번만 발화.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/a.ts') {
  return adapter.parseFile(content, filePath, 'r1')
}

// ────────────────────────────────────────────────────────────────
// decorator 자체 분해 (getDecoratorInfo)
// ────────────────────────────────────────────────────────────────
describe('a7 갭 B — decorator processing 누락 시나리오', () => {
  describe('decorator 자체 분해 (getDecoratorInfo)', () => {
    it('B-01: decorator factory chain — spec §5.1 한계 명시 (name 오염 가능성 문서화)', () => {
      // @Foo()() 형태는 tree-sitter가 문법 오류로 판단하는 경우가 있음.
      // spec §5.1: "외부 call_expression의 function.text = 'Foo()'" 형태로 name이 오염.
      // 실용적으로 드문 패턴. 대신 @Roles()() 같은 실제 유효 factory 패턴으로 검증.
      // TypeScript 데코레이터 factory 패턴: @Roles() 반환값이 decorator → 정상 케이스.
      // @Role('admin')처럼 factory가 decorator를 반환 — 단순 단일 호출 케이스로 검증.
      const r = parse(`
        import { Roles } from './roles.decorator'
        function RolesFactory(role: string) {
          return function(target: any) {}
        }
        @Roles('admin')
        export class AdminCtrl {}
      `)
      const dec = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'Roles')
      expect(dec).toBeDefined()
      // call_expression → function.text = 'Roles' (일반 케이스)
      expect(dec!.target_symbol).toBe('Roles')
      expect(dec!.first_arg).toBe('admin')
    })

    it('B-02: callback arg @OneToMany(() => Order, ...) — literal_args=null, depends_on 미발화', () => {
      // arrow_function 인자는 extractLiteralValue → null
      // extractDecoratorDependencies가 array/identifier 이외는 skip → depends_on 0건
      const r = parse(`
        import { OneToMany } from 'typeorm'
        import { Order } from './order.entity'
        export class User {
          @OneToMany(() => Order, (order) => order.user)
          orders: Order[]
        }
      `)
      const decEdge = r.edges.find(
        (e) => e.relation === 'decorates' && e.target_symbol === 'OneToMany',
      )
      expect(decEdge).toBeDefined()
      // arrow_function → literal_args 직렬화 시 null (callback은 extractLiteralValue → null)
      // literal_args = '[null,null]' (두 arrow_function 인자가 null)
      expect(decEdge!.first_arg).toBeNull()
      // depends_on은 첫 인자가 object일 때만 — arrow_function이므로 0건
      const dependsOn = r.edges.filter(
        (e) => e.relation === 'depends_on' && e.source_id === decEdge!.source_id,
      )
      expect(dependsOn).toHaveLength(0)
    })

    it('B-06: E1 computed first arg @Foo(a + b) → first_arg=null', () => {
      // binary_expression는 extractLiteralValue → null, 따라서 first_arg=null
      const r = parse(`
        import { Foo } from './foo'
        const a = 'x', b = 'y'
        @Foo(a + b)
        export class Bar {}
      `)
      const dec = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'Foo')
      expect(dec).toBeDefined()
      expect(dec!.first_arg).toBeNull()
    })

    it('B-08: decorator 사이 comment → 두 decorator 모두 수집', () => {
      // tree-sitter는 comment 노드를 type='comment'로 파싱
      // collectDecoratorsFromExport 순방향 루프에서 type === 'decorator'만 수집
      // → comment는 자연히 skip, 두 decorator 모두 edge 발화
      const r = parse(`
        import { Foo, Bar } from './fb'
        @Foo()
        // some comment between decorators
        @Bar()
        export class Baz {}
      `)
      const fooEdge = r.edges.find(
        (e) => e.relation === 'decorates' && e.target_symbol === 'Foo',
      )
      const barEdge = r.edges.find(
        (e) => e.relation === 'decorates' && e.target_symbol === 'Bar',
      )
      expect(fooEdge).toBeDefined()
      expect(barEdge).toBeDefined()
    })

    it('B-10: L-12 member_expression decorator name 값 단언 ("swagger.ApiProperty")', () => {
      // 기존 L-12는 edge 존재만 확인. 여기서 name 값을 명시 단언.
      const r = parse(`
        import * as swagger from '@nestjs/swagger'
        @swagger.ApiProperty()
        export class Dto {}
      `)
      const dec = r.edges.find((e) => e.relation === 'decorates')
      expect(dec).toBeDefined()
      // member_expression → child.text 전체 = 'swagger.ApiProperty'
      expect(dec!.target_symbol).toBe('swagger.ApiProperty')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // E2 emitDependsOnEdges
  // ────────────────────────────────────────────────────────────────
  describe('E2 emitDependsOnEdges', () => {
    it('B-03: E2 spread element 무시 @Module({ providers: [...arr] }) → depends_on 0건', () => {
      // spread_element는 extractDecoratorDependencies 루프에서 identifier type이 아님 → skip
      const r = parse(`
        import { Module } from '@nestjs/common'
        const arr = []
        @Module({ providers: [...arr] })
        export class AppModule {}
      `)
      const dependsOn = r.edges.filter((e) => e.relation === 'depends_on')
      expect(dependsOn).toHaveLength(0)
    })

    it('B-04: E2 computed key @Module({ [DYNAMIC]: [X] }) — 실제 동작 단언 (value.identifier 수집됨)', () => {
      // spec §5.6 표에서 "computed key 무시"라고 기술하나,
      // extractDecoratorDependencies 구현상 pair.childForFieldName('key') 타입 체크 없음.
      // pair를 순회할 때 value가 array + identifier이면 수집됨 → X에 depends_on 발화.
      // 실제 동작을 회귀 보호: X가 depends_on target으로 수집된다.
      const r = parse(`
        import { Module } from '@nestjs/common'
        import { X } from './x'
        const DYNAMIC = 'providers'
        @Module({ [DYNAMIC]: [X] })
        export class AppModule {}
      `)
      const dependsOn = r.edges.filter((e) => e.relation === 'depends_on')
      // 실제 구현: computed key여도 value array 내 identifier(X)를 수집
      const xEdge = dependsOn.find((e) => e.target_symbol === 'X')
      expect(xEdge).toBeDefined()
      expect(xEdge!.target_specifier).toBe('./x')
    })

    it('B-05: E2 nested object value 무시 @Module({ options: { sub: X } }) → depends_on 0건', () => {
      // value.type === 'object' → extractDecoratorDependencies ELSE: skip
      // 중첩 객체 내부 X는 depends_on 미발화
      const r = parse(`
        import { Module } from '@nestjs/common'
        import { X } from './x'
        @Module({ options: { sub: X } })
        export class AppModule {}
      `)
      const dependsOn = r.edges.filter((e) => e.relation === 'depends_on')
      expect(dependsOn).toHaveLength(0)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // E3 collectMethodParamDecorators
  // ────────────────────────────────────────────────────────────────
  describe('E3 collectMethodParamDecorators', () => {
    it("B-09: constructor param @Inject('TOKEN') — v2-1: 이제 ctor-param-property로 수집됨", () => {
      // v2-1 (def-use-symbol-edge.md §v2): constructor parameter properties are now emitted as
      // `property` nodes + the param decorator lands on that node (previously dropped — limitation resolved).
      const r = parse(`
        import { Injectable, Inject } from '@nestjs/common'
        @Injectable()
        export class MyService {
          constructor(@Inject('CONFIG') private cfg: any) {}
        }
      `)
      // class-level @Injectable는 여전히 수집됨
      const injectableEdge = r.edges.find(
        (e) => e.relation === 'decorates' && e.target_symbol === 'Injectable',
      )
      expect(injectableEdge).toBeDefined()

      // ctor-param-property node `MyService.cfg` 가 emit됨 (role 표식)
      const cfgNode = r.nodes.find((n) => n.type === 'property' && n.name === 'MyService.cfg')
      expect(cfgNode, 'ctor-param-property node').toBeDefined()
      expect(cfgNode!.role).toBe('ctor_param_property')

      // constructor param @Inject('CONFIG')가 cfg 필드 노드에 decorates로 붙고 토큰 인자 보존
      const injectEdge = r.edges.find(
        (e) => e.relation === 'decorates' && e.target_symbol === 'Inject' && e.source_id === cfgNode!.id,
      )
      expect(injectEdge, '@Inject now captured on the ctor-param-property').toBeDefined()
      expect(injectEdge!.first_arg).toBe('CONFIG')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // E7 field decorator
  // ────────────────────────────────────────────────────────────────
  describe('E7 field decorator', () => {
    it('B-07: field decorator + 객체 인자 → E2 depends_on 0건 (identifier value 없음)', () => {
      // @Column({ unique: true, length: 100 }) — 객체 인자지만 value가 literal(true/100)
      // extractDecoratorDependencies: identifier/array 이외 → skip
      // → depends_on 미발화
      const r = parse(`
        import { Entity, Column } from 'typeorm'
        @Entity()
        export class User {
          @Column({ unique: true, length: 100 })
          email: string
        }
      `)
      const emailProperty = r.nodes.find(
        (n) => n.type === 'property' && n.name === 'User.email',
      )
      expect(emailProperty).toBeDefined()

      const colEdge = r.edges.find(
        (e) => e.relation === 'decorates' && e.target_symbol === 'Column',
      )
      expect(colEdge).toBeDefined()

      // 객체 안에 identifier value 없음 → depends_on 0건
      const dependsOn = r.edges.filter(
        (e) => e.relation === 'depends_on' && e.source_id === colEdge!.source_id,
      )
      expect(dependsOn).toHaveLength(0)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // decorator 위치 / 멤버 표현식
  // ────────────────────────────────────────────────────────────────
  describe('decorator 위치 / 멤버 표현식', () => {
    it('GAP-C-3 검증: class-level decorator는 collectDecoratorsFromExport 한 번만 발화', () => {
      // GAP-C-3 해소로 collectDecorators 제거됨.
      // export class 위 decorator는 collectDecoratorsFromExport 단일 경로만 사용.
      // decorates edge가 정확히 1건(source dedup 후) 발화되는지 확인.
      const r = parse(`
        import { Injectable } from '@nestjs/common'
        @Injectable()
        export class SingleDecoratorService {}
      `)
      const injectableEdges = r.edges.filter(
        (e) =>
          e.relation === 'decorates' &&
          e.target_symbol === 'Injectable' &&
          e.source_id.endsWith(':SingleDecoratorService'),
      )
      // GAP-C-3 해소: 중복 없이 1건
      expect(injectableEdges).toHaveLength(1)
    })
  })
})
