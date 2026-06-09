/**
 * a3 갭 B — processImportStatement 누락 시나리오 회귀 보호
 * SOT: @/pipeline_modules/build_graph/adapters/typescript.ts (L350~465)
 * 실행: npx vitest run tests/pipeline_modules/build_graph/adapters/typescript_a3_gap_b.test.ts
 *
 * 기존 B 블록(11 tests)에서 검증되지 않은 6건 추가:
 *   B-GAP-01: target_local_symbol 명시 검증 (default import)
 *   B-GAP-02: alias case target_imported_symbol === 'Controller' 단언
 *   B-GAP-03: 같은 모듈 다중 import → 다중 엣지 독립 발화
 *   B-GAP-04: named + default 동시 import → 복수 엣지
 *   B-GAP-05: import type statement + 다중 named → 모두 uses_type
 *   B-GAP-06: resolve_status='pending' 전 분기 확인 (named/default/namespace/side-effect)
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

// ── 헬퍼 ──

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'p1') {
  return adapter.parseFile(content, filePath, repoId)
}

// ────────────────────────────────────────────────────────────────────────────
// a3 갭 B — processImportStatement 누락 시나리오
// ────────────────────────────────────────────────────────────────────────────
describe('a3 갭 B — processImportStatement 누락 시나리오', () => {
  // B-GAP-01: target_local_symbol 명시 검증 (default import)
  // B-04는 target_symbol='default'만 확인. 로컬 변수명이 target_local_symbol에 보존되는지 명시 단언.
  it('B-GAP-01 default import → target_local_symbol 에 로컬 변수명 보존', () => {
    const r = parse(`import Axios from 'axios'
export async function f() { return Axios.get('/') }`)
    const e = r.edges.find(e => e.target_symbol === 'default' && e.target_specifier === 'axios')
    expect(e).toBeDefined()
    expect(e!.target_local_symbol).toBe('Axios')
  })

  // B-GAP-02: alias case target_imported_symbol === 'Controller' 명시 단언
  // B-08은 target_symbol==='Ctrl' 존재만 확인. importedName 필드('Controller') 별도 검증.
  it('B-GAP-02 aliased import → target_imported_symbol 이 원본명(Controller)', () => {
    const r = parse(`import { Controller as Ctrl } from '@nestjs/common'
@Ctrl('orders')
export class OrdersCtrl {}`)
    const e = r.edges.find(e => e.target_symbol === 'Ctrl')
    expect(e).toBeDefined()
    expect(e!.target_imported_symbol).toBe('Controller')
  })

  // B-GAP-03: 같은 모듈 다중 import 문 → 각각 독립 엣지 발화
  // 두 import 문에서 동일 target_specifier에 엣지 2개 독립 존재 확인.
  it('B-GAP-03 같은 모듈 다중 import 문 → 엣지 2개 독립 발화', () => {
    const r = parse(`import { A } from './mod'
import { B } from './mod'
export function f() { A(); B() }`)
    const edgesFromMod = r.edges.filter(e => e.target_specifier === './mod' && e.relation === 'imports')
    expect(edgesFromMod.length).toBe(2)
    const symbols = edgesFromMod.map(e => e.target_symbol)
    expect(symbols).toContain('A')
    expect(symbols).toContain('B')
  })

  // B-GAP-04: named + default 동시 import → 복수 엣지 (target_symbol 각각 다름)
  // 하나의 import 문에서 default와 named 공존 → 엣지 2개.
  it('B-GAP-04 named + default 동시 import → 엣지 2개 (default + named)', () => {
    const r = parse(`import DefaultExport, { namedExport } from './mod'
export function f() { DefaultExport(); namedExport() }`)
    const defaultEdge = r.edges.find(e => e.target_symbol === 'default' && e.target_specifier === './mod')
    const namedEdge = r.edges.find(e => e.target_symbol === 'namedExport' && e.target_specifier === './mod')
    expect(defaultEdge).toBeDefined()
    expect(namedEdge).toBeDefined()
    expect(defaultEdge!.relation).toBe('imports')
    expect(namedEdge!.relation).toBe('imports')
  })

  // B-GAP-05: import type statement + 다중 named → 모두 uses_type
  // statement-level type-only → 각 specifier 모두 uses_type relation.
  it('B-GAP-05 import type + 다중 named → 모든 specifier uses_type', () => {
    const r = parse(`import type { A, B } from './types'
export function f(a: A, b: B) { return { a, b } }`)
    const edgeA = r.edges.find(e => e.target_symbol === 'A')
    const edgeB = r.edges.find(e => e.target_symbol === 'B')
    expect(edgeA).toBeDefined()
    expect(edgeB).toBeDefined()
    expect(edgeA!.relation).toBe('uses_type')
    expect(edgeB!.relation).toBe('uses_type')
    expect(edgeA!.target_specifier).toBe('./types')
    expect(edgeB!.target_specifier).toBe('./types')
  })

  // B-GAP-06: resolve_status='pending' 전 분기 확인 (named/default/namespace/side-effect 공통)
  // B-01은 named 분기만 확인. 나머지 분기도 resolve_status='pending' 보장 검증.
  it('B-GAP-06a default import 분기 → resolve_status pending', () => {
    const r = parse(`import Axios from 'axios'
export async function f() { return Axios.get('/') }`)
    const e = r.edges.find(e => e.target_symbol === 'default')
    expect(e!.resolve_status).toBe('pending')
  })

  it('B-GAP-06b namespace import 분기 → resolve_status pending', () => {
    const r = parse(`import * as fs from 'node:fs'
export function f() { return fs.readFileSync('x') }`)
    const e = r.edges.find(e => e.target_symbol === 'fs')
    expect(e!.resolve_status).toBe('pending')
  })

  it('B-GAP-06c side-effect import 분기 → resolve_status pending', () => {
    const r = parse(`import './polyfill'
export const x = 1`)
    const e = r.edges.find(e => e.target_specifier === './polyfill')
    expect(e!.resolve_status).toBe('pending')
  })

  it('B-GAP-06d uses_type 분기 → resolve_status pending', () => {
    const r = parse(`import type { MyType } from './types'
export function f(x: MyType) { return x }`)
    const e = r.edges.find(e => e.target_symbol === 'MyType')
    expect(e!.resolve_status).toBe('pending')
  })
})
