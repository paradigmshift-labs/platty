/**
 * TypeScriptParserAdapter — tree-sitter 기반 TypeScript/TSX 파서 어댑터
 * SOT: specs/phase3/specs/f2_parse_pass1/spec.md §3
 */

// Parser는 타입 전용 import (런타임 native 바인딩 미로딩 — Electron 패키징용 WASM 전환의 핵심).
// SyntaxNode 등 노드 타입만 사용하며, 실제 파싱은 web-tree-sitter(WASM)로 한다.
import type Parser from 'tree-sitter'
import ts from 'typescript'
import { Parser as WasmParser, Language as WasmLanguage } from 'web-tree-sitter'
import { fileURLToPath } from 'node:url'
import * as nodePath from 'node:path'
import * as nodeFs from 'node:fs'
import type {
  ParserAdapter,
  CodeNodeRaw,
  CodeEdgeRaw,
  CallArgExpression,
  ConstructorParam,
  CodeNodeType,
  EdgeRelation,
  FieldOrigin,
  FieldOriginsMap,
} from '../types.js'
import { computeNormalizedCodeHash, sliceLinesForHash } from '../normalized_code_hash.js'
import { TS_LANGUAGE_SPEC } from './common_engine/types.js'
import {
  nodeId as engineNodeId,
  fileNodeId as engineFileNodeId,
  collectAllIdentifiers as engineCollectAllIdentifiers,
  collectIdentifiersInNode as engineCollectIdentifiersInNode,
  collectDestructuringBindings as engineCollectDestructuringBindings,
  isNestedExecutableNode as engineIsNestedExecutableNode,
  emptyFallbackParseResult as engineEmptyFallbackParseResult,
  callTargetName as engineCallTargetName,
  extractStaticishExpressionText as engineExtractStaticishExpressionText,
  isAsyncNode as engineIsAsyncNode,
  getAccessibility as engineGetAccessibility,
} from './common_engine/node_ops.js'
import { makeEdge as engineMakeEdge, buildContainsEdge as engineBuildContainsEdge, walkIdentifiersForDependsOn as engineWalkIdentifiersForDependsOn, emitDataCallbackReferenceCalls as engineEmitDataCallbackReferenceCalls } from './common_engine/edge_ops.js'
import {
  BUILTIN_TYPE_NAMES,
  isLocalImportSpecifier,
  resolveTypeOrigin as engineResolveTypeOrigin,
  recordFieldOrigin as engineRecordFieldOrigin,
  extractTypeIdentifierName as engineExtractTypeIdentifierName,
  inferFieldOrigin as engineInferFieldOrigin,
  type FieldOriginCtx,
} from './common_engine/field_origin_ops.js'
import { getDefaultImport as engineGetDefaultImport, getNamespaceImport as engineGetNamespaceImport } from './common_engine/import_ops.js'
import { shouldRecordRenderTarget as ceShouldRecordRenderTarget } from './common_engine/render_ops.js'
import { extractFunctionSignature as engineExtractFunctionSignature } from './common_engine/signature_ops.js'
import { buildClassHeritageEdges as engineBuildClassHeritageEdges } from './common_engine/heritage_ops.js'
import { extractDecoratorDependencies as engineExtractDecoratorDependencies } from './common_engine/decorator_deps_ops.js'
import { emitMemberDecorators, emitMemberNodeAndContains, processClassBody as engineProcessClassBody, type DecoratorDescriptor, type MemberKind } from './common_engine/declaration_walker.js'
import {
  collectRequireBindings as engineCollectRequireBindings,
  requireCallSpecifier as engineRequireCallSpecifier,
  collectObjectPatternBindings as engineCollectObjectPatternBindings,
  emitRequireImportEdges as engineEmitRequireImportEdges,
  type RequireBinding,
} from './common_engine/cjs_ops.js'
import {
  extractChainPath as ceExtractChainPath,
  unwrapCallFunction as ceUnwrapCallFunction,
  findChainRootIdentifier as ceFindChainRootIdentifier,
  isChainRootedAtThis as ceIsChainRootedAtThis,
  getRootObject as ceGetRootObject,
  addModuleLocalAliases as ceAddModuleLocalAliases,
} from './common_engine/chain_extractor.js'
import {
  makeCallExtractor,
  MAX_STRING_LENGTH,
  MAX_LITERAL_ARGS_LENGTH,
} from './common_engine/call_extractor.js'
import type { LiteralObject } from './common_engine/call_extractor.js'
import { getDecoratorInfo as hookGetDecoratorInfo } from './typescript_hooks/decorator.js'
import { sameNode, stripQuotes, collectTypeIdentifiers, firstChildOfType as findChildOfType } from './common_engine/shared_utils.js'
import { addNode as engineAddNode } from './common_engine/node_factory_ops.js'
import { walkCallsAndNestedExecutables as engineWalkCallsAndNestedExecutables, type LanguageHooks } from './common_engine/walk_engine.js'
import {
  extractCallEdge as engineExtractCallEdge,
  type CallEdgeCtx,
} from './common_engine/call_edge_ops.js'

// call argument 추출은 common_engine/call_extractor 로 이동 (TS_LANGUAGE_SPEC 바인딩).
// 외부(scripts/generate-ts-lsp-build-graph-expected.ts, tests)가 import → extractCallArgs re-export 유지.
const tsCallExtractor = makeCallExtractor(TS_LANGUAGE_SPEC)
const { extractLiteralValue, normalizeObjectPropertyKey } = tsCallExtractor
export const extractCallArgs = tsCallExtractor.extractCallArgs

// ── WASM 파서 초기화 (web-tree-sitter) ──
// Parser.init() + Language.load()는 비동기·1회만. 파일마다 재init 금지 → module-level 캐시 promise.
function resolveTsWasmPath(name: 'tree-sitter-typescript' | 'tree-sitter-tsx'): string {
  try {
    const thisFile = fileURLToPath(import.meta.url)
    const candidate = nodePath.resolve(nodePath.dirname(thisFile), 'wasm', `${name}.wasm`)
    if (nodeFs.existsSync(candidate)) return candidate
  } catch {
    // import.meta.url 접근 불가 환경 → fallback
  }
  return nodePath.resolve(process.cwd(), `src/pipeline_modules/build_graph/adapters/wasm/${name}.wasm`)
}

interface TsWasmParsers {
  tsParser: WasmParser
  tsxParser: WasmParser
}

let tsWasmParsersPromise: Promise<TsWasmParsers> | null = null
function initTsWasmParsers(): Promise<TsWasmParsers> {
  if (!tsWasmParsersPromise) {
    tsWasmParsersPromise = (async () => {
      await WasmParser.init()
      const tsLang = await WasmLanguage.load(resolveTsWasmPath('tree-sitter-typescript'))
      const tsxLang = await WasmLanguage.load(resolveTsWasmPath('tree-sitter-tsx'))
      const tsParser = new WasmParser()
      tsParser.setLanguage(tsLang)
      const tsxParser = new WasmParser()
      tsxParser.setLanguage(tsxLang)
      return { tsParser, tsxParser }
    })()
  }
  return tsWasmParsersPromise
}

// 모듈 로드 시 1회 eager init (ESM top-level await). parseFile은 sync 유지 →
// 기존 호출부(new TypeScriptParserAdapter() + sync parseFile, 41개 unit test 등) 전부 무변경.
// 파일마다 재init 금지 — module 싱글톤 캐시.
const TS_WASM_PARSERS: TsWasmParsers = await initTsWasmParsers()

// ── 내부 헬퍼 타입 ──

interface FileParseResult {
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  constructorParams: { className: string; params: ConstructorParam[] }[]
  enumValues: Map<string, string>
  fieldOrigins?: FieldOriginsMap
}

interface NamedImportSpecifier {
  localName: string
  importedName: string
  isTypeOnly: boolean
}

// ── TypeScriptParserAdapter ──

export class TypeScriptParserAdapter implements ParserAdapter {
  private parsers: TsWasmParsers

  // 기본은 모듈 로드 시 eager init된 WASM 파서. create()로 명시 주입도 가능. 파일마다 재init 안 함.
  constructor(parsers: TsWasmParsers = TS_WASM_PARSERS) {
    this.parsers = parsers
  }

  /** 명시적 async 초기화 진입점(프로덕션/Electron). 모듈 TLA로 이미 init되어 즉시 반환. */
  static async create(): Promise<TypeScriptParserAdapter> {
    return new TypeScriptParserAdapter(await initTsWasmParsers())
  }

  supportedExtensions(): string[] {
    return ['.ts', '.tsx', '.js', '.jsx', '.mdx', '.vue', '.svelte', '.astro']
  }

  parseFile(
    content: string,
    filePath: string,
    repoId: string,
  ): FileParseResult {
    const { tsParser, tsxParser } = this.parsers
    const ext = filePath.match(/\.[^.]+$/)?.[0] ?? '.ts'
    const parser = ext === '.ts' ? tsParser : tsxParser
    // WASM Node → native Parser.SyntaxNode 타입 (PROBE 검증된 구조적 호환). walk 코드는 동일.
    const parseRoot = (src: string): Parser.SyntaxNode => {
      const t = parser.parse(src)
      if (!t) throw new Error('Syntax error: parser returned no tree')
      return t.rootNode as unknown as Parser.SyntaxNode
    }

    const root = parseRoot(content)

    // ERROR 노드 감지
    if (hasErrorNode(root)) {
      // JSX 텍스트 내 raw & 로 인한 ERROR만 있는 경우 자동 수정 후 재파싱
      const fixed = fixJsxAmpersandErrors(root, content)
      if (fixed !== content) {
        const r2 = parseRoot(fixed)
        if (!hasErrorNode(r2)) {
          return parseTree(r2, filePath, repoId, fixed)
        }
        // 재파싱 후에도 에러면 TypeScript compiler AST fallback이 유효한 TSX인지 최종 판단한다.
      }
      if (ext === '.mdx') {
        const mdxEsm = extractMdxEsmPrefix(content)
        if (mdxEsm !== content) {
          const r2 = parseRoot(mdxEsm)
          if (!hasErrorNode(r2)) {
            return parseTree(r2, filePath, repoId, mdxEsm)
          }
        }
      }
      const fallback = parseWithTypeScriptCompilerAst(content, filePath, repoId)
      if (fallback.nodes.length > 0) return fallback
      const errLine = findFirstErrorLine(root)
      throw new Error(`Syntax error at line ${errLine}`)
    }

    return parseTree(root, filePath, repoId, content)
  }
}

/**
 * ERROR 노드 중 텍스트가 & 로 시작하는 것(JSX 텍스트 내 raw &)만 찾아
 * 해당 바이트 오프셋의 & 를 &amp; 로 치환한다.
 * tree-sitter 오프셋 기반이므로 TypeScript 비교 연산자(>=, <=)와 충돌 없음.
 */
function fixJsxAmpersandErrors(root: Parser.SyntaxNode, content: string): string {
  const ranges: { start: number; end: number }[] = []
  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'ERROR' && node.text.startsWith('&')) {
      ranges.push({ start: node.startIndex, end: node.endIndex })
    }
    for (const child of node.children) walk(child)
  }
  walk(root)

  if (ranges.length === 0) return content

  // 뒤에서부터 처리해야 앞쪽 오프셋이 밀리지 않음
  let result = content
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { start, end } = ranges[i]
    const errorSpan = result.slice(start, end)
    // ERROR 스팬 내 모든 & → &amp; (&&도 처리됨)
    const fixed = errorSpan.replace(/&/g, '&amp;')
    result = result.slice(0, start) + fixed + result.slice(end)
  }
  return result
}

function extractMdxEsmPrefix(content: string): string {
  const lines = content.split('\n')
  const kept: string[] = []
  let depth = 0
  let inStatement = false

  for (const line of lines) {
    const trimmed = line.trim()
    const startsEsm = /^(import|export)\b/.test(trimmed)
    if (!inStatement && trimmed !== '' && !startsEsm) break

    kept.push(line)
    if (trimmed === '') continue

    inStatement = true
    depth += countCharsOutsideLineComment(line, '(', '[', '{')
    depth -= countCharsOutsideLineComment(line, ')', ']', '}')
    if (depth <= 0 && !/[,{[(]$/.test(trimmed)) {
      depth = 0
      inStatement = false
    }
  }

  if (kept.length === lines.length) return content
  return [
    ...kept,
    ...Array.from({ length: lines.length - kept.length }, () => ''),
  ].join('\n')
}

function countCharsOutsideLineComment(line: string, ...chars: string[]): number {
  const source = line.split('//')[0] ?? line
  let count = 0
  for (const ch of source) {
    if (chars.includes(ch)) count++
  }
  return count
}

function parseWithTypeScriptCompilerAst(
  content: string,
  filePath: string,
  repoId: string,
): FileParseResult {
  if (content.includes('\0') || content.includes('!!invalid')) return emptyFallbackParseResult()
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX :
      filePath.endsWith('.jsx') ? ts.ScriptKind.JSX :
      filePath.endsWith('.js') ? ts.ScriptKind.JS :
      ts.ScriptKind.TS,
  )
  if (((sourceFile as any).parseDiagnostics?.length ?? 0) > 0) return emptyFallbackParseResult()
  const nodes: CodeNodeRaw[] = []
  const sourceLines = content.split('\n')

  function addNode(type: CodeNodeType, name: string, node: ts.Node, exported: boolean, isDefaultExport = false): void {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
    const lineStart = pos.line + 1
    const lineEnd = end.line + 1
    const slice = sliceLinesForHash(sourceLines, lineStart, lineEnd)
    nodes.push({
      id: `${repoId}:${filePath}:${name}`,
      repo_id: repoId,
      type,
      file_path: filePath,
      name,
      line_start: lineStart,
      line_end: lineEnd,
      signature: null,
      exported,
      is_default_export: isDefaultExport || undefined,
      parse_status: 'ok',
      is_test: false,
      test_type: null,
      is_async: isAsyncTsNode(node),
      jsdoc: null,
      leading_comment: null,
      normalized_code_hash: slice === null ? null : computeNormalizedCodeHash(slice),
    })
  }

  function exported(node: ts.Node): boolean {
    const flags = ts.getCombinedModifierFlags(node as ts.Declaration)
    return Boolean(flags & ts.ModifierFlags.Export)
  }

  function defaultExported(node: ts.Node): boolean {
    const flags = ts.getCombinedModifierFlags(node as ts.Declaration)
    return Boolean(flags & ts.ModifierFlags.Default)
  }

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      addNode('function', stmt.name.text, stmt, exported(stmt), defaultExported(stmt))
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      addNode('class', stmt.name.text, stmt, exported(stmt), defaultExported(stmt))
      for (const member of stmt.members) {
        if ((ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name && ts.isIdentifier(member.name)) {
          addNode(
            ts.isMethodDeclaration(member) ? 'method' : 'property',
            `${stmt.name.text}.${member.name.text}`,
            member,
            exported(stmt),
          )
        }
      }
    } else if (ts.isInterfaceDeclaration(stmt)) {
      addNode('interface', stmt.name.text, stmt, exported(stmt))
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      addNode('type', stmt.name.text, stmt, exported(stmt))
    } else if (ts.isEnumDeclaration(stmt)) {
      addNode('enum', stmt.name.text, stmt, exported(stmt))
    } else if (ts.isVariableStatement(stmt)) {
      const isExported = exported(stmt)
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        addNode(isFunctionVariableInitializerTs(decl.initializer) ? 'function' : 'variable', decl.name.text, decl, isExported)
      }
    }
  }

  return {
    nodes,
    edges: [],
    constructorParams: [],
    enumValues: new Map(),
    fieldOrigins: new Map(),
  }
}

