// common_engine/cjs_ops — 파서-무관 CommonJS require import 헬퍼 (require-side만).
//
// 범위: `require()` 호출 바인딩 추출 + `imports` edge 발화.
// CJS *export* (module.exports / exports.foo / export =) 는 어댑터 node-emission 머신
// (addNode/makeNode/collectCallsFromBody/processExportedClass 등)과 강하게 얽혀 있어
// 엔진으로 옮기지 않는다 (typescript.ts에 잔류). 이 파일은 require import 쪽 4개 함수만 담당.
//
// EngineNode + LanguageSpec(노드타입/필드명/requireFunctionName) 으로 동작 → native/WASM 무관.

import type { CodeEdgeRaw } from '../../types.js'
import type { EngineNode, LanguageSpec } from './types.js'
import { makeEdge } from './edge_ops.js'
import { fileNodeId } from './node_ops.js'
import { stripQuotes } from './shared_utils.js'

export interface RequireBinding {
  specifier: string
  /** Imported (source-module) name. For namespace require (`const m = require(...)`), equals localName. */
  importedName: string
  /** Local binding name in this file. */
  localName: string
  /** True for `const m = require(...)` (whole-module namespace binding). */
  isNamespace: boolean
}


/**
 * Extract CommonJS require bindings from a top-level (lexical|variable)_declaration.
 *   const { getIdParam } = require('../helpers')        → named
 *   const { getIdParam: getId } = require('../helpers') → aliased named
 *   const models = require('../../sequelize')           → namespace
 */
export function collectRequireBindings(node: EngineNode, spec: LanguageSpec): RequireBinding[] {
  if (!spec.constDeclTypes.includes(node.type)) return []
  const bindings: RequireBinding[] = []
  for (const decl of node.children) {
    if (!decl || decl.type !== spec.declaratorType) continue
    const nameNode = decl.childForFieldName(spec.nameField)
    const valueNode = decl.childForFieldName(spec.valueField)
    if (!nameNode || !valueNode) continue
    const specifier = requireCallSpecifier(valueNode, spec)
    if (specifier === null) continue

    if (nameNode.type === spec.identifierType) {
      bindings.push({ specifier, importedName: nameNode.text, localName: nameNode.text, isNamespace: true })
    } else if (nameNode.type === spec.objectPatternType) {
      for (const item of collectObjectPatternBindings(nameNode, spec)) {
        bindings.push({ specifier, importedName: item.importedName, localName: item.localName, isNamespace: false })
      }
    }
  }
  return bindings
}

/** If `node` is `require('literal')`, return the (unquoted) specifier; else null. */
export function requireCallSpecifier(node: EngineNode, spec: LanguageSpec): string | null {
  if (node.type !== spec.callType) return null
  const fn = node.childForFieldName(spec.functionField)
  if (fn?.type !== spec.identifierType || fn.text !== spec.requireFunctionName) return null
  const args = node.childForFieldName(spec.argumentsField)
  if (!args) return null
  const stringArg = args.children.find((c) => c?.type === spec.stringType)
  if (!stringArg) return null
  return stripQuotes(stringArg.text)
}

/** `{ a, b: c }` → [{importedName:'a',localName:'a'},{importedName:'b',localName:'c'}] */
export function collectObjectPatternBindings(
  pattern: EngineNode,
  spec: LanguageSpec,
): { importedName: string; localName: string }[] {
  const out: { importedName: string; localName: string }[] = []
  for (const child of pattern.children) {
    if (!child) continue
    if (child.type === spec.shorthandPropertyPatternType || child.type === spec.identifierType) {
      out.push({ importedName: child.text, localName: child.text })
    } else if (child.type === spec.pairPatternType) {
      const key = child.childForFieldName(spec.keyField)
      const value = child.childForFieldName(spec.valueField)
      if (key && value?.type === spec.identifierType) {
        out.push({ importedName: stripQuotes(key.text), localName: value.text })
      }
    }
  }
  return out
}

/**
 * Emit `imports` edges for CommonJS require bindings, mirroring the named/default
 * ES import edges so F3a resolves them and F5's importResolvedMap can pin calls to
 * the exported target. Only bindings actually referenced in the file are emitted
 * (parity with ES import edge emission, which gates on bodyIdentifiers).
 */
export function emitRequireImportEdges(
  bindings: RequireBinding[],
  repoId: string,
  filePath: string,
  bodyIdentifiers: Set<string>,
  edges: CodeEdgeRaw[],
): void {
  for (const binding of bindings) {
    if (!bodyIdentifiers.has(binding.localName)) continue
    edges.push(makeEdge(repoId, {
      source_id: fileNodeId(repoId, filePath),
      target_id: null,
      relation: 'imports',
      target_specifier: binding.specifier,
      target_symbol: binding.isNamespace ? '*' : binding.importedName,
      target_imported_symbol: binding.isNamespace ? '*' : binding.importedName,
      target_local_symbol: binding.localName,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
    }))
  }
}
