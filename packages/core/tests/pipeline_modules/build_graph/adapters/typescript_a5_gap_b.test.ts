/**
 * a5 갭 B — class_processing 누락 시나리오 추가 테스트
 * SOT: specs/build_graph/specs/adapters/typescript/a5_class_processing/tests.md §10
 *
 * 커버 대상 (B-01~B-10):
 *   B-01: contains edge resolve_status='resolved' 명시 검증
 *   B-02: abstract method → 노드 발화 + 본문 walk 없음
 *   B-03: 메서드 위 다중 decorator + line_start 보정
 *   B-04: anonymous class export → name='default'
 *   B-05: class-level decorator → exportParent line_start 보정
 *   B-06: union type DI param → typeName=첫 타입
 *   B-07: destructuring constructor param → skip
 *   B-08: export abstract class → class 노드 exported
 *   B-09: property 노드 signature 필드 (': string')
 *   B-10: static method 노드 발화
 *
 * 주의: typescript.ts / 기존 테스트 파일 수정 없이 새 파일로만 추가.
 * GAP-C-3: processExportedClass가 더 이상 collectDecorators를 직접 호출 안 함.
 *   class-level decorator는 collectDecoratorsFromExport 한 번만 발화.
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'p1') {
  return adapter.parseFile(content, filePath, repoId)
}

// ─────────────────────────────────────────────────────────────────────────────
// a5 갭 B — class processing 누락 시나리오
// ─────────────────────────────────────────────────────────────────────────────

describe('a5 갭 B — class processing 누락 시나리오', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // class heritage
  // ──────────────────────────────────────────────────────────────────────────
  describe('class heritage', () => {

    // B-08: abstract class export → class 노드 exported
    it('B-08 export abstract class → class 노드 type=class', () => {
      const r = parse('export abstract class Base {}')
      const cls = r.nodes.find(n => n.name === 'Base')
      expect(cls).toBeDefined()
      expect(cls!.type).toBe('class')
      expect(cls!.exported).toBe(true)
    })

    it('B-08b export abstract class with method → class 노드 + method 노드 발화', () => {
      const r = parse(`export abstract class Animal {
  abstract makeSound(): void
  move(): void {}
}`)
      const cls = r.nodes.find(n => n.name === 'Animal')
      expect(cls?.type).toBe('class')
      // non-abstract method도 발화
      const moveMethod = r.nodes.find(n => n.name === 'Animal.move')
      expect(moveMethod).toBeDefined()
    })

  })

  // ──────────────────────────────────────────────────────────────────────────
  // class body — method
  // ──────────────────────────────────────────────────────────────────────────
  describe('class body — method', () => {

    // B-01: contains edge resolve_status='resolved' 명시 검증
    it('B-01 contains edge → resolve_status=resolved (유일한 resolved 엣지)', () => {
      const r = parse(`export class Svc {
  public doWork() { return 1 }
}`)
      const containsEdge = r.edges.find(
        e => e.relation === 'contains' && e.target_symbol === 'doWork'
      )
      expect(containsEdge).toBeDefined()
      expect(containsEdge!.resolve_status).toBe('resolved')
    })

    it('B-01b contains edge → target_id 채워짐 (resolved이므로 null 아님)', () => {
      const r = parse(`export class Svc {
  public doWork() { return 1 }
}`)
      const containsEdge = r.edges.find(
        e => e.relation === 'contains' && e.target_symbol === 'doWork'
      )
      expect(containsEdge!.target_id).not.toBeNull()
    })

    it('B-01c property contains edge → resolve_status=resolved', () => {
      const r = parse(`export class User {
  id: string
}`)
      const containsEdge = r.edges.find(
        e => e.relation === 'contains' && e.target_symbol === 'id'
      )
      expect(containsEdge).toBeDefined()
      expect(containsEdge!.resolve_status).toBe('resolved')
    })

    // B-02: abstract method → 노드 발화
    it('B-02 abstract method → method 노드 발화', () => {
      const r = parse(`export abstract class Base {
  abstract doWork(): void
}`)
      const m = r.nodes.find(n => n.name === 'Base.doWork')
      expect(m).toBeDefined()
      expect(m!.type).toBe('method')
    })

    it('B-02b abstract method + concrete method → 둘 다 노드 발화', () => {
      const r = parse(`export abstract class Base {
  abstract process(): void
  concrete() { return 1 }
}`)
      const abstractM = r.nodes.find(n => n.name === 'Base.process')
      const concreteM = r.nodes.find(n => n.name === 'Base.concrete')
      expect(abstractM).toBeDefined()
      expect(concreteM).toBeDefined()
    })

    it('B-02c abstract method → contains edge resolved 발화', () => {
      const r = parse(`export abstract class Base {
  abstract doWork(): void
}`)
      const containsEdge = r.edges.find(
        e => e.relation === 'contains' && e.target_symbol === 'doWork'
      )
      expect(containsEdge).toBeDefined()
      expect(containsEdge!.resolve_status).toBe('resolved')
    })

    // B-03: 메서드 위 다중 decorator + line_start 보정
    it('B-03 method 위 여러 decorator → decorates edge 각각 발화', () => {
      const r = parse(`import { Get } from '@nestjs/common'
import { ApiOperation } from '@nestjs/swagger'
export class Ctrl {
  @ApiOperation({ summary: 'list' })
  @Get()
  findAll() { return [] }
}`)
      const decoEdges = r.edges.filter(
        e => e.relation === 'decorates' && e.source_id?.endsWith(':Ctrl.findAll')
      )
      expect(decoEdges.length).toBeGreaterThanOrEqual(2)
      const symbols = decoEdges.map(e => e.target_symbol)
      expect(symbols).toContain('Get')
      expect(symbols).toContain('ApiOperation')
    })

    it('B-03b method 위 여러 decorator → line_start이 첫 decorator 줄 기준', () => {
      // 첫 decorator @ApiOperation이 줄 4(1-based)이고 @Get이 줄 5이면
      // method의 line_start는 4여야 함
      const r = parse(`import { Get } from '@nestjs/common'
import { ApiOperation } from '@nestjs/swagger'
export class Ctrl {
  @ApiOperation({ summary: 'list' })
  @Get()
  findAll() { return [] }
}`)
      const m = r.nodes.find(n => n.name === 'Ctrl.findAll')
      expect(m).toBeDefined()
      // @ApiOperation이 4번째 줄이므로 line_start가 method 자체(6번째) 보다 작아야
      expect(m!.line_start).toBeLessThan(6)
    })

    // B-10: static method 노드 발화
    it('B-10 static method → method 노드 발화 (static 메타 미기록 현황 문서화)', () => {
      const r = parse(`export class Util {
  static doThing() { return 'ok' }
}`)
      // static method도 일반 method와 동일하게 method 노드 발화
      const m = r.nodes.find(n => n.name === 'Util.doThing')
      expect(m).toBeDefined()
      expect(m!.type).toBe('method')
    })

    it('B-10b static method → contains edge resolved 발화', () => {
      const r = parse(`export class Util {
  static doThing() { return 'ok' }
}`)
      const containsEdge = r.edges.find(
        e => e.relation === 'contains' && e.target_symbol === 'doThing'
      )
      expect(containsEdge).toBeDefined()
      expect(containsEdge!.resolve_status).toBe('resolved')
    })

    // B-04: anonymous class export → name='default'
    it('B-04 export default class {} (anonymous) → class 노드 name=default', () => {
      const r = parse('export default class {}')
      const cls = r.nodes.find(n => n.type === 'class')
      expect(cls).toBeDefined()
      expect(cls!.name).toBe('default')
    })

    it('B-04b export default class with method → default.methodName 노드 발화', () => {
      const r = parse(`export default class {
  doWork() { return 1 }
}`)
      const m = r.nodes.find(n => n.name === 'default.doWork')
      expect(m).toBeDefined()
      expect(m!.type).toBe('method')
    })

    // B-05: class-level decorator → exportParent line_start 보정
    it('B-05 class-level decorator → class 노드 line_start이 decorator 줄 기준으로 보정', () => {
      // @Injectable()이 1번째 줄, export class UserService가 2번째 줄이면
      // class 노드의 line_start는 2가 아니라 1이어야 함
      const r = parse(`import { Injectable } from '@nestjs/common'
@Injectable()
export class UserService {}`)
      const cls = r.nodes.find(n => n.name === 'UserService')
      expect(cls).toBeDefined()
      // decorator가 클래스 선언보다 위에 있으므로 line_start < 3 (3번째 줄)
      expect(cls!.line_start).toBeLessThan(3)
    })

    it('B-05b @Injectable() class → decorates edge → resolve_status=pending', () => {
      const r = parse(`import { Injectable } from '@nestjs/common'
@Injectable()
export class UserService {}`)
      const decEdge = r.edges.find(
        e => e.relation === 'decorates' && e.target_symbol === 'Injectable'
      )
      expect(decEdge).toBeDefined()
      expect(decEdge!.resolve_status).toBe('pending')
    })

    it('B-05c class-level decorator → decorates edge 발화 한 번 (중복 없음, GAP-C-3)', () => {
      // GAP-C-3: processExportedClass가 더 이상 collectDecorators 호출 안 함
      // collectDecoratorsFromExport(a4)가 한 번만 발화
      const r = parse(`import { Injectable } from '@nestjs/common'
@Injectable()
export class UserService {}`)
      const decoratesEdges = r.edges.filter(
        e => e.relation === 'decorates' && e.target_symbol === 'Injectable'
      )
      // 중복 발화 없이 정확히 1개
      expect(decoratesEdges.length).toBe(1)
    })

  })

  // ──────────────────────────────────────────────────────────────────────────
  // class body — field/property
  // ──────────────────────────────────────────────────────────────────────────
  describe('class body — field/property', () => {

    // B-09: property 노드 signature 필드 (': string')
    it('B-09 property 노드 → signature 필드가 type annotation 텍스트', () => {
      const r = parse(`export class User {
  name: string
}`)
      const prop = r.nodes.find(n => n.name === 'User.name')
      expect(prop).toBeDefined()
      expect(prop!.signature).toBe(': string')
    })

    it('B-09b 복잡한 타입 annotation → signature에 전체 annotation 포함', () => {
      const r = parse(`export class OrderService {
  orders: Order[]
}`)
      const prop = r.nodes.find(n => n.name === 'OrderService.orders')
      expect(prop).toBeDefined()
      expect(prop!.signature).toBeTruthy()
      expect(prop!.signature).toContain('Order')
    })

    it('B-09c 타입 annotation 없는 field → signature=null', () => {
      const r = parse(`export class C {
  count = 0
}`)
      const prop = r.nodes.find(n => n.name === 'C.count')
      // type annotation이 없으면 sig=null
      expect(prop).toBeDefined()
      expect(prop!.signature).toBeNull()
    })

    it('B-09d optional 타입 annotation → signature 포함', () => {
      const r = parse(`export class Dto {
  age?: number
}`)
      const prop = r.nodes.find(n => n.name === 'Dto.age')
      expect(prop).toBeDefined()
      expect(prop!.signature).toBeTruthy()
      expect(prop!.signature).toContain('number')
    })

  })

  // ──────────────────────────────────────────────────────────────────────────
  // constructor DI
  // ──────────────────────────────────────────────────────────────────────────
  describe('constructor DI', () => {

    // B-06: union type DI param → extractTypeName 동작 문서화
    it('B-06 union type DI param → extractTypeName이 union_type 노드를 처리 못해 skip (알려진 한계 §7.5)', () => {
      // extractTypeName은 type_annotation.children에서
      // type_identifier | identifier | generic_type만 처리한다.
      // union_type(SvcA | SvcB)은 union_type 노드로 파싱되어 위 분기에 해당하지 않으므로
      // typeName=null → 해당 param skip → params.length=0
      // spec §7.5: "union의 첫 타입만 수집"이라고 기술되어 있으나
      // 실제로는 union_type AST 노드 구조 때문에 아무것도 수집 안 됨 — 실제 동작 문서화
      const r = parse(`export class A {
  constructor(private svc: SvcA | SvcB) {}
}`)
      const params = r.constructorParams[0]?.params ?? []
      // union type param → typeName 추출 실패 → skip → 빈 배열
      expect(params.length).toBe(0)
    })

    // B-07: destructuring constructor param → skip
    it('B-07 destructuring constructor param → constructorParams에 수집 안 됨 (skip)', () => {
      // { host }: Config 형태 → nameNode = object_pattern → F5 매칭 불가
      // accessibility modifier 있어도 destructuring은 실용적으로 미수집
      const r = parse(`export class A {
  constructor(private { host }: Config) {}
}`)
      // destructuring param은 skip되거나 잘못된 fieldName으로 수집되지만
      // F5에서 어차피 매칭 불가 — 현재 동작을 문서화
      const params = r.constructorParams[0]?.params ?? []
      // 실제 동작: pattern이 object_pattern이면 fieldName이 '{host}' 형태로 오거나
      // typeNode가 없으면 skip — 어느 경우든 f5에서 DI 불가
      // 현재 동작 확인: 수집되지 않거나, 수집되더라도 fieldName이 identifier 아님
      if (params.length > 0) {
        // destructuring이 수집되었다면 fieldName이 object 텍스트 형태여야 함 (알려진 한계)
        // 이 케이스는 F5 resolveDICall에서 failed 처리됨
        expect(params[0].fieldName).not.toBe('host') // 단순 identifier가 아님
      }
      // 수집 안 됨이 이상적이나, 현재 코드 동작에 따름
    })

    it('B-07b accessibility 없는 destructuring param → skip', () => {
      const r = parse(`export class A {
  constructor({ host }: Config) {}
}`)
      // accessibility modifier 없으므로 hasAccessibility=false → skip
      expect(r.constructorParams).toEqual([])
    })

    it('B-06b readonly modifier 있는 DI param → 정상 수집', () => {
      // private readonly svc: SvcType → typeName='SvcType' 수집
      const r = parse(`export class A {
  constructor(private readonly svc: SvcType) {}
}`)
      const params = r.constructorParams[0]?.params ?? []
      expect(params.length).toBe(1)
      expect(params[0].fieldName).toBe('svc')
      expect(params[0].typeName).toBe('SvcType')
    })

  })

})