// emptyFallbackParseResult → common_engine/node_ops.ts (engine_a 순수 factory).
function emptyFallbackParseResult(): FileParseResult {
  return engineEmptyFallbackParseResult()
}

function isFunctionVariableInitializerTs(initializer: ts.Expression | undefined): boolean {
  if (!initializer) return false
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return true
  if (!ts.isCallExpression(initializer)) return false
  if (ts.isIdentifier(initializer.expression) && isKnownFunctionWrapperName(initializer.expression.text)) {
    return initializer.arguments.some((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))
  }
  return false
}

function isAsyncTsNode(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Async)
}

// ── ERROR 노드 탐지 ──

function hasErrorNode(node: Parser.SyntaxNode): boolean {
  if (node.type === 'ERROR' || node.isMissing) return true
  for (const child of node.children) {
    if (hasErrorNode(child)) return true
  }
  return false
}

function findFirstErrorLine(node: Parser.SyntaxNode): number {
  if (node.type === 'ERROR' || node.isMissing) {
    return node.startPosition.row + 1
  }
  for (const child of node.children) {
    const found = findFirstErrorLine(child)
    if (found > 0) return found
  }
  return 0
}

// ── 메인 파싱 로직 ──

interface ParseContext {
  filePath: string
  repoId: string
  nodes: CodeNodeRaw[]
  edges: CodeEdgeRaw[]
  constructorParams: { className: string; params: ConstructorParam[] }[]
  enumValues: Map<string, string>
  bodyIdentifiers: Set<string>
  // JSDoc 캐시: AST 노드의 바로 위 주석
  sourceLines: string[]
  // importSymbolMap: 심볼명 → 패키지/경로 (decorator target_specifier 조회용)
  importSymbolMap: Map<string, string>
  // P15-Lite: classKey({repoId}:{filePath}:{ClassOrNs}) → fieldName → origin
  fieldOrigins: FieldOriginsMap
  // 같은 file 안 class/interface 정의 식별 (RHS=new InternalX 추적용)
  localClassNames: Set<string>
  // 현재 처리 중 class/namespace의 classKey — RHS=this.X 같은 class self field origin lookup용
  currentClassKey: string | null
  visitedNestedExecutableRanges: Set<string>
}

function buildImportSymbolMap(root: Parser.SyntaxNode): Map<string, string> {
  const map = new Map<string, string>()
  for (const child of root.children) {
    if (child.type === 'import_statement') {
      const sourceNode = child.childForFieldName('source') ?? findChildOfType(child, 'string')
      if (!sourceNode) continue
      const specifier = stripQuotes(sourceNode.text)
      const importClause = findChildOfType(child, 'import_clause')
      if (!importClause) continue
      const namedImports = collectNamedImportSpecifiers(importClause, false)
      for (const item of namedImports) {
        map.set(item.localName, specifier)
      }
      const defaultImport = getDefaultImport(importClause)
      if (defaultImport) map.set(defaultImport, specifier)
      const namespaceImport = getNamespaceImport(importClause)
      if (namespaceImport) map.set(namespaceImport, specifier)
      continue
    }
    // CommonJS interop: `const { x } = require('./mod')`, `const x = require('./mod')`.
    // Mirror ES named/default imports so cross-module call resolution (F3a/F5) can
    // bind the local symbol to the module specifier instead of falling back to the
    // nearest in-file (import-binding) variable node.
    for (const binding of collectRequireBindings(child)) {
      map.set(binding.localName, binding.specifier)
    }
  }
  return map
}

// CJS require-side helpers extracted to common_engine/cjs_ops.ts.
// Thin wrappers preserve call-site signatures (node-only / bindings+ctx) and
// inject TS_LANGUAGE_SPEC + unpacked ctx fields.
function collectRequireBindings(node: Parser.SyntaxNode): RequireBinding[] {
  return engineCollectRequireBindings(node, TS_LANGUAGE_SPEC)
}

function requireCallSpecifier(node: Parser.SyntaxNode): string | null {
  return engineRequireCallSpecifier(node, TS_LANGUAGE_SPEC)
}

function collectObjectPatternBindings(
  pattern: Parser.SyntaxNode,
): { importedName: string; localName: string }[] {
  return engineCollectObjectPatternBindings(pattern, TS_LANGUAGE_SPEC)
}

function emitRequireImportEdges(bindings: RequireBinding[], ctx: ParseContext): void {
  engineEmitRequireImportEdges(bindings, ctx.repoId, ctx.filePath, ctx.bodyIdentifiers, ctx.edges)
}

/**
 * BS-11 — module-level variable alias 추적.
 *
 * 패턴:
 *   const app = express()              → app → 'express'
 *   const router = Router()             → router → '<Router specifier>'
 *   const fastify = Fastify({ ... })   → fastify → '<Fastify specifier>'
 *   const app = new Hono()              → app → '<Hono specifier>' (new expression)
 *
 * Express/Hono/Fastify/Koa 등의 흔한 부트스트랩 패턴이 V1엔 미처리 → calls edge 누락.
 * 단순 case만 처리: top-level const/let의 initializer가
 *   - call_expression (import-bound function 호출)
 *   - new_expression (import-bound class 생성자)
 *   - member_expression (import-bound module의 property)
 * 일 때 변수를 import specifier에 매핑.
 *
 * importSymbolMap에 직접 add (같은 map 공유).
 */
function addModuleLocalAliases(root: Parser.SyntaxNode, map: Map<string, string>): void {
  ceAddModuleLocalAliases(root, map, TS_LANGUAGE_SPEC)
}

function parseTree(
  root: Parser.SyntaxNode,
  filePath: string,
  repoId: string,
  content: string,
): FileParseResult {
  const importSymbolMap = buildImportSymbolMap(root)
  addModuleLocalAliases(root, importSymbolMap)  // BS-11 — const app = express() 같은 alias
  const ctx: ParseContext = {
    filePath,
    repoId,
    nodes: [],
    edges: [],
    constructorParams: [],
    enumValues: new Map(),
    bodyIdentifiers: new Set(),
    sourceLines: content.split('\n'),
    importSymbolMap,
    fieldOrigins: new Map(),
    localClassNames: collectLocalClassNames(root),
    currentClassKey: null,
    visitedNestedExecutableRanges: new Set(),
  }

  collectAllIdentifiers(root, ctx.bodyIdentifiers)

  for (const child of root.children) {
    processTopLevelNode(child, ctx)
  }

  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    constructorParams: ctx.constructorParams,
    enumValues: ctx.enumValues,
    fieldOrigins: ctx.fieldOrigins,
  }
}

// hashNodeSource + addNode 는 common_engine/node_factory_ops.ts 로 이동 (walk-engine S1).
// node factory 의 dedup/export-promotion/hash 규칙을 언어 무관하게 공유한다.

// P15-Lite: 같은 file 안 정의된 class/interface 이름 수집 (RHS=new InternalX 분석용)
function collectLocalClassNames(root: Parser.SyntaxNode): Set<string> {
  const set = new Set<string>()
  function walk(node: Parser.SyntaxNode) {
    if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name')
      if (nameNode) set.add(nameNode.text)
    }
    for (const c of node.children) walk(c)
  }
  walk(root)
  return set
}

// P15-Lite: field 또는 namespace export의 RHS/annotation에서 origin 추론
//   우선순위: type annotation → RHS new X → RHS member access → RHS arrow fn → RHS literal
// S5 추출: field-origin 추론 3종(inferFieldOrigin/inferOriginFromExpression/inferOriginFromCallExpression)
// + extractFirstThisFieldSegment 은 common_engine/field_origin_ops.ts 로 이동.
// inferFieldOrigin 만 외부 호출부(processFieldDefinition 등)가 있어 thin wrapper 유지.
function inferFieldOrigin(
  typeAnn: Parser.SyntaxNode | null,
  initializer: Parser.SyntaxNode | null,
  ctx: ParseContext,
): FieldOrigin {
  const fctx: FieldOriginCtx = {
    localClassNames: ctx.localClassNames,
    importSymbolMap: ctx.importSymbolMap,
    fieldOrigins: ctx.fieldOrigins,
    currentClassKey: ctx.currentClassKey,
  }
  return engineInferFieldOrigin(typeAnn ?? null, initializer ?? null, fctx, TS_LANGUAGE_SPEC)
}

function resolveTypeOrigin(typeName: string, ctx: ParseContext): FieldOrigin {
  return engineResolveTypeOrigin(typeName, ctx.localClassNames, ctx.importSymbolMap)
}

// isLocalImportSpecifier → common_engine/field_origin_ops.ts (S1.2 추출, import).
// (@/ 외 커스텀 alias[@app/ 등]는 tsconfig pathAliases plumbing 후속 = #18.)

// extractTypeIdentifierName → common_engine/field_origin_ops.ts (S2 추출, import).
function extractTypeIdentifierName(typeAnn: Parser.SyntaxNode): string | null {
  return engineExtractTypeIdentifierName(typeAnn, TS_LANGUAGE_SPEC)
}

// BUILTIN_TYPE_NAMES → common_engine/field_origin_ops.ts (S1.2 추출, import).

function recordFieldOrigin(
  ctx: ParseContext,
  classOrNsName: string,
  fieldName: string,
  origin: FieldOrigin,
): void {
  engineRecordFieldOrigin(ctx.fieldOrigins, engineNodeId(ctx.repoId, ctx.filePath, classOrNsName), fieldName, origin)
}

// ── identifier 수집 (import 문 제외) ──

function collectAllIdentifiers(
  root: Parser.SyntaxNode,
  identifiers: Set<string>,
): void {
  engineCollectAllIdentifiers(root, identifiers, TS_LANGUAGE_SPEC)
}

function collectIdentifiersInNode(
  node: Parser.SyntaxNode,
  identifiers: Set<string>,
): void {
  engineCollectIdentifiersInNode(node, identifiers, TS_LANGUAGE_SPEC)
}

// ── 최상위 노드 처리 ──

function processTopLevelNode(node: Parser.SyntaxNode, ctx: ParseContext): void {
  switch (node.type) {
    case 'import_statement':
      processImportStatement(node, ctx)
      break
    case 'export_statement':
      processExportStatement(node, ctx)
      break
    case 'ambient_declaration':
      break
    case 'enum_declaration':
      processExportedEnum(node, ctx, false)
      collectEnumValues(node, ctx)
      break
    case 'function_declaration':
      processExportedFunction(node, ctx, false)
      break
    case 'class_declaration':
    case 'abstract_class_declaration':
      processExportedClass(node, ctx, false)
      break
    case 'interface_declaration':
      processExportedInterface(node, ctx, false)
      break
    case 'type_alias_declaration':
      processExportedTypeAlias(node, ctx, false)
      break
    case 'expression_statement': {
      const expr = node.firstChild
      if (expr?.type === 'assignment_expression') {
        const left = expr.childForFieldName('left')
        const right = expr.childForFieldName('right')
        if (left?.text === 'module.exports') {
          processModuleExportsAssignment(right, ctx)
        } else if (left?.type === 'member_expression') {
          processCommonJsMemberAssignment(left, right, ctx)
        }
      }
      // BS-11 — top-level call_expression (예: app.get(), router.use(), Module.bootstrap())
      // file 노드를 source로 calls edge. Express/Hono/Fastify 등 부트스트랩 패턴 핵심.
      collectCallsFromBody(node, ctx, fileNodeId(ctx))
      break
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      // CommonJS interop: emit `imports` edges for `const { x } = require('./mod')`
      // (and `const m = require('./mod')`) so F3a can resolve them cross-module,
      // symmetric to ES `import { x } from './mod'`. Suppresses the misleading
      // local import-binding `variable` node so F5 resolves calls to the export.
      const requireBindings = collectRequireBindings(node)
      emitRequireImportEdges(requireBindings, ctx)
      const suppressedRequireLocals = new Set(requireBindings.map((b) => b.localName))
      processExportedVariable(node, ctx, false, suppressedRequireLocals)
      // BS-11 — module-level (non-export) const x = chain() 처리.
      // 예: const app = new Hono().get('/x').post('/x')
      // A2-4 — 객체/배열 initializer 안 화살표 함수 본문도 walk (Apollo resolvers, config object, etc.)
      // source_id는 file 노드 (변수 자체 노드는 non-export라 안 만들어짐)
      for (const decl of node.children) {
        if (decl.type !== 'variable_declarator') continue
        const value = decl.childForFieldName('value')
        if (!value) continue
        if (value.type === 'call_expression' || value.type === 'new_expression' ||
            value.type === 'object' || value.type === 'array') {
          collectCallsFromBody(value, ctx, fileNodeId(ctx))
        }
      }
      break
    }
    default:
      break
  }
}

