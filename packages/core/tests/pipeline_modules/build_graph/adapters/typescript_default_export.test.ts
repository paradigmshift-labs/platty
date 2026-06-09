/**
 * TypeScriptParserAdapter — is_default_export 발화 검증
 * SOT: specs/build_graph/
 * 실행: npx vitest run tests/pipeline_modules/build_graph/adapters/typescript_default_export.test.ts
 *
 * 대상:
 *   processExportDefault — export default fn/class/arrow/fn-expr → is_default_export=true
 *   processModuleExportsAssignment — module.exports = X → is_default_export=true
 *   processCJSExportAssignment — export = X → is_default_export=false (정책)
 *
 * 비대상 (false 유지):
 *   export class / export function / export const → is_default_export=false
 *   method/property 등 내부 노드 → is_default_export=false
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'p1') {
  return adapter.parseFile(content, filePath, repoId)
}

// ────────────────────────────────────────────────────────────────────────────
// D. processExportDefault — is_default_export 발화
// ────────────────────────────────────────────────────────────────────────────
describe('D. processExportDefault — is_default_export', () => {
  it('D-01: export default function namedFn() {} → name=namedFn, is_default_export=true', () => {
    const r = parse('export default function namedFn() {}')
    const n = r.nodes.find(node => node.name === 'namedFn')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-02: export default function() {} → name=default, is_default_export=true', () => {
    const r = parse('export default function() {}')
    const n = r.nodes.find(node => node.name === 'default')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-03: export default class MyButton {} → name=MyButton, is_default_export=true', () => {
    const r = parse('export default class MyButton {}')
    const n = r.nodes.find(node => node.name === 'MyButton')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-04: export default class {} → name=default, is_default_export=true', () => {
    const r = parse('export default class {}')
    const n = r.nodes.find(node => node.name === 'default')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-05: export default () => 42 → name=default, is_default_export=true', () => {
    const r = parse('export default () => 42')
    const n = r.nodes.find(node => node.name === 'default')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-06: export default (function expr() {}) → name=default, is_default_export=true', () => {
    const r = parse('export default (function expr() {})')
    // parenthesized expression wraps function — name should be 'default' (function_expression 분기)
    const n = r.nodes.find(node => node.name === 'default')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-07 (대조군): export class Foo {} → is_default_export=false (또는 falsy)', () => {
    const r = parse('export class Foo {}')
    const n = r.nodes.find(node => node.name === 'Foo')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBeFalsy()
  })

  it('D-08 (대조군): export function bar() {} → is_default_export=false', () => {
    const r = parse('export function bar() {}')
    const n = r.nodes.find(node => node.name === 'bar')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBeFalsy()
  })

  it('D-09 (대조군): export const x = 1 → is_default_export=false', () => {
    const r = parse('export const x = 1')
    const n = r.nodes.find(node => node.name === 'x')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBeFalsy()
  })

  it('D-10: export default class MyButton extends Base {} → MyButton is_default_export=true, method 노드는 false', () => {
    const r = parse(`
export default class MyButton extends Base {
  render() { return null }
}`)
    const classNode = r.nodes.find(node => node.name === 'MyButton')
    expect(classNode).toBeDefined()
    expect(classNode!.is_default_export).toBe(true)

    // method 노드는 is_default_export=false여야 함
    const methodNode = r.nodes.find(node => node.name === 'MyButton.render')
    expect(methodNode).toBeDefined()
    expect(methodNode!.is_default_export).toBeFalsy()
  })

  it('D-11: export = class Foo {} (CJS export =) → is_default_export=false (export = 는 default export 아님)', () => {
    const r = parse('export = class Foo {}')
    const n = r.nodes.find(node => node.name === 'Foo')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBeFalsy()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// CJS: module.exports = ... → is_default_export=true
// ────────────────────────────────────────────────────────────────────────────
describe('CJS: module.exports = ... → is_default_export=true', () => {
  it('D-12: module.exports = class Foo {} → is_default_export=true', () => {
    const r = parse('module.exports = class Foo {}', 'src/test.js')
    const n = r.nodes.find(node => node.name === 'Foo')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-13: module.exports = function myFn() {} → is_default_export=true', () => {
    const r = parse('module.exports = function myFn() {}', 'src/test.js')
    const n = r.nodes.find(node => node.name === 'myFn')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-14: module.exports = function() {} → name=default, is_default_export=true', () => {
    const r = parse('module.exports = function() {}', 'src/test.js')
    const n = r.nodes.find(node => node.name === 'default')
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })

  it('D-15: module.exports = MyClass (identifier) → is_default_export=true', () => {
    const r = parse(`
class MyClass {}
module.exports = MyClass
`, 'src/test.js')
    // identifier 분기 — MyClass 노드 (module.exports 할당으로 재발화됨)
    // exported=true로 발화된 노드를 찾음
    const n = r.nodes.find(node => node.name === 'MyClass' && node.exported === true)
    expect(n).toBeDefined()
    expect(n!.is_default_export).toBe(true)
  })
})
