// JVM grammar load + EngineNode-contract verification — Phase P4
//
// SOT: specs/build_graph/codegraph-unification-plan.md §5 (P4). Pins the committed
// tree-sitter-java.wasm + tree-sitter-kotlin.wasm as loadable + AST-usable under the project's
// web-tree-sitter, so P5 (the AST rewrite of jvm.ts) builds on a verified foundation and a future
// wasm/web-tree-sitter bump that breaks the ABI (e.g. dylink vs dylink.0) fails RED here.
//
// Verifies the EngineNode contract the engine requires (childForFieldName / namedChildren /
// startPosition) works on real Java + Kotlin parse trees.

import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { Parser, Language } from 'web-tree-sitter'

const WASM_DIR = resolve(process.cwd(), 'src/pipeline_modules/build_graph/adapters/wasm')

let javaLang: Language
let kotlinLang: Language
beforeAll(async () => {
  await Parser.init()
  javaLang = await Language.load(resolve(WASM_DIR, 'tree-sitter-java.wasm'))
  kotlinLang = await Language.load(resolve(WASM_DIR, 'tree-sitter-kotlin.wasm'))
})

function parse(lang: Language, src: string) {
  const p = new Parser()
  p.setLanguage(lang)
  return (p as unknown as { parse(s: string): { rootNode: any } }).parse(src).rootNode
}

function findFirst(node: any, type: string): any {
  if (node.type === type) return node
  for (const c of node.namedChildren) {
    const hit = findFirst(c, type)
    if (hit) return hit
  }
  return null
}

describe('P4: JVM tree-sitter grammars load + satisfy the EngineNode contract', () => {
  it('tree-sitter-java.wasm parses a Spring controller (root=program, no error, name field works)', () => {
    const root = parse(
      javaLang,
      'package com.acme;\nimport org.springframework.web.bind.annotation.RestController;\n@RestController\npublic class UserController {\n  public String getUser(int id) { return repo.findById(id); }\n}',
    )
    expect(root.type).toBe('program')
    expect(root.hasError).toBe(false)
    const cls = findFirst(root, 'class_declaration')
    expect(cls, 'class_declaration node').toBeTruthy()
    expect(cls.childForFieldName('name')?.text).toBe('UserController')
    const method = findFirst(cls, 'method_declaration')
    expect(method?.childForFieldName('name')?.text).toBe('getUser')
    expect(typeof cls.startPosition.row).toBe('number')
  })

  it('tree-sitter-kotlin.wasm parses a service class (root=source_file, class + name resolvable)', () => {
    const root = parse(
      kotlinLang,
      'package com.acme\nclass BillingService {\n  fun charge(amount: Int): Int { return gateway.process(amount) }\n}',
    )
    expect(root.type).toBe('source_file')
    const cls = findFirst(root, 'class_declaration')
    expect(cls, 'class_declaration node').toBeTruthy()
    // Kotlin class name resolves either via the name field or a child identifier (LanguageSpec/resolveName hook absorbs the divergence).
    const clsName = cls.childForFieldName('name')?.text ?? cls.namedChildren.find((c: any) => c.type === 'identifier' || c.type === 'type_identifier')?.text
    expect(clsName).toBe('BillingService')
    const fn = findFirst(cls, 'function_declaration')
    expect(fn?.childForFieldName('name')?.text).toBe('charge')
  })
})