// ── import_statement 처리 ──

function processImportStatement(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
): void {
  const isType = node.children.some(
    (c) => (c.type === 'type' || c.text === 'type') && c.type !== 'identifier',
  )

  const sourceNode = node.childForFieldName('source') ?? findChildOfType(node, 'string')
  if (!sourceNode) return
  const specifier = stripQuotes(sourceNode.text)

  const importClause = findChildOfType(node, 'import_clause')

  if (!importClause) {
    if (isType) return
    ctx.edges.push(makeEdge(ctx, {
      source_id: fileNodeId(ctx),
      target_id: null,
      relation: 'imports',
      target_specifier: specifier,
      target_symbol: null,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
    }))
    return
  }

  const namedImports = collectNamedImportSpecifiers(importClause, isType)
  const defaultImport = getDefaultImport(importClause)
  const namespaceImport = getNamespaceImport(importClause)
  const clauseRelation: EdgeRelation = isType ? 'uses_type' : 'imports'
  for (const item of namedImports) {
    if (!ctx.bodyIdentifiers.has(item.localName)) continue
    const relation: EdgeRelation = item.isTypeOnly ? 'uses_type' : 'imports'
    ctx.edges.push(makeEdge(ctx, {
      source_id: fileNodeId(ctx),
      target_id: null,
      relation,
      target_specifier: specifier,
      target_symbol: item.localName,
      target_imported_symbol: item.importedName,
      target_local_symbol: item.localName,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
      type_ref_subtype: relation === 'uses_type' ? 'import' : null,
    }))
  }

  if (defaultImport && ctx.bodyIdentifiers.has(defaultImport)) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: fileNodeId(ctx),
      target_id: null,
      relation: clauseRelation,
      target_specifier: specifier,
      target_symbol: 'default',
      target_imported_symbol: 'default',
      target_local_symbol: defaultImport,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
      type_ref_subtype: clauseRelation === 'uses_type' ? 'import' : null,
    }))
  }

  if (namespaceImport && ctx.bodyIdentifiers.has(namespaceImport)) {
    ctx.edges.push(makeEdge(ctx, {
      source_id: fileNodeId(ctx),
      target_id: null,
      relation: clauseRelation,
      target_specifier: specifier,
      target_symbol: namespaceImport,
      target_imported_symbol: '*',
      target_local_symbol: namespaceImport,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
      type_ref_subtype: clauseRelation === 'uses_type' ? 'import' : null,
    }))
  }
}

function collectNamedImportSpecifiers(
  importClause: Parser.SyntaxNode,
  statementIsTypeOnly: boolean,
): NamedImportSpecifier[] {
  const names: NamedImportSpecifier[] = []
  const namedImports = findChildOfType(importClause, 'named_imports')
  if (!namedImports) return names
  for (const child of namedImports.children) {
    if (child.type === 'import_specifier') {
      const aliasNode = child.childForFieldName('alias')
      const nameNode = child.childForFieldName('name')
      const imported = nameNode?.text
      const local = aliasNode?.text ?? imported
      if (imported && local && imported !== 'type') {
        const specifierIsTypeOnly = statementIsTypeOnly || child.children.some(
          (c) => (c.type === 'type' || c.text === 'type') && c.type !== 'identifier',
        )
        names.push({ localName: local, importedName: imported, isTypeOnly: specifierIsTypeOnly })
      }
    }
  }
  return names
}

function getDefaultImport(importClause: Parser.SyntaxNode): string | null {
  return engineGetDefaultImport(importClause, TS_LANGUAGE_SPEC)
}

function getNamespaceImport(importClause: Parser.SyntaxNode): string | null {
  return engineGetNamespaceImport(importClause, TS_LANGUAGE_SPEC)
}

// ── export_statement 처리 ──

function processExportStatement(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
): void {
  // CJS interop: export = ...
  const eqSign = node.children.find((c) => c.text === '=')
  if (eqSign) {
    processCJSExportAssignment(node, ctx)
    return
  }

  // export default ...
  if (node.children.some((c) => c.type === 'default' || c.text === 'default')) {
    processExportDefault(node, ctx)
    return
  }

  // re-export with source string
  const clauseSource = findChildOfType(node, 'string')
  if (clauseSource) {
    const specifier = stripQuotes(clauseSource.text)
    processReExport(node, ctx, specifier)
    return
  }

  // local named export { x }
  const exportClause = findChildOfType(node, 'export_clause')
  const hasDeclaration = node.children.some((c) =>
    [
      'class_declaration', 'function_declaration', 'variable_declaration',
      'lexical_declaration', 'interface_declaration', 'type_alias_declaration',
      'enum_declaration', 'abstract_class_declaration', 'internal_module',
      'module_declaration', 'ambient_declaration',
    ].includes(c.type),
  )

  if (exportClause && !hasDeclaration) {
    processLocalNamedExport(exportClause, ctx)
    return
  }

  for (const child of node.children) {
    switch (child.type) {
      case 'class_declaration':
      case 'abstract_class_declaration':
        processExportedClass(child, ctx, true, node)
        break
      case 'function_declaration':
        processExportedFunction(child, ctx, true)
        break
      case 'lexical_declaration':
      case 'variable_declaration':
        processExportedVariable(child, ctx)
        break
      case 'interface_declaration':
        processExportedInterface(child, ctx)
        break
      case 'type_alias_declaration':
        processExportedTypeAlias(child, ctx)
        break
      case 'enum_declaration':
        processExportedEnum(child, ctx)
        break
      case 'internal_module': {
        const isDeclare = node.children.some((c) => c.text === 'declare')
        if (!isDeclare) processExportedNamespace(child, ctx)
        break
      }
      case 'ambient_declaration':
        break
    }
  }

  collectDecoratorsFromExport(node, ctx)
}

// ── CJS interop (export = class Foo) ──

function processCJSExportAssignment(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
): void {
  const eqIdx = node.children.findIndex((c) => c.text === '=')
  if (eqIdx === -1) return
  for (let i = eqIdx + 1; i < node.children.length; i++) {
    const child = node.children[i]
    if (child.type === 'class' || child.type === 'class_declaration') {
      processExportedClass(child, ctx, true, node)
      return
    }
    if (child.type === 'function' || child.type === 'function_declaration' || child.type === 'function_expression') {
      const nameNode = child.childForFieldName('name') ?? findChildOfType(child, 'identifier')
      const name = nameNode?.text ?? 'default'
      addNode(ctx, makeNode(ctx, name, 'function', child, true,
        extractFunctionSignature(child), isAsyncNode(child), extractJSDoc(child, ctx)))
      collectCallsFromBody(child, ctx, nodeId(ctx, name))
      return
    }
    if (child.type === 'identifier') {
      addNode(ctx, makeNode(ctx, child.text, 'variable', child, true, null, false, null))
      return
    }
  }
}

// ── export default ──

function processExportDefault(
  exportNode: Parser.SyntaxNode,
  ctx: ParseContext,
): void {
  for (const child of exportNode.children) {
    switch (child.type) {
      case 'function_declaration':
      case 'function': {
        const nameNode = child.childForFieldName('name') ??
          findChildOfType(child, 'type_identifier') ??
          findChildOfType(child, 'identifier')
        const name = nameNode?.text ?? 'default'
        const sig = extractFunctionSignature(child)
        addNode(ctx, makeNode(ctx, name, 'function', child, true, sig,
          isAsyncNode(child), extractJSDoc(child, ctx), true))
        collectCallsFromBody(child, ctx, nodeId(ctx, name))
        break
      }
      case 'class_declaration':
      case 'abstract_class_declaration':
      case 'class': {
        const nameNode = child.childForFieldName('name') ??
          findChildOfType(child, 'type_identifier') ??
          findChildOfType(child, 'identifier')
        const name = nameNode?.text ?? 'default'
        addNode(ctx, makeNode(ctx, name, 'class', child, true, null, false,
          extractJSDoc(child, ctx), true))
        processClassHeritage(child, ctx, name)
        processClassBody(child, ctx, name, true)
        break
      }
      case 'interface_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        addNode(ctx, makeNode(ctx, nameNode.text, 'interface', child, true, null, false,
          extractJSDoc(child, ctx), true))
        break
      }
      case 'type_alias_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        addNode(ctx, makeNode(ctx, nameNode.text, 'type', child, true, null, false,
          extractJSDoc(child, ctx), true))
        break
      }
      case 'enum_declaration': {
        const nameNode = child.childForFieldName('name')
        if (!nameNode) break
        addNode(ctx, makeNode(ctx, nameNode.text, 'enum', child, true, null, false,
          extractJSDoc(child, ctx), true))
        collectEnumValues(child, ctx)
        break
      }
      case 'arrow_function':
      case 'function_expression': {
        addNode(ctx, makeNode(ctx, 'default', 'function', child, true,
          extractFunctionSignature(child), isAsyncNode(child), extractJSDoc(child, ctx), true))
        collectCallsFromBody(child, ctx, nodeId(ctx, 'default'))
        break
      }
      case 'parenthesized_expression': {
        // export default (function expr() {}) — 괄호로 감싼 표현식. 내부 unwrap.
        for (const inner of child.children) {
          if (inner.type === 'function_expression' || inner.type === 'arrow_function' || inner.type === 'function') {
            addNode(ctx, makeNode(ctx, 'default', 'function', inner, true,
              extractFunctionSignature(inner), isAsyncNode(inner), extractJSDoc(inner, ctx), true))
            collectCallsFromBody(inner, ctx, nodeId(ctx, 'default'))
            break
          }
        }
        break
      }
      case 'identifier': {
        promoteNodeExported(ctx, child.text, true, child)
        break
      }
      case 'new_expression': {
        const ctor = child.childForFieldName('constructor')
        if (ctor?.type === 'identifier') {
          promoteNodeExported(ctx, ctor.text, true, ctor)
          ctx.edges.push(makeEdge(ctx, {
            source_id: fileNodeId(ctx),
            target_id: nodeId(ctx, ctor.text),
            relation: 'depends_on',
            target_specifier: null,
            target_symbol: ctor.text,
            resolve_status: 'resolved',
            first_arg: null,
            literal_args: null,
          }))
        }
        collectCallsFromBody(child, ctx, fileNodeId(ctx))
        break
      }
      case 'object': {
        emitObjectLocalReferenceEdges(child, ctx, fileNodeId(ctx), true)
        break
      }
      default:
        break
    }
  }
  collectDecoratorsFromExport(exportNode, ctx)
}

// ── re-export ──

function processReExport(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  specifier: string,
): void {
  // export * as NS from './x' → re_exports_ns  (namespace_export child)
  // export * from './x'       → re_exports      (bare * child)
  const namespaceExport = node.children.find((c) => c.type === 'namespace_export')
  if (namespaceExport) {
    // `* as NS` block: extract NS name from identifier inside namespace_export
    const nsName = findChildOfType(namespaceExport, 'identifier')?.text ?? null
    ctx.edges.push(makeEdge(ctx, {
      source_id: fileNodeId(ctx),
      target_id: null,
      relation: 're_exports_ns',
      target_specifier: specifier,
      target_symbol: nsName,
      resolve_status: 'resolved',
      first_arg: null,
      literal_args: null,
    }))
    return
  }

  const star = node.children.find((c) => c.text === '*')
  if (star) {
    // export * from './x' → re_exports (no namespace alias)
    ctx.edges.push(makeEdge(ctx, {
      source_id: fileNodeId(ctx),
      target_id: null,
      relation: 're_exports',
      target_specifier: specifier,
      target_symbol: null,
      resolve_status: 'resolved',
      first_arg: null,
      literal_args: null,
    }))
    return
  }

  const exportClause = findChildOfType(node, 'export_clause')
  if (exportClause) {
    for (const child of exportClause.children) {
      if (child.type === 'export_specifier') {
        const nameNode = child.childForFieldName('name')
        const aliasNode = child.childForFieldName('alias')
        // `export { default as emailService } from './x'` / `export { fn as renamed } from './m'`:
        // 공개 re-export 이름(alias)으로 import가 들어오므로 target_symbol=alias(공개 이름),
        // target_imported_symbol=name(원본 모듈의 source 심볼)으로 기록한다.
        // (import 별칭 정책 + processLocalNamedExport[GAP-C-2]와 일관 — alias 없으면 둘이 동일.)
        const importedSym = nameNode?.text ?? null
        const publicSym = aliasNode?.text ?? importedSym
        ctx.edges.push(makeEdge(ctx, {
          source_id: fileNodeId(ctx),
          target_id: null,
          relation: 're_exports',
          target_specifier: specifier,
          target_symbol: publicSym,
          target_imported_symbol: importedSym,
          resolve_status: 'resolved',
          first_arg: null,
          literal_args: null,
        }))
      }
    }
  }
}

// ── local named export { x } ──

