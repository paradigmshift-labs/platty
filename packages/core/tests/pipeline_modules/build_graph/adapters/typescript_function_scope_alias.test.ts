/**
 * Phase A3 — 함수 본문 alias 추적 (FA-01 ~ FA-12)
 *
 * SOT: specs/build_graph/typescript-adapter-fullcoverage.md
 *
 * 패턴:
 *   function f() {
 *     const prisma = getPrismaDB()    // initializer가 import-bound function call
 *     prisma.x.find()                  // chain root='prisma' → getPrismaDB의 specifier로 resolve
 *   }
 *
 * 미니버전 정책:
 *   - chain root identifier가 함수 본문 const일 때 가장 가까운 const 선언을 ascend
 *   - initializer가 call_expression / new_expression / member_expression / identifier일 때 처리
 *   - destructure / literal initializer는 skip (보수적)
 *   - shadowing: 가장 가까운 const 우선
 */

import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'repo1') {
  return adapter.parseFile(content, filePath, repoId)
}

describe('Phase A3 — 함수 본문 alias 추적', () => {
  it('FA-01: function 본문 안 const prisma = getPrismaDB() → prisma.x.find() resolved', () => {
    const r = parse(`
import { getPrismaDB } from './common'
export function f() {
  const prisma = getPrismaDB()
  return prisma.user.find()
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'find',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('./common')
    expect(callsEdge?.chain_path).toBe('prisma.user')
  })

  it('FA-02: method 본문 안 const prisma = getPrismaDB() → prisma chain resolved', () => {
    const r = parse(`
import { getPrismaDB } from './common'
export class Svc {
  async list() {
    const prisma = getPrismaDB()
    return prisma.board.findMany()
  }
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'findMany',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('./common')
  })

  it('FA-03: arrow function 본문 안 alias resolved', () => {
    const r = parse(`
import { getDb } from './common'
export const handler = async () => {
  const db = getDb()
  return db.query('SELECT 1')
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'query',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('./common')
  })

  it('FA-04: const prisma = SGlobal.prismaClient — member chain initializer resolved', () => {
    const r = parse(`
import { SGlobal } from './SGlobal'
export function f() {
  const prisma = SGlobal.prismaClient
  return prisma.x.find()
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'find',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('./SGlobal')
  })

  it('FA-05: const x = 5 (literal initializer) — alias 미등록, edge specifier=null', () => {
    const r = parse(`
export function f() {
  const x = 5
  return x.toString()
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'toString',
    )
    // edge는 발화 (A2-3) but specifier=null (literal)
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBeNull()
  })

  it('FA-06: const x = unknownFn() (initializer 미import) — specifier=null', () => {
    const r = parse(`
export function f() {
  const x = unknownGlobal()
  return x.foo()
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'foo',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBeNull()
  })

  it('FA-07: nested 함수 — outer alias가 inner 침범 안 함', () => {
    const r = parse(`
import { getDb } from './common'
export function outer() {
  const db = getDb()
  function inner() {
    return db.x.find()  // outer의 db 사용
  }
  return inner()
}
`)
    // inner 본문의 db.x.find()도 outer의 alias로 풀려야 함 (가장 가까운 const ascend)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'find',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('./common')
  })

  it('FA-08: shadowing — 가장 가까운 const 우선', () => {
    const r = parse(`
import { getA } from './a'
import { getB } from './b'
export function f() {
  const x = getA()
  function inner() {
    const x = getB()  // shadowing
    return x.foo()    // inner의 x → getB
  }
  return inner()
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'foo',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('./b')
  })

  it('FA-09: const { prisma } = ctx (destructure) — records destructured alias hint', () => {
    const r = parse(`
import { ctx } from './common'
export function f() {
  const { prisma } = ctx
  return prisma.find()
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'find',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('./common')
    expect(callsEdge?.destructured_alias_root).toBe('ctx')
    expect(callsEdge?.destructured_alias_property).toBe('prisma')
  })

  it('FA-10: 모듈 top-level alias는 그대로 (BS-11 회귀 보장)', () => {
    const r = parse(`
import express from 'express'
const app = express()
app.get('/users', () => {})
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'get',
    )
    expect(callsEdge).toBeDefined()
    expect(callsEdge?.target_specifier).toBe('express')
  })

  it('FA-11: heroines_back 패턴 — usecase 안 prisma chain', () => {
    const r = parse(`
import { getPrismaDB } from 'src/common/getPrismaDB'
import { Injectable } from '@nestjs/common'
@Injectable()
export class BoardCommandUsecase {
  async createBoard(input: any) {
    const prisma = getPrismaDB()
    const category = await prisma.boardCategory.findFirst()
    const newBoard = await prisma.board.create({ data: input })
    return { id: newBoard.id }
  }
}
`)
    const findFirst = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'findFirst',
    )
    expect(findFirst?.target_specifier).toBe('src/common/getPrismaDB')
    const create = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'create',
    )
    expect(create?.target_specifier).toBe('src/common/getPrismaDB')
  })

  it('FA-12: identifier alias — const bar = importedFn (no call) → bar()는 importedFn 별칭', () => {
    const r = parse(`
import { foo } from './x'
export function f() {
  const bar = foo
  return bar()
}
`)
    const callsEdge = r.edges.find(
      (e: any) => e.relation === 'calls' && e.target_symbol === 'bar',
    )
    expect(callsEdge).toBeDefined()
    // bar는 함수 본문 alias of foo. specifier 풀림
    expect(callsEdge?.target_specifier).toBe('./x')
  })
})