function processLocalNamedExport(
  exportClause: Parser.SyntaxNode,
  ctx: ParseContext,
): void {
  for (const child of exportClause.children) {
    if (child.type === 'export_specifier') {
      const nameNode = child.childForFieldName('name')
      if (!nameNode) continue
      // alias가 있으면 alias(공개 이름)로 등록 — import의 localName 정책과 일관됨 (GAP-C-2)
      const aliasNode = child.childForFieldName('alias')
      const name = aliasNode?.text ?? nameNode.text
      if (!aliasNode || aliasNode.text === nameNode.text) {
        promoteNodeExported(ctx, nameNode.text, false, nameNode)
        continue
      }
      const n: CodeNodeRaw = {
        id: nodeId(ctx, name),
        repo_id: ctx.repoId,
        type: 'variable',
        file_path: ctx.filePath,
        name,
        line_start: null,
        line_end: null,
        signature: null,
        exported: true,
        parse_status: 'ok',
        is_test: false,
        test_type: null,
        is_async: false,
        jsdoc: null,
        leading_comment: null,
      }
      addNode(ctx, n)
    }
  }
}

// ── exported class ──

function processExportedClass(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  exported: boolean,
  exportParent?: Parser.SyntaxNode,
  isDefaultExport = false,
): void {
  const nameNode = node.childForFieldName('name') ??
    findChildOfType(node, 'type_identifier')
  const name = nameNode?.text ?? 'default'

  // class-level decorator는 processExportStatement 마지막의 collectDecoratorsFromExport가 처리.
  // 여기서 별도로 collectDecorators를 호출하면 중복 발화됨.

  const classNode = makeNode(ctx, name, 'class', node, exported, null, false,
    extractJSDoc(node, ctx), isDefaultExport)
  // exportParent(export_statement)이 더 일찍 시작하면 데코레이터 라인 포함
  const classLineStart = exportParent && exportParent.startPosition.row + 1 < classNode.line_start!
    ? exportParent.startPosition.row + 1
    : classNode.line_start
  addNode(ctx, { ...classNode, line_start: classLineStart })
  processClassHeritage(node, ctx, name)
  processClassBody(node, ctx, name, exported)
}

function processClassHeritage(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  className: string,
): void {
  ctx.edges.push(
    ...engineBuildClassHeritageEdges(
      node,
      ctx.repoId,
      ctx.filePath,
      nodeId(ctx, className),
      ctx.importSymbolMap,
      TS_LANGUAGE_SPEC,
    ),
  )
}

// findTypeNameChild / emitGenericTypeArgumentEdges (구 uses_type generic_arg 발화) 제거 —
// S3.3 class-heritage 추출 후 호출부가 사라진 dead code였다 (heritage_ops가 generic 인자 처리 담당).

// collectTypeIdentifiers — 공유 leaf(shared_utils, spec-driven) 사용. TS_LANGUAGE_SPEC 의
// typeIdentifierType/identifierType = 'type_identifier'/'identifier' → 기존 하드코딩과 byte-identical (A-5).

/** Classify a class-body child for the shared engine loop (P3 S4). */
function tsClassifyMember(member: Parser.SyntaxNode): MemberKind {
  if (member.type === 'method_definition' || member.type === 'abstract_method_signature') {
    const methodName = member.childForFieldName('name')?.text
    if (!methodName) return 'skip'
    if (methodName === 'constructor') return 'constructor'
    return 'method'
  }
  if (member.type === 'public_field_definition' || member.type === 'property_signature') return 'field'
  return 'skip'
}

/**
 * kind='method' per-member processing — verbatim from the former processClassBody method branch.
 * Reached only when tsClassifyMember returned 'method' (name present, not 'constructor').
 */
function tsProcessMethod(
  member: Parser.SyntaxNode,
  children: Parser.SyntaxNode[],
  i: number,
  className: string,
  classExported: boolean,
  classNodeId: string,
  ctx: ParseContext,
): void {
  const methodName = member.childForFieldName('name')!.text

  const accessibility = getAccessibility(member)
  const isExported =
    classExported && accessibility !== 'private' && accessibility !== 'protected'

  // P4 fix: getter/setter 키워드 검출 — name node 위치(startIndex) 비교 (tree-sitter Node reference 동치 안 보장)
  const nameNode = member.childForFieldName('name')
  const nameStart = nameNode?.startIndex ?? -1
  let displayName = methodName
  for (const mc of member.children) {
    if (mc.startIndex === nameStart) continue
    if (mc.text === 'get') { displayName = `get:${methodName}`; break }
    if (mc.text === 'set') { displayName = `set:${methodName}`; break }
  }

  const fullName = `${className}.${displayName}`
  const sig = extractFunctionSignature(member)
  const isAsync = isAsyncNode(member)
  const jsdoc = extractJSDoc(member, ctx)

  // preceding decorator siblings — 앞에서부터 수집 (earliest first)
  const decoratorNodes: Parser.SyntaxNode[] = []
  for (let j = i - 1; j >= 0; j--) {
    if (children[j].type === 'comment') continue
    if (children[j].type === 'decorator') {
      decoratorNodes.unshift(children[j])
    } else {
      break
    }
  }

  // line_start: 데코레이터가 있으면 첫 데코레이터 줄, 없으면 method 자체 줄
  const methodLineStart = decoratorNodes.length > 0
    ? decoratorNodes[0].startPosition.row + 1
    : member.startPosition.row + 1
  const methodNode = makeNode(ctx, fullName, 'method', member, isExported, sig, isAsync, jsdoc)
  // member node + class→method contains edge — shared engine leaf (P3 STEP 3).
  emitMemberNodeAndContains(methodNode, methodLineStart, classNodeId, fullName, displayName, ctx)

  // decorator edges — shared engine leaf (P3 STEP 2). method = decorates + calls + deps + type_fn.
  emitMemberDecorators(
    decoratorNodes.map((decorNode) => ({ node: decorNode, info: getDecoratorInfo(decorNode), emitCalls: true, emitDepsAndTypeFn: true })),
    nodeId(ctx, fullName),
    ctx,
    TS_LANGUAGE_SPEC,
  )

  // method param decorator (@Param('id'), @Body(), @Query() 등) — decorates edge로 추가
  collectMethodParamDecorators(member, ctx, nodeId(ctx, fullName))

  // A2-2 — method 시그니처의 param/return type → type_ref edge
  emitMethodSignatureTypeRefs(member, ctx, nodeId(ctx, fullName))

  // P3 fix: method body만 walk (decorators/parameters 영역 walk 시 decorator → calls 중복 발화 방지)
  const methodBody = member.childForFieldName('body')
  if (methodBody) {
    collectCallsFromBody(methodBody, ctx, nodeId(ctx, fullName))
    // P19-B: body 안 import-bound identifier reference → depends_on
    emitBodyIdentifierDependsOn(methodBody, ctx, nodeId(ctx, fullName))
  }
}

/**
 * class-body processing — now a thin caller of the shared engine processClassBody (P3 S4, S7 reversal).
 * The engine owns the member loop + currentClassKey scope + constructor-param buffering; TS supplies
 * classification + per-member processing (method/field), which route through the shared leaves.
 */
function processClassBody(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  className: string,
  classExported: boolean,
): void {
  const { constructorParams } = engineProcessClassBody(node, ctx, className, classExported, {
    resolveClassBody: (n) => findChildOfType(n, 'class_body') ?? null,
    classifyMember: (member) => tsClassifyMember(member),
    collectConstructorParams: (member) => {
      // v2-1: materialize constructor parameter properties (`constructor(@Dec(arg) private x: T)`) as
      // real `property` nodes + contains/decorates/type_ref — so def-use (F5 resolves_to) + the
      // decorator/type traversal cover NestJS/Angular-style DI. Buffer collection is unchanged.
      emitConstructorParamProperties(member, ctx, className, classExported)
      return collectConstructorParams(member)
    },
    processMethod: (member, members, i, cn, ce, cnId) => tsProcessMethod(member, members, i, cn, ce, cnId, ctx),
    processField: (member, cn, ce) => processFieldDefinition(member, ctx, cn, ce),
  })

  if (constructorParams.length > 0) {
    ctx.constructorParams.push({ className, params: constructorParams })
  }
}

/**
 * E7 — class field/property 처리.
 * - property 노드 생성 + contains edge (class → property)
 * - field 위 decorator (여러 개) → property 노드 source로 'decorates' edge
 * - field 위 decorator의 객체 인자 → depends_on / E4 walk 그대로
 */
function processFieldDefinition(
  fieldNode: Parser.SyntaxNode,
  ctx: ParseContext,
  className: string,
  classExported: boolean,
): void {
  // property 이름: property_identifier 또는 identifier (private 등 modifier 사이)
  const propIdentNode = fieldNode.children.find(
    (c) => c.type === 'property_identifier' || (c.type === 'identifier' && c.parent === fieldNode),
  )
  if (!propIdentNode) return
  const propName = propIdentNode.text
  const fullName = `${className}.${propName}`

  // accessibility (private/protected) → exported false
  const accessibility = getAccessibility(fieldNode)
  const isExported =
    classExported && accessibility !== 'private' && accessibility !== 'protected'

  // type signature (예: ': string', ': User[]') — type_annotation에서 추출
  const typeAnn = fieldNode.children.find((c) => c.type === 'type_annotation')
  const sig = typeAnn?.text ?? null

  // jsdoc은 V1 메서드 추출 함수 재사용
  const jsdoc = extractJSDoc(fieldNode, ctx)

  // 데코레이터 모음 (field 자체 children에 모두 들어있음)
  const decoratorNodes = fieldNode.children.filter((c) => c.type === 'decorator')

  // line_start: 데코레이터 있으면 첫 데코레이터 줄, 없으면 field 자체
  const lineStart = decoratorNodes.length > 0
    ? decoratorNodes[0].startPosition.row + 1
    : fieldNode.startPosition.row + 1

  const propNode = makeNode(ctx, fullName, 'property', fieldNode, isExported, sig, false, jsdoc)
  // member node + class→property contains edge — shared engine leaf (P3 STEP 3).
  emitMemberNodeAndContains(propNode, lineStart, nodeId(ctx, className), fullName, propName, ctx)

  // decorator edges (여러 개 가능 — TypeORM/Swagger/class-validator) — shared engine leaf (P3 STEP 2).
  // field = decorates + deps + type_fn (NO calls edge, unlike methods).
  emitMemberDecorators(
    decoratorNodes.map((decorNode) => ({ node: decorNode, info: getDecoratorInfo(decorNode), emitCalls: false, emitDepsAndTypeFn: true })),
    nodeId(ctx, fullName),
    ctx,
    TS_LANGUAGE_SPEC,
  )

  // P12: type annotation root identifier → type_ref edge (deep chain 추적용)
  // 예: `private inner: InnerCache` → CacheWrapper.inner property의 type_ref InnerCache
  if (typeAnn) {
    const typeNode = typeAnn.children.find(
      (c) => c.type === 'type_identifier' || c.type === 'generic_type',
    )
    let typeRoot: Parser.SyntaxNode | null = null
    if (typeNode?.type === 'type_identifier') {
      typeRoot = typeNode
    } else if (typeNode?.type === 'generic_type') {
      typeRoot = typeNode.childForFieldName('name') ?? null
    }
    if (typeRoot) {
      ctx.edges.push(makeEdge(ctx, {
        source_id: nodeId(ctx, fullName),
        target_id: null,
        relation: 'type_ref',
        target_specifier: ctx.importSymbolMap.get(typeRoot.text) ?? null,
        target_symbol: typeRoot.text,
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      }))
    }
  }

  // P5 fix: field initializer RHS walk
  // 1) RHS가 call/new 표현 → calls walk (a6)
  // 2) RHS가 member_expression / identifier (e.g. `SGlobal.prismaPrimary`) → root identifier를 type_ref로 발화
  const valueNode = fieldNode.childForFieldName('value')
  if (valueNode) {
    collectCallsFromBody(valueNode, ctx, nodeId(ctx, fullName))

    // RHS chain root identifier 추출
    let rootIdent: Parser.SyntaxNode | null = null
    if (valueNode.type === 'identifier') {
      rootIdent = valueNode
    } else if (valueNode.type === 'member_expression') {
      let cur: Parser.SyntaxNode = valueNode
      while (cur.type === 'member_expression') {
        const obj = cur.childForFieldName('object')
        if (!obj) break
        cur = obj
      }
      if (cur.type === 'identifier') rootIdent = cur
    }
    if (rootIdent) {
      const rootName = rootIdent.text
      ctx.edges.push(makeEdge(ctx, {
        source_id: nodeId(ctx, fullName),
        target_id: null,
        relation: 'type_ref',
        target_specifier: ctx.importSymbolMap.get(rootName) ?? null,
        target_symbol: rootName,
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      }))
    }
  }

  // P15-Lite: field origin 기록 (annotation → RHS → unknown)
  const origin = inferFieldOrigin(typeAnn ?? null, valueNode, ctx)
  recordFieldOrigin(ctx, className, propName, origin)
}

// getAccessibility → common_engine/node_ops.ts (engine_a, accessibility_modifier + private/protected/public spec 치환).
function getAccessibility(node: Parser.SyntaxNode): string {
  return engineGetAccessibility(node, TS_LANGUAGE_SPEC)
}

function collectConstructorParams(constructorNode: Parser.SyntaxNode): ConstructorParam[] {
  const params: ConstructorParam[] = []
  const formalParams = findChildOfType(constructorNode, 'formal_parameters')
  if (!formalParams) return params

  for (const param of formalParams.children) {
    if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
      const hasAccessibility = param.children.some(
        (c) =>
          c.type === 'accessibility_modifier' ||
          c.text === 'private' || c.text === 'protected' || c.text === 'public',
      )
      if (!hasAccessibility) continue

      const nameNode =
        param.childForFieldName('pattern') ?? findChildOfType(param, 'identifier')
      const typeNode = findChildOfType(param, 'type_annotation')
      if (!nameNode || !typeNode) continue

      const typeName = extractTypeName(typeNode)
      if (!typeName) continue
      params.push({ fieldName: nameNode.text, typeName })
    }
  }
  return params
}

/**
 * v2-1 — emit TS constructor parameter properties as `property` nodes.
 * A `constructor(@InjectModel('user') private readonly userModel: Model<User>)` parameter property
 * (a ctor param with an accessibility/readonly modifier) is a real instance field (`this.userModel`),
 * but build_graph previously only buffered it for DI resolution and DROPPED its decorator/type. This
 * emits it like a class-body field — node + class→field contains + decorates(@InjectModel, firstArg) +
 * type_ref(type) — marked role 'ctor_param_property'. Mirrors processFieldDefinition; param decorators
 * do NOT emit calls/deps/type-fn (consistent with field decorators' param semantics).
 */
function emitConstructorParamProperties(
  constructorNode: Parser.SyntaxNode,
  ctx: ParseContext,
  className: string,
  classExported: boolean,
): void {
  const formalParams = findChildOfType(constructorNode, 'formal_parameters')
  if (!formalParams) return

  for (const param of formalParams.children) {
    if (param.type !== 'required_parameter' && param.type !== 'optional_parameter') continue
    // parameter property = ctor param carrying an accessibility/readonly modifier (TS rule for "becomes a field")
    const isParamProperty = param.children.some(
      (c) =>
        c.type === 'accessibility_modifier' ||
        c.text === 'private' || c.text === 'protected' || c.text === 'public' || c.text === 'readonly',
    )
    if (!isParamProperty) continue

    const nameNode = param.childForFieldName('pattern') ?? findChildOfType(param, 'identifier')
    if (!nameNode) continue
    const propName = nameNode.text
    const fullName = `${className}.${propName}`

    const accessibility = getAccessibility(param)
    const isExported = classExported && accessibility !== 'private' && accessibility !== 'protected'

    const typeAnn = findChildOfType(param, 'type_annotation')
    const sig = typeAnn?.text ?? null
    const decoratorNodes = param.children.filter((c) => c.type === 'decorator')
    const lineStart = (decoratorNodes[0] ?? param).startPosition.row + 1

    const propNode = makeNode(ctx, fullName, 'property', param, isExported, sig, false, null)
    propNode.role = 'ctor_param_property'
    emitMemberNodeAndContains(propNode, lineStart, nodeId(ctx, className), fullName, propName, ctx)

    // param decorators (e.g. @InjectModel('user')) → decorates ON the field node (firstArg carried)
    emitMemberDecorators(
      decoratorNodes.map((decorNode) => ({ node: decorNode, info: getDecoratorInfo(decorNode), emitCalls: false, emitDepsAndTypeFn: false })),
      nodeId(ctx, fullName),
      ctx,
      TS_LANGUAGE_SPEC,
    )

    // field type → type_ref (root identifier of the type annotation), mirroring processFieldDefinition
    if (typeAnn) {
      const typeNode = typeAnn.children.find((c) => c.type === 'type_identifier' || c.type === 'generic_type')
      let typeRoot: Parser.SyntaxNode | null = null
      if (typeNode?.type === 'type_identifier') typeRoot = typeNode
      else if (typeNode?.type === 'generic_type') typeRoot = typeNode.childForFieldName('name') ?? null
      if (typeRoot) {
        ctx.edges.push(makeEdge(ctx, {
          source_id: nodeId(ctx, fullName),
          target_id: null,
          relation: 'type_ref',
          target_specifier: ctx.importSymbolMap.get(typeRoot.text) ?? null,
          target_symbol: typeRoot.text,
          resolve_status: 'pending',
          first_arg: null,
          literal_args: null,
        }))
      }
    }
  }
}

function extractTypeName(typeAnnotation: Parser.SyntaxNode): string | null {
  for (const child of typeAnnotation.children) {
    if (child.type === 'type_identifier' || child.type === 'identifier') return child.text
    if (child.type === 'generic_type') {
      const inner =
        findChildOfType(child, 'type_identifier') ?? findChildOfType(child, 'identifier')
      return inner?.text ?? null
    }
  }
  return null
}

// ── exported function ──

function processExportedFunction(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  exported: boolean,
): void {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return
  const name = nameNode.text

  // overload declaration (no body) → skip
  const body = node.childForFieldName('body')
  if (!body) return

  const sig = extractFunctionSignature(node)
  addNode(ctx, makeNode(ctx, name, 'function', node, exported, sig,
    isAsyncNode(node), extractJSDoc(node, ctx)))
  collectCallsFromBody(node, ctx, nodeId(ctx, name))
  // P19-B: function body 안 import-bound identifier reference → depends_on
  emitBodyIdentifierDependsOn(body, ctx, nodeId(ctx, name))
}

// ── exported variable/const ──

function processExportedVariable(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  exported = true,
  suppressedRequireLocals?: ReadonlySet<string>,
): void {
  for (const declarator of node.children) {
    if (declarator.type !== 'variable_declarator') continue
    const nameNode = declarator.childForFieldName('name')
    const value = declarator.childForFieldName('value')
    if (!nameNode) continue

    if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
      const bindings = collectDestructuringBindings(nameNode)
      for (const bname of bindings) {
        // Skip local nodes for require-destructured imports: they are import
        // bindings, not local definitions. Keeping them would let F5 pin
        // cross-module calls to the binding node instead of the real export.
        if (suppressedRequireLocals?.has(bname)) continue
        addNode(ctx, makeNode(ctx, bname, 'variable', declarator, exported, null, false, null))
      }
      continue
    }

    const name = nameNode.text
    let type: CodeNodeType = 'variable'
    let sig: string | null = null
    let isAsync = false

    if (
      value?.type === 'arrow_function' ||
      value?.type === 'function_expression' ||
      isFunctionWrapperCall(value)
    ) {
      type = 'function'
      sig = value.type === 'call_expression'
        ? extractWrappedFunctionSignature(value)
        : extractFunctionSignature(value)
      isAsync = value.type === 'call_expression'
        ? isWrappedFunctionAsync(value)
        : isAsyncNode(value)
    }

    addNode(ctx, makeNode(ctx, name, type, declarator, exported, sig, isAsync,
      extractJSDoc(declarator, ctx)))

    if (type === 'function' && value) {
      collectCallsFromBody(value, ctx, nodeId(ctx, name))
      // P19-B parity: a callable-valued binding (arrow/function-expression/wrapper call) must emit
      // the same body `depends_on` edges as a function declaration (processExportedFunction) and as
      // the Dart adapter already does for variable-bound functions. import-bound identifiers only.
      emitBodyIdentifierDependsOn(value, ctx, nodeId(ctx, name))
    } else if (value && (value.type === 'call_expression' || value.type === 'new_expression')) {
      // BS-11 — top-level const x = Router().get().post() chain initializer
      // 또는 const app = new Hono().route(...).get(...)
      // 변수 노드를 source로 chain의 모든 호출 잡음
      collectCallsFromBody(value, ctx, nodeId(ctx, name))
    } else if (value?.type === 'object') {
      collectCallsFromBody(value, ctx, nodeId(ctx, name))
      emitObjectLocalReferenceEdges(value, ctx, nodeId(ctx, name), exported)
    }

    const typeAnn = declarator.children.find((c) => c.type === 'type_annotation')
    if (typeAnn) emitTypeAnnotationRefs(typeAnn, ctx, nodeId(ctx, name))
  }
}

function collectDestructuringBindings(pattern: Parser.SyntaxNode): string[] {
  return engineCollectDestructuringBindings(pattern, TS_LANGUAGE_SPEC)
}

function isFunctionWrapperCall(value: Parser.SyntaxNode | null): value is Parser.SyntaxNode {
  if (!value || value.type !== 'call_expression') return false
  const callee = value.childForFieldName('function')
  if (callee?.type !== 'identifier' || !isKnownFunctionWrapperName(callee.text)) return false
  const args = value.childForFieldName('arguments')
  if (!args) return false
  const functionArgs = args.children.filter((child) =>
    child.type === 'arrow_function' ||
    child.type === 'function_expression' ||
    child.type === 'function'
  )
  return functionArgs.length === 1
}

function isKnownFunctionWrapperName(name: string): boolean {
  return [
    'catchAsync',
    'asyncHandler',
    'asyncMiddleware',
    'asyncRoute',
    'wrapAsync',
    'createParamDecorator',
    'memo',
    'forwardRef',
  ].includes(name)
}

function extractWrappedFunctionSignature(value: Parser.SyntaxNode): string | null {
  const args = value.childForFieldName('arguments')
  const wrapped = args?.children.find((child) =>
    child.type === 'arrow_function' ||
    child.type === 'function_expression' ||
    child.type === 'function'
  )
  return wrapped ? extractFunctionSignature(wrapped) : null
}

function isWrappedFunctionAsync(value: Parser.SyntaxNode): boolean {
  const args = value.childForFieldName('arguments')
  const wrapped = args?.children.find((child) =>
    child.type === 'arrow_function' ||
    child.type === 'function_expression' ||
    child.type === 'function'
  )
  return wrapped ? isAsyncNode(wrapped) : false
}

// ── exported interface ──

function processExportedInterface(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  exported = true,
): void {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return
  addNode(ctx, makeNode(ctx, nameNode.text, 'interface', node, exported, null, false,
    extractJSDoc(node, ctx)))
}

// ── exported type alias ──

function processExportedTypeAlias(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  exported = true,
): void {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return
  addNode(ctx, makeNode(ctx, nameNode.text, 'type', node, exported, null, false,
    extractJSDoc(node, ctx)))
}

// ── exported enum ──

function processExportedEnum(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  exported = true,
): void {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return
  const enumName = nameNode.text
  addNode(ctx, makeNode(ctx, enumName, 'enum', node, exported, null, false,
    extractJSDoc(node, ctx)))

  // EnumValueMap: string literal 값을 가진 멤버 수집 (TS-로컬 헬퍼 — 3 enum_body 루프 통합; 엔진 op 아님)
  collectEnumStringValues(findChildOfType(node, 'enum_body'), enumName, ctx)
}

// ── non-exported enum (enumValues 수집만) ──

// P3 STEP-E: TS-LOCAL helper (NOT an engine op — no common_engine enum op exists) that folds the 3
// byte-identical enum_body loops (processExportedEnum / collectEnumValues / namespace-enum).
// qualifiedEnumName carries the enum's name (bare for top-level, dotted A.B.E for namespace).
function collectEnumStringValues(
  enumBody: Parser.SyntaxNode | null | undefined,
  qualifiedEnumName: string,
  ctx: ParseContext,
): void {
  if (!enumBody) return
  for (const member of enumBody.children) {
    if (member.type !== 'enum_assignment') continue
    const memberName = findChildOfType(member, 'property_identifier')?.text ??
      findChildOfType(member, 'identifier')?.text
    const valueNode = member.childForFieldName('value')
    if (memberName && valueNode?.type === 'string') {
      ctx.enumValues.set(`${ctx.repoId}:${ctx.filePath}:${qualifiedEnumName}.${memberName}`, stripQuotes(valueNode.text))
    }
  }
}

function collectEnumValues(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
): void {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return
  collectEnumStringValues(findChildOfType(node, 'enum_body'), nameNode.text, ctx)
}

// ── exported namespace (internal_module) ──
//
// 이름 규칙: 점 누적 (A.B.C, A.f, A.E.V)
// contains edge: source=parent ns full id, target=child full id, target_symbol=bare last segment
// 한계 (MVP): namespace 내부 class의 method/heritage/call 추적은 발화하지 않음
//   — namespace에 class를 두는 패턴은 실 프로젝트에 거의 없으므로 후속 마일스톤으로 보류

function processExportedNamespace(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  parentDottedName?: string,
): void {
  const nameNode = node.childForFieldName('name') ?? findChildOfType(node, 'identifier')
  if (!nameNode) return
  const localName = nameNode.text
  const fullName = parentDottedName ? `${parentDottedName}.${localName}` : localName

  addNode(ctx, makeNode(ctx, fullName, 'namespace', node, true, null, false,
    extractJSDoc(node, ctx)))
  const nsNodeId = nodeId(ctx, fullName)

  const body = findChildOfType(node, 'statement_block')
  if (!body) return

  for (const child of body.children) {
    if (child.type !== 'export_statement') continue
    if (child.children.some((c) => c.text === 'declare')) continue

    for (const inner of child.children) {
      emitNamespaceMember(inner, ctx, fullName, nsNodeId)
    }
  }
}

function emitNamespaceMember(
  inner: Parser.SyntaxNode,
  ctx: ParseContext,
  parentDottedName: string,
  parentNsId: string,
): void {
  if (inner.type === 'internal_module') {
    const innerNameNode = inner.childForFieldName('name') ?? findChildOfType(inner, 'identifier')
    if (!innerNameNode) return
    const innerName = innerNameNode.text
    processExportedNamespace(inner, ctx, parentDottedName)
    emitContainsEdge(ctx, parentNsId, `${parentDottedName}.${innerName}`, innerName)
    return
  }

  if (inner.type === 'function_declaration') {
    const fnNameNode = inner.childForFieldName('name')
    if (!fnNameNode) return
    if (!inner.childForFieldName('body')) return  // overload skip
    const innerName = fnNameNode.text
    const fullName = `${parentDottedName}.${innerName}`
    addNode(ctx, makeNode(ctx, fullName, 'function', inner, true,
      extractFunctionSignature(inner), isAsyncNode(inner), extractJSDoc(inner, ctx)))
    emitContainsEdge(ctx, parentNsId, fullName, innerName)
    return
  }

  if (inner.type === 'class_declaration' || inner.type === 'abstract_class_declaration') {
    const clsNameNode = inner.childForFieldName('name') ?? findChildOfType(inner, 'type_identifier')
    if (!clsNameNode) return
    const innerName = clsNameNode.text
    const fullName = `${parentDottedName}.${innerName}`
    addNode(ctx, makeNode(ctx, fullName, 'class', inner, true, null, false,
      extractJSDoc(inner, ctx)))
    emitContainsEdge(ctx, parentNsId, fullName, innerName)
    // Phase A1 — namespace 안 class 본문 walk (J-13~J-20)
    // class 노드만 잡던 마이크로 한계 해소: heritage + body member 발화
    processClassHeritage(inner, ctx, fullName)
    processClassBody(inner, ctx, fullName, true)
    return
  }

  if (inner.type === 'interface_declaration') {
    const itNameNode = inner.childForFieldName('name')
    if (!itNameNode) return
    const innerName = itNameNode.text
    const fullName = `${parentDottedName}.${innerName}`
    addNode(ctx, makeNode(ctx, fullName, 'interface', inner, true, null, false,
      extractJSDoc(inner, ctx)))
    emitContainsEdge(ctx, parentNsId, fullName, innerName)
    return
  }

  if (inner.type === 'type_alias_declaration') {
    const tNameNode = inner.childForFieldName('name')
    if (!tNameNode) return
    const innerName = tNameNode.text
    const fullName = `${parentDottedName}.${innerName}`
    addNode(ctx, makeNode(ctx, fullName, 'type', inner, true, null, false,
      extractJSDoc(inner, ctx)))
    emitContainsEdge(ctx, parentNsId, fullName, innerName)
    return
  }

  if (inner.type === 'enum_declaration') {
    const enNameNode = inner.childForFieldName('name')
    if (!enNameNode) return
    const innerName = enNameNode.text
    const fullName = `${parentDottedName}.${innerName}`
    addNode(ctx, makeNode(ctx, fullName, 'enum', inner, true, null, false,
      extractJSDoc(inner, ctx)))
    collectEnumStringValues(findChildOfType(inner, 'enum_body'), fullName, ctx)  // TS-로컬 헬퍼 (엔진 op 아님)
    emitContainsEdge(ctx, parentNsId, fullName, innerName)
    return
  }

  if (inner.type === 'lexical_declaration' || inner.type === 'variable_declaration') {
    for (const decl of inner.children) {
      if (decl.type !== 'variable_declarator') continue
      const innerName = decl.childForFieldName('name')?.text
      if (!innerName) continue
      const fullName = `${parentDottedName}.${innerName}`
      addNode(ctx, makeNode(ctx, fullName, 'variable', decl, true, null, false, null))
      emitContainsEdge(ctx, parentNsId, fullName, innerName)
      // P1 fix: namespace 안 export const fn = (...) => { ... } body calls walk
      const value = decl.childForFieldName('value')
      if (
        value &&
        (value.type === 'arrow_function' ||
          value.type === 'function_expression' ||
          value.type === 'call_expression' ||
          value.type === 'new_expression')
      ) {
        collectCallsFromBody(value, ctx, nodeId(ctx, fullName))
      }
      // P15-Lite: namespace member origin 기록 (key=namespace name, field=member name)
      const typeAnn = decl.children.find((c) => c.type === 'type_annotation') ?? null
      const origin = inferFieldOrigin(typeAnn, value, ctx)
      recordFieldOrigin(ctx, parentDottedName, innerName, origin)
    }
    return
  }
}

function emitContainsEdge(
  ctx: ParseContext,
  parentNsId: string,
  childFullName: string,
  childBareName: string,
): void {
  ctx.edges.push(engineBuildContainsEdge(ctx.repoId, ctx.filePath, parentNsId, childFullName, childBareName))
}

function emitTypeAnnotationRefs(
  typeAnn: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
): void {
  const seen = new Set<string>()
  collectTypeIdentifiers(typeAnn, seen, TS_LANGUAGE_SPEC)
  for (const typeName of seen) {
    if (BUILTIN_TYPE_NAMES.has(typeName)) continue
    ctx.edges.push(makeEdge(ctx, {
      source_id: sourceId,
      target_id: null,
      relation: 'type_ref',
      target_specifier: ctx.importSymbolMap.get(typeName) ?? null,
      target_symbol: typeName,
      resolve_status: 'pending',
      first_arg: null,
      literal_args: null,
    }))
  }
}

function emitObjectLocalReferenceEdges(
  objectNode: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
  markExported: boolean,
): void {
  for (const child of objectNode.children) {
    if (child.type === 'shorthand_property_identifier') {
      promoteNodeExported(ctx, child.text, false, child, markExported)
      emitContainsEdge(ctx, sourceId, child.text, child.text)
      continue
    }

    if (child.type === 'pair') {
      const keyNode = child.childForFieldName('key')
      const valueNode = child.childForFieldName('value')
      const publicName = keyNode?.text.replace(/^['"`]|['"`]$/g, '') ?? null
      if (!publicName || !valueNode) continue

      if (valueNode.type === 'identifier') {
        promoteNodeExported(ctx, valueNode.text, false, valueNode, markExported)
        emitContainsEdge(ctx, sourceId, valueNode.text, publicName)
      } else if (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression') {
        addNode(ctx, makeNode(ctx, publicName, 'function', valueNode, markExported,
          extractFunctionSignature(valueNode), isAsyncNode(valueNode), extractJSDoc(valueNode, ctx)))
        collectCallsFromBody(valueNode, ctx, nodeId(ctx, publicName))
        emitContainsEdge(ctx, sourceId, publicName, publicName)
      } else if (valueNode.type === 'object') {
        emitObjectLocalReferenceEdges(valueNode, ctx, sourceId, markExported)
      } else {
        collectCallsFromBody(valueNode, ctx, sourceId)
      }
    }
  }
}

// ── module.exports = ... ──

function processModuleExportsAssignment(
  value: Parser.SyntaxNode | null,
  ctx: ParseContext,
): void {
  if (!value) return
  if (value.type === 'class_declaration' || value.type === 'class') {
    processExportedClass(value, ctx, true, undefined, true)
  } else if (value.type === 'function_declaration' || value.type === 'function_expression') {
    const nameNode = value.childForFieldName('name')
    const name = nameNode?.text ?? 'default'
    addNode(ctx, makeNode(ctx, name, 'function', value, true,
      extractFunctionSignature(value), isAsyncNode(value), null, true))
    collectCallsFromBody(value, ctx, nodeId(ctx, name))
  } else if (value.type === 'identifier') {
    promoteNodeExported(ctx, value.text, true, value)
  } else if (value.type === 'object') {
    emitObjectLocalReferenceEdges(value, ctx, fileNodeId(ctx), true)
  } else if (value.type === 'new_expression') {
    const ctor = value.childForFieldName('constructor')
    if (ctor?.type === 'identifier') {
      promoteNodeExported(ctx, ctor.text, true, ctor)
      ctx.edges.push(makeEdge(ctx, {
        source_id: fileNodeId(ctx),
        target_id: nodeId(ctx, ctor.text),
        relation: 'depends_on',
        target_specifier: null,
        target_symbol: ctor.text,
        resolve_status: 'resolved',
        first_arg: null,
        literal_args: null,
      }))
    }
    collectCallsFromBody(value, ctx, fileNodeId(ctx))
  }
}

function processCommonJsMemberAssignment(
  left: Parser.SyntaxNode,
  right: Parser.SyntaxNode | null,
  ctx: ParseContext,
): void {
  const root = getRootObject(left)
  if (root?.type !== 'identifier' || (root.text !== 'exports' && root.text !== 'module')) return
  if (!left.text.startsWith('exports.') && !left.text.startsWith('module.exports.')) return
  const prop = left.childForFieldName('property')
  const exportName = prop?.text
  if (!exportName || !right) return

  if (right.type === 'identifier') {
    promoteNodeExported(ctx, right.text, false, right)
    if (right.text !== exportName) {
      addNode(ctx, makeNode(ctx, exportName, 'variable', prop ?? right, true, null, false, null))
      emitContainsEdge(ctx, fileNodeId(ctx), right.text, exportName)
    }
    return
  }
  if (right.type === 'function_expression' || right.type === 'function') {
    const nameNode = right.childForFieldName('name')
    const name = nameNode?.text ?? exportName
    addNode(ctx, makeNode(ctx, name, 'function', right, true,
      extractFunctionSignature(right), isAsyncNode(right), extractJSDoc(right, ctx)))
    collectCallsFromBody(right, ctx, nodeId(ctx, name))
    return
  }
  if (right.type === 'class' || right.type === 'class_declaration') {
    processExportedClass(right, ctx, true)
    return
  }
  if (right.type === 'arrow_function') {
    addNode(ctx, makeNode(ctx, exportName, 'function', right, true,
      extractFunctionSignature(right), isAsyncNode(right), extractJSDoc(right, ctx)))
    collectCallsFromBody(right, ctx, nodeId(ctx, exportName))
  }
}

// ── decorators ──

function collectDecoratorsFromExport(
  exportNode: Parser.SyntaxNode,
  ctx: ParseContext,
): void {
  let classNodeId: string | null = null
  for (const child of exportNode.children) {
    if (
      child.type === 'class_declaration' || child.type === 'abstract_class_declaration' ||
      child.type === 'class'
    ) {
      const nameNode = child.childForFieldName('name') ?? findChildOfType(child, 'type_identifier')
      if (nameNode) { classNodeId = nodeId(ctx, nameNode.text); break }
    }
  }
  if (!classNodeId) return

  // class-level decorator edges — shared engine leaf (P3 STEP 2). class-export = decorates + deps + type_fn.
  emitMemberDecorators(
    exportNode.children
      .filter((child) => child.type === 'decorator')
      .map((child) => ({ node: child, info: getDecoratorInfo(child), emitCalls: false, emitDepsAndTypeFn: true })),
    classNodeId,
    ctx,
    TS_LANGUAGE_SPEC,
  )
}

// collectDecorators는 GAP-C-3 해소로 제거됨 (중복 발화 방지).
// class-level decorator는 collectDecoratorsFromExport 한 번만 발화한다.
// method-level decorator는 processClassBody의 인라인 루프가 직접 처리.

/**
 * method param decorator 수집.
 * 예: @Get('/orders/:id') findOne(@Param('id') id: string, @Body() dto: OrderDto)
 *   → method 노드에 'decorates' edge 추가 (target_symbol='Param', first_arg='id')
 *   → method 노드에 'decorates' edge 추가 (target_symbol='Body')
 *
 * 모두 method 노드를 source로 emit (param 자체는 별 노드 없음).
 * target_symbol에 decorator 이름 + first_arg에 param 이름 ('id', 'body' 등) 보존.
 */
function collectMethodParamDecorators(
  methodNode: Parser.SyntaxNode,
  ctx: ParseContext,
  methodId: string,
): void {
  const formalParams = findChildOfType(methodNode, 'formal_parameters')
  if (!formalParams) return
  // param decorators (@Param('id')/@Body()/@Query()) — shared engine leaf (P3 STEP 2).
  // decorates ONLY (no calls/deps/type_fn).
  const paramDecorators: DecoratorDescriptor<Parser.SyntaxNode>[] = []
  for (const param of formalParams.children) {
    if (param.type !== 'required_parameter' && param.type !== 'optional_parameter') continue
    for (const c of param.children) {
      if (c.type === 'decorator') {
        paramDecorators.push({ node: c, info: getDecoratorInfo(c), emitCalls: false, emitDepsAndTypeFn: false })
      }
    }
  }
  emitMemberDecorators(paramDecorators, methodId, ctx, TS_LANGUAGE_SPEC)
}

// DecoratorInfo는 common_engine/types.ts로 이동. getDecoratorInfo는 typescript_hooks/decorator.ts.
// P3 STEP 2: getDecoratorDependencyIdents/emitDependsOnEdges/emitDecoratorTypeFnEdges 래퍼는
//   common_engine/declaration_walker.ts emitMemberDecorators 로 흡수되어 제거됨 (decorates/calls/deps/type_fn 통합).

/**
 * Phase A3 — 함수 본문 const alias 추적.
 *
 * 패턴:
 *   function f() {
 *     const prisma = getPrismaDB()    // initializer가 import-bound function call
 *     prisma.x.find()                  // chain root='prisma' → getPrismaDB의 specifier
 *   }
 *
 * 미니버전: callNode에서 ascend하며 statement_block을 만날 때마다 `const ${ident} = X`를 찾고,
 * X의 chain root identifier가 importSymbolMap에 있으면 specifier 반환.
 * 가장 안쪽 (가장 가까운) const 우선 — shadowing 처리.
 *
 * 정책:
 *   - initializer가 call_expression / new_expression / member_expression / identifier일 때만 처리
 *   - destructure (const { x } = ...) skip
 *   - literal initializer (const x = 5) skip
 */
// resolveFunctionScopeAlias 클러스터(+ FunctionScopeAliasResolution / DestructuredConstAlias /
// findConstInitializer / findDestructuredConstAlias / findDestructuredPropertyForBinding /
// normalizeDestructuredKey / resolveInitializerSpecifier) → common_engine/call_edge_ops.ts 로 이동
// (extractCallEdge 와 함께). TS 어댑터는 engineExtractCallEdge 래퍼만 호출하므로 별도 래퍼 불필요.

/**
 * A2-2 — method 시그니처의 param/return type → type_ref edge.
 *
 * - formal_parameters의 각 param의 type_annotation 안 type_identifier 수집
 *   → subtype='method_param'
 * - return_type field 안 type_identifier 수집
 *   → subtype='return_type'
 *
 * primitive(string/number/...)는 tree-sitter가 predefined_type 노드로 분류 → 자동 skip.
 * Promise/Array 같은 wrapper도 type_identifier로 잡히지만 일관성 위해 그대로 발화 (importSymbolMap 미적중이면 specifier=null).
 */
function emitMethodSignatureTypeRefs(
  methodNode: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
): void {
  // params
  const formalParams = findChildOfType(methodNode, 'formal_parameters')
  if (formalParams) {
    for (const param of formalParams.children) {
      const typeAnn = findChildOfType(param, 'type_annotation')
      if (!typeAnn) continue
      const seen = new Set<string>()
      collectTypeIdentifiers(typeAnn, seen, TS_LANGUAGE_SPEC)
      for (const typeName of seen) {
        ctx.edges.push(makeEdge(ctx, {
          source_id: sourceId,
          target_id: null,
          relation: 'type_ref',
          target_specifier: ctx.importSymbolMap.get(typeName) ?? null,
          target_symbol: typeName,
          resolve_status: 'pending',
          first_arg: null,
          literal_args: null,
          type_ref_subtype: 'method_param',
        }))
      }
    }
  }
  // return type
  const returnType = methodNode.childForFieldName('return_type')
  if (returnType) {
    const seen = new Set<string>()
    collectTypeIdentifiers(returnType, seen, TS_LANGUAGE_SPEC)
    for (const typeName of seen) {
      ctx.edges.push(makeEdge(ctx, {
        source_id: sourceId,
        target_id: null,
        relation: 'type_ref',
        target_specifier: ctx.importSymbolMap.get(typeName) ?? null,
        target_symbol: typeName,
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
        type_ref_subtype: 'return_type',
      }))
    }
  }
}

/**
 * decorator의 객체 인자에서 의존성 식별자를 추출.
 * 예: @Module({ controllers: [OrderController], providers: [OrderService] })
 *   → ['OrderController', 'OrderService']
 *
 * 처리:
 *   - 객체 첫 인자만 분석
 *   - pair value가 array_literal이면 element 중 identifier만 수집
 *   - pair value가 identifier이면 그 자체 수집
 *   - 그 외 (object/literal/spread)는 무시
 */
export function extractDecoratorDependencies(
  argumentsNode: Parser.SyntaxNode | null,
  decoratorName: string | null = null,
): string[] {
  return engineExtractDecoratorDependencies(argumentsNode, decoratorName, TS_LANGUAGE_SPEC)
}

// getDecoratorInfo는 typescript_hooks/decorator.ts로 이동 (TS_LANGUAGE_SPEC + tsCallExtractor 바인딩 래퍼).
function getDecoratorInfo(decoratorNode: Parser.SyntaxNode) {
  return hookGetDecoratorInfo(decoratorNode, tsCallExtractor, TS_LANGUAGE_SPEC)
}

// ── calls 엣지 ──

function collectCallsFromBody(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
): void {
  collectCallExpressionsRecursive(node, ctx, sourceId, sourceId, findOwnedExecutableNode(node))
  emitLocalReceiverVariables(node, ctx, sourceId)
}

// v2-2 (def-use): emit a `variable` node for a LOCAL var used as a call receiver in this scope, so F5
// Pass C resolves the bare receiver → its declaration (Express `const router = Router(); router.get()`).
// Scope: receiver-used locals only; node id = `{sourceId}.{name}` so Pass C can find it as
// `{call.source_id}.{name}`. Top-level statements of this scope only (nested executables = follow-on).
const TS_NESTED_EXECUTABLE = new Set([
  'function_declaration', 'function_expression', 'arrow_function',
  'generator_function', 'generator_function_declaration', 'method_definition',
])

function emitLocalReceiverVariables(node: Parser.SyntaxNode, ctx: ParseContext, sourceId: string): void {
  const declared = new Map<string, Parser.SyntaxNode>()
  collectScopeLocalDeclarators(node, declared)
  if (declared.size === 0) return
  const receivers = new Set<string>()
  collectScopeReceiverRoots(node, receivers)
  for (const [name, declarator] of declared) {
    if (!receivers.has(name)) continue
    const varNode = makeNode(ctx, name, 'variable', declarator, false, null, false, null)
    varNode.id = `${sourceId}.${name}`   // scope-qualified so it is unique per (scope, name)
    addNode(ctx, varNode)
  }
}

function collectScopeLocalDeclarators(node: Parser.SyntaxNode, out: Map<string, Parser.SyntaxNode>): void {
  for (const child of node.namedChildren) {
    if (TS_NESTED_EXECUTABLE.has(child.type)) continue   // a nested fn owns its own scope
    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      for (const d of child.namedChildren) {
        if (d.type !== 'variable_declarator') continue
        const nm = d.childForFieldName('name')
        if (nm?.type === 'identifier' && !out.has(nm.text)) out.set(nm.text, d)
      }
    } else {
      collectScopeLocalDeclarators(child, out)   // descend into blocks (if/for/try), not functions
    }
  }
}

function collectScopeReceiverRoots(node: Parser.SyntaxNode, out: Set<string>): void {
  for (const child of node.namedChildren) {
    if (TS_NESTED_EXECUTABLE.has(child.type)) continue
    if (child.type === 'call_expression') {
      const fn = child.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        let obj = fn.childForFieldName('object')
        while (obj?.type === 'member_expression') obj = obj.childForFieldName('object')
        if (obj?.type === 'identifier') out.add(obj.text)
      }
    }
    collectScopeReceiverRoots(child, out)
  }
}

function findOwnedExecutableNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  if (isNestedExecutableNode(node)) return node
  if (node.type === 'call_expression' && isFunctionWrapperCall(node)) {
    const args = node.childForFieldName('arguments')
    return args?.children.find(isNestedExecutableNode) ?? null
  }
  return null
}

/**
 * P7: 함수 호출 인자의 import-bound identifier → depends_on edge.
 * 예: `throw new BadRequestException(STORE_ORDER_NOT_FOUND)` → STORE_ORDER_NOT_FOUND depends_on
 *     `fn(MY_CONST, OTHER_CONST)` → 각각 depends_on
 * 정책: importSymbolMap에 있는 identifier만 발화 (local var false positive 차단)
 */
function emitArgIdentifierDependsOn(
  argsNode: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
): void {
  // P19-A: 재귀 walk — top-level identifier뿐 아니라 객체/배열 안 identifier도 발화
  engineWalkIdentifiersForDependsOn(
    argsNode, ctx.repoId, ctx.importSymbolMap, TS_LANGUAGE_SPEC, sourceId, new Set<string>(), ctx.edges,
  )
}

// P19-A,B 공통 식별자 walk + import-bound depends_on 발화는 common_engine/edge_ops 로 이동
// (engineWalkIdentifiersForDependsOn / emitDependsOnIfImportBound). EngineNode + TS_LANGUAGE_SPEC 바인딩.

// P19-B: method/function body 안 import-bound identifier reference → depends_on
// (call args 외 standalone reference: `if (x > ORDER_LIMIT)`, `return CONST`, `const x = CONST` 등)
function emitBodyIdentifierDependsOn(
  body: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
): void {
  engineWalkIdentifiersForDependsOn(
    body, ctx.repoId, ctx.importSymbolMap, TS_LANGUAGE_SPEC, sourceId, new Set<string>(), ctx.edges,
  )
}

// collectCallExpressionsRecursive 의 재귀 walk 본체는 common_engine/walk_engine.ts
// (walkCallsAndNestedExecutables) 로 수렴. TS 어댑터는 thin wrapper + TS-문법 전용 hook
// (JSX render / generic-misparse 복구 / function-wrapper 소유 / leading-comment) 만 제공한다.
// 엔진은 nested-exec/call/dynamic-import/assignment/new 분기 + arg depends_on + 재귀를 소유.
function tsWalkHooks(ctx: ParseContext): LanguageHooks<Parser.SyntaxNode> {
  return {
    leadingComment: (n) => extractLeadingComment(n, ctx),
    findOwnedExecutableNode: (n) => findOwnedExecutableNode(n),
    handleSpecialNode: (node, sourceId, nonCallSourceId, owned) => {
      if (node.type === 'jsx_element' || node.type === 'jsx_self_closing_element') {
        // E5 — JSX 컴포넌트 사용 → renders edge. 자식 재귀는 엔진이 수행(return false).
        extractJsxRenderEdge(node, ctx, nonCallSourceId)
        return false
      }
      if (node.type === 'binary_expression' &&
        tryRecoverGenericCallFromBinary(node, ctx, sourceId, nonCallSourceId, owned)) {
        // Misparsed generic call 복구 완료 — 자식 재re-walk 안 함(type-arg subtree의 spurious import 방지).
        return true
      }
      return false
    },
  }
}

function collectCallExpressionsRecursive(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
  nonCallSourceId = sourceId,
  ownedExecutableNode: Parser.SyntaxNode | null = null,
): void {
  engineWalkCallsAndNestedExecutables(
    node, ctx, sourceId, nonCallSourceId, ownedExecutableNode, TS_LANGUAGE_SPEC, tsCallExtractor, tsWalkHooks(ctx),
  )
}

// tree-sitter (no type-checker) cannot disambiguate `CALLEE<T>(args)` from a chained
// comparison, so the specific shape `CALLEE<typeof import('x')>(args)` — whose type
// argument contains a parenthesized `import()` type query — parses as a COMPARISON
// `binary_expression` (`CALLEE < T > (args)`) instead of a call_expression, and the
// outer call edge is otherwise lost. Recover it CONSERVATIVELY: only when the node is
// exactly `( <«op<»> ) > ( parenthesized_expression )` whose inner-left's leftmost is an
// identifier/member_expression. Returns true when an edge was recovered (caller then
// skips re-walking children — notably the type-argument subtree, which itself contains
// the `import('x')` call_expression that must NOT emit a spurious call).
// Common generics (`useState<number>(0)`, `axios.get<R>(url)`) keep parsing as
// call_expression and never reach here.
function tryRecoverGenericCallFromBinary(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
  nonCallSourceId: string,
  ownedExecutableNode: Parser.SyntaxNode | null,
): boolean {
  // Outer binary must be `... > (parenthesized)`.
  if (node.childForFieldName('operator')?.text !== '>') return false
  const right = node.childForFieldName('right')
  if (right?.type !== 'parenthesized_expression') return false
  const inner = node.childForFieldName('left')
  // Inner binary must be `LEFTMOST < TYPEARG`.
  if (inner?.type !== 'binary_expression') return false
  if (inner.childForFieldName('operator')?.text !== '<') return false
  const innerLeft = inner.childForFieldName('left')
  if (!innerLeft) return false
  // Leftmost (await-unwrapped) must be a plain identifier or member chain — never a
  // call/comparison etc. This keeps a genuine `(a < b) > (c)` from being treated as a call.
  const calleeNode = unwrapCallFunction(innerLeft)
  if (calleeNode.type !== 'identifier' && calleeNode.type !== 'member_expression') return false

  // Recovered as `CALLEE(ARGS)`. `right` is the call's parenthesized argument list;
  // normalize it into an arguments-shaped node so the standard call-arg extraction runs.
  const argsNode = parenthesizedToArgsNode(right)
  extractCallEdge(calleeNode, argsNode, ctx, sourceId)

  // Mirror the call_expression branch: walk the receiver object (member chains) and the
  // recovered argument expressions for nested calls / depends_on. The type-argument
  // subtree (inner's right child) is deliberately NOT walked.
  if (calleeNode.type === 'member_expression') {
    const obj = calleeNode.childForFieldName('object')
    if (obj) collectCallExpressionsRecursive(obj, ctx, sourceId, nonCallSourceId, ownedExecutableNode)
  }
  if (argsNode) {
    emitArgIdentifierDependsOn(argsNode, ctx, nonCallSourceId)
    for (const arg of argsNode.children) {
      collectCallExpressionsRecursive(arg, ctx, sourceId, nonCallSourceId, ownedExecutableNode)
    }
  }
  return true
}

// A recovered generic call's arguments live inside a `parenthesized_expression`, not an
// `arguments` node. For a single argument `('x')` the parenthesized node already filters
// correctly (children `(` expr `)`). For multiple args `('x', y)` the lone content is a
// `sequence_expression` (`'x' , y`) whose comma-separated children are the real args —
// return that so extractCallArgs filters the commas and yields each argument.
function parenthesizedToArgsNode(paren: Parser.SyntaxNode): Parser.SyntaxNode {
  const content = paren.namedChildren[0]
  if (content?.type === 'sequence_expression') return content
  return paren
}

function isNestedExecutableNode(node: Parser.SyntaxNode): boolean {
  return engineIsNestedExecutableNode(node, TS_LANGUAGE_SPEC)
}

// collectNestedExecutableNode / syntaxRangeKey / sameSyntaxRange 는 walk_engine.ts 가 소유.
// S5 에서 재귀 walk 가 엔진으로 수렴하면서 TS wrapper 들의 호출부가 모두 엔진 내부로 이동 → 제거.

// nestedExecutableRole 와 extractBrowserLocationAssignmentEdge 의 TS wrapper 는 S5 에서 호출부가
// walk_engine 내부로 옮겨가 orphan 이 됐다 → 제거 (엔진이 engine 버전을 직접 호출).

// ── E5: JSX 처리 ──

/**
 * jsx_element / jsx_self_closing_element → renders edge.
 * - 대문자 시작 컴포넌트만 (HTML element 무시)
 * - <Foo.Bar /> namespace는 fn.text 그대로 target_symbol
 * - attributes → literal_args (E4와 같은 형식)
 */
function extractJsxRenderEdge(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
  sourceId: string,
): void {
  // jsx_element는 jsx_opening_element를, jsx_self_closing_element는 자기 자신을 사용
  const elementWithName =
    node.type === 'jsx_self_closing_element'
      ? node
      : node.children.find((c) => c.type === 'jsx_opening_element')
  if (!elementWithName) return

  // name: identifier or member_expression
  let nameNode: Parser.SyntaxNode | null = null
  for (const c of elementWithName.children) {
    if (c.type === 'identifier' || c.type === 'member_expression' || c.type === 'nested_identifier') {
      nameNode = c
      break
    }
  }
  if (!nameNode) return

  const componentName = nameNode.text
  // 대문자 시작 컴포넌트 또는 관계 추출에 의미 있는 HTML element만 기록.
  // Fragment <></> 는 nameNode 자체가 없어 위에서 return
  if (!ceShouldRecordRenderTarget(componentName, TS_LANGUAGE_SPEC)) {
    return
  }

  // root identifier 추출 (namespace.X에서 namespace)
  const rootIdent = nameNode.type === 'identifier' ? componentName : componentName.split('.')[0]
  const targetSpecifier = ctx.importSymbolMap.get(rootIdent) ?? null

  // attributes 수집
  const literalArgs = extractJsxAttributes(elementWithName)
  const firstArg = extractJsxFirstTargetArg(elementWithName)

  ctx.edges.push(makeEdge(ctx, {
    source_id: sourceId,
    target_id: null,
    relation: 'renders',
    target_specifier: targetSpecifier,
    target_symbol: componentName,
    resolve_status: 'pending',
    first_arg: firstArg,
    literal_args: literalArgs,
    chain_path: null,
  }))
}

// SEMANTIC_RENDER_ELEMENTS → TS_LANGUAGE_SPEC.semanticRenderElements + render_ops.shouldRecordRenderTarget (S2 추출).

/**
 * jsx_opening_element / jsx_self_closing_element의 attributes → literal_args JSON.
 * 한 객체 안에 prop 키-값 매핑 (E4 객체 walk와 같은 규칙).
 *   <Foo x="hello" n={5} enabled /> → '[{"x":"hello","n":5,"enabled":true}]'
 *   attributes 없음 → null
 */
function extractJsxAttributes(elementNode: Parser.SyntaxNode): string | null {
  const attrs: LiteralObject = {}
  let hasAny = false
  for (const c of elementNode.children) {
    if (c.type !== 'jsx_attribute') continue
    hasAny = true
    const keyNode = c.children.find((x) => x.type === 'property_identifier')
    if (!keyNode) continue
    const key = keyNode.text
    // value: string literal, jsx_expression, 또는 없음 (bare boolean)
    const valueNode = c.children.find(
      (x) => x.type === 'string' || x.type === 'jsx_expression',
    )
    if (!valueNode) {
      // bare boolean attribute: <Foo enabled />
      attrs[key] = true
    } else if (valueNode.type === 'string') {
      const stripped = valueNode.text.replace(/^['"`]|['"`]$/g, '')
      // eslint-disable-next-line no-control-regex
      if (/\x00/.test(stripped) || stripped.length > MAX_STRING_LENGTH) {
        attrs[key] = null
      } else {
        attrs[key] = stripped
      }
    } else {
      // jsx_expression: { ... } — 안 expression이 number/boolean/literal이면 추출, 아니면 null
      const inner = valueNode.children.find((x) => x.isNamed)
      if (!inner) {
        attrs[key] = null
      } else {
        attrs[key] = extractLiteralValue(inner, 1)  // depth 1부터
      }
    }
  }
  if (!hasAny) return null
  try {
    const serialized = JSON.stringify([attrs])
    return serialized.length <= MAX_LITERAL_ARGS_LENGTH ? serialized : null
  } catch {
    return null
  }
}

function extractJsxFirstTargetArg(elementNode: Parser.SyntaxNode): string | null {
  for (const key of ['href', 'to', 'action']) {
    const attr = findJsxAttribute(elementNode, key)
    if (!attr) continue
    const value = extractJsxStaticishAttributeValue(attr)
    if (value) return value
  }
  return null
}

function findJsxAttribute(elementNode: Parser.SyntaxNode, name: string): Parser.SyntaxNode | null {
  for (const child of elementNode.children) {
    if (child.type !== 'jsx_attribute') continue
    const keyNode = child.children.find((x) => x.type === 'property_identifier')
    if (keyNode?.text === name) return child
  }
  return null
}

function extractJsxStaticishAttributeValue(attributeNode: Parser.SyntaxNode): string | null {
  const valueNode = attributeNode.children.find(
    (x) => x.type === 'string' || x.type === 'jsx_expression',
  )
  if (!valueNode) return null
  if (valueNode.type === 'string') {
    const stripped = valueNode.text.replace(/^['"`]|['"`]$/g, '')
    // eslint-disable-next-line no-control-regex
    return /\x00/.test(stripped) || stripped.length > MAX_STRING_LENGTH ? null : stripped
  }

  const inner = valueNode.children.find((x) => x.isNamed)
  if (!inner) return null
  return extractStaticishExpressionText(inner)
}

// extractStaticishExpressionText → common_engine/node_ops.ts (engine_a, 노드타입·필드·구두점 spec 치환).
function extractStaticishExpressionText(node: Parser.SyntaxNode): string | null {
  return engineExtractStaticishExpressionText(node, TS_LANGUAGE_SPEC)
}

/**
 * E6 — member_expression의 object 부분을 chain_path 문자열로 변환.
 * 예: prisma.order → 'prisma.order', this.svc → 'this.svc', super → 'super'
 */
// chain 추출은 common_engine/chain_extractor 로 이동 (TS_LANGUAGE_SPEC 바인딩 래퍼).
// Parser.SyntaxNode 는 EngineNode 에 구조적으로 assignable → cast 불필요.
function extractChainPath(objNode: Parser.SyntaxNode | null): string | null {
  return ceExtractChainPath(objNode)
}

function unwrapCallFunction(node: Parser.SyntaxNode): Parser.SyntaxNode {
  return ceUnwrapCallFunction(node, TS_LANGUAGE_SPEC)
}

function findChainRootIdentifier(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
  return ceFindChainRootIdentifier(node, TS_LANGUAGE_SPEC)
}

function isChainRootedAtThis(node: Parser.SyntaxNode | null): boolean {
  return ceIsChainRootedAtThis(node, TS_LANGUAGE_SPEC)
}

// extractCallEdge (+ findObjectPropertyKeyForExpression) → common_engine/call_edge_ops.ts.
// 어댑터는 EXACT 원형 시그니처를 유지하는 thin wrapper 만 둔다 (call site 불변).
function extractCallEdge(
  fn: Parser.SyntaxNode,
  argsNode: Parser.SyntaxNode | null,
  ctx: ParseContext,
  sourceId: string,
): void {
  const callEdgeCtx: CallEdgeCtx = {
    repoId: ctx.repoId,
    filePath: ctx.filePath,
    importSymbolMap: ctx.importSymbolMap,
    nodes: ctx.nodes,
    edges: ctx.edges,
    currentClassKey: ctx.currentClassKey,
  }
  engineExtractCallEdge(fn, argsNode, callEdgeCtx, sourceId, TS_LANGUAGE_SPEC, tsCallExtractor)
}

// callTargetName → common_engine/node_ops.ts (engine_a, identifier/member_expression·property spec 치환).
function callTargetName(fn: Parser.SyntaxNode): string | null {
  return engineCallTargetName(fn, TS_LANGUAGE_SPEC)
}

// isCalleeRootedAtThis / emitEnclosingClassCallEdge → common_engine/call_edge_ops.ts
// (extractCallEdge 클러스터와 함께 이동). 어댑터에는 engineExtractCallEdge 래퍼만 남는다.

function emitDataCallbackReferenceCalls(
  calleeName: string | null,
  argExpressions: CallArgExpression[] | null,
  ctx: ParseContext,
  sourceId: string,
): void {
  engineEmitDataCallbackReferenceCalls(calleeName, argExpressions, ctx.repoId, ctx.importSymbolMap, sourceId, ctx.edges)
}

function getRootObject(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  return ceGetRootObject(node, TS_LANGUAGE_SPEC)
}

// ── signature 추출 ──

function extractFunctionSignature(node: Parser.SyntaxNode): string | null {
  return engineExtractFunctionSignature(node, TS_LANGUAGE_SPEC)
}

// ── is_async 탐지 ──

function isAsyncNode(node: Parser.SyntaxNode): boolean {
  return engineIsAsyncNode(node, TS_LANGUAGE_SPEC)
}

// ── JSDoc 추출 ──

function extractJSDoc(node: Parser.SyntaxNode, ctx: ParseContext): string | null {
  const startLine = findDeclarationCommentAnchorLine(node, ctx)
  if (startLine === 0) return null

  // 바로 위 줄부터 위쪽으로 탐색
  let endLine = startLine - 1
  // 공백 줄 스킵
  while (endLine >= 0 && ctx.sourceLines[endLine].trim() === '') endLine--
  if (endLine < 0) return null

  const leadingRange = findRegularLeadingCommentRangeEndingAt(endLine, ctx)
  if (leadingRange) endLine = leadingRange.start - 1
  while (endLine >= 0 && ctx.sourceLines[endLine].trim() === '') endLine--
  if (endLine < 0) return null

  const trimmed = ctx.sourceLines[endLine].trim()
  if (!trimmed.endsWith('*/')) return null

  // /** ... */ 블록 찾기
  let startJDoc = endLine
  while (startJDoc >= 0 && !ctx.sourceLines[startJDoc].trim().startsWith('/**')) {
    startJDoc--
  }
  if (startJDoc < 0) return null

  const jsdocLines = ctx.sourceLines.slice(startJDoc, endLine + 1)
  const jsdoc = jsdocLines.join('\n').trim()
  return jsdoc.length > 0 ? jsdoc : null
}

function extractLeadingComment(node: Parser.SyntaxNode, ctx: ParseContext): string | null {
  const startLine = findDeclarationCommentAnchorLine(node, ctx)
  if (startLine === 0) return null

  let endLine = startLine - 1
  while (endLine >= 0 && ctx.sourceLines[endLine].trim() === '') endLine--
  if (endLine < 0) return null

  const range = findRegularLeadingCommentRangeEndingAt(endLine, ctx)
  if (!range) return null
  const comment = ctx.sourceLines.slice(range.start, range.end + 1).join('\n').trim()
  return comment.length > 0 ? comment : null
}

function findDeclarationCommentAnchorLine(
  node: Parser.SyntaxNode,
  ctx: ParseContext,
): number {
  let line = node.startPosition.row
  while (line > 0) {
    const previous = ctx.sourceLines[line - 1].trim()
    if (previous === '' || previous.startsWith('@')) {
      line--
      continue
    }
    break
  }
  return line
}

function findRegularLeadingCommentRangeEndingAt(
  endLine: number,
  ctx: ParseContext,
): { start: number; end: number } | null {
  const trimmed = ctx.sourceLines[endLine].trim()

  if (trimmed.startsWith('//')) {
    if (isToolingComment(trimmed)) return null
    let start = endLine
    while (start - 1 >= 0) {
      const prev = ctx.sourceLines[start - 1].trim()
      if (!prev.startsWith('//') || isToolingComment(prev)) break
      start--
    }
    return { start, end: endLine }
  }

  if (trimmed.endsWith('*/')) {
    let start = endLine
    while (start >= 0 && !ctx.sourceLines[start].trim().startsWith('/*')) start--
    if (start < 0) return null
    const first = ctx.sourceLines[start].trim()
    if (first.startsWith('/**') || isToolingComment(first)) return null
    return { start, end: endLine }
  }

  return null
}

function isToolingComment(commentLine: string): boolean {
  return /(?:eslint|prettier|istanbul)\s+(?:disable|ignore)/.test(commentLine)
}

// ── 노드 생성 / 등록 헬퍼 ──

function makeNode(
  ctx: ParseContext,
  name: string,
  type: CodeNodeType,
  astNode: Parser.SyntaxNode,
  exported: boolean,
  signature: string | null,
  isAsync: boolean,
  jsdoc: string | null,
  isDefaultExport = false,
): CodeNodeRaw {
  return {
    id: nodeId(ctx, name),
    repo_id: ctx.repoId,
    type,
    file_path: ctx.filePath,
    name,
    line_start: astNode.startPosition.row + 1,
    line_end: astNode.endPosition.row + 1,
    signature,
    exported,
    is_default_export: isDefaultExport || undefined,
    parse_status: 'ok',
    is_test: false,  // 심볼 노드는 false (parsePass1에서 file의 isTest 반영 안 함 — 어댑터 레벨)
    test_type: null,
    is_async: isAsync,
    jsdoc,
    leading_comment: extractLeadingComment(astNode, ctx),
  }
}

function makeEdge(
  ctx: ParseContext,
  opts: {
    source_id: string
    target_id: string | null
    relation: EdgeRelation
    target_specifier: string | null
    target_symbol: string | null
    target_imported_symbol?: string | null
    target_local_symbol?: string | null
    resolve_status: CodeEdgeRaw['resolve_status']
    first_arg: string | null
    literal_args: string | null
    arg_expressions?: CodeEdgeRaw['arg_expressions']
    chain_path?: string | null
    type_ref_subtype?: CodeEdgeRaw['type_ref_subtype']
    destructured_alias_root?: string | null
    destructured_alias_property?: string | null
  },
): CodeEdgeRaw {
  // A-7: delegate to the shared engine leaf (byte-identical; dart routes the same way).
  return engineMakeEdge(ctx.repoId, opts)
}

function nodeId(ctx: ParseContext, name: string): string {
  return engineNodeId(ctx.repoId, ctx.filePath, name) // A-8b: delegate (byte-identical)
}

function fileNodeId(ctx: ParseContext): string {
  return engineFileNodeId(ctx.repoId, ctx.filePath) // A-8b: delegate (byte-identical)
}

// node factory: common_engine/node_factory_ops.ts 로 위임 (ctx.nodes + ctx.sourceLines 만 풀어 넘김).
function addNode(ctx: ParseContext, node: CodeNodeRaw): void {
  engineAddNode(ctx.nodes, node, ctx.sourceLines)
}

function promoteNodeExported(
  ctx: ParseContext,
  name: string,
  isDefaultExport: boolean,
  astNode: Parser.SyntaxNode,
  exported = true,
): void {
  const id = nodeId(ctx, name)
  const existingIdx = ctx.nodes.findIndex((n) => n.id === id || n.id.startsWith(`${id}:`))
  if (existingIdx !== -1) {
    const existing = ctx.nodes[existingIdx]
    ctx.nodes[existingIdx] = {
      ...existing,
      exported: existing.exported || exported,
      is_default_export: existing.is_default_export || isDefaultExport || undefined,
    }
    return
  }
  addNode(ctx, makeNode(ctx, name, 'variable', astNode, exported, null, false, null, isDefaultExport))
}

// ── 유틸 ── (findChildOfType = 공유 firstChildOfType, A-6 통합)
