/**
 * F3a: pickTargetInFile — default import resolution 보강 테스트
 * SOT: specs/build_graph/specs/f3a_resolve_import_edges/spec.md §5.5
 *
 * 신규 동작: targetSymbol==='default'이면 is_default_export=true 노드를 우선 매칭.
 */
import { describe, it, expect } from 'vitest'

import {
  resolveImportEdges,
  type ResolverConfig,
} from '@/pipeline_modules/build_graph/f3a_resolve_import_edges.js'
import type { CodeNodeRaw, CodeEdgeRaw, SourceFile } from '@/pipeline_modules/build_graph/types.js'

// ────────────────────────────────────────────────
// 헬퍼
// ────────────────────────────────────────────────

const REPO = '/repo'
const REPO_ID = 'p1'

function makeNode(
  filePath: string,
  name: string,
  type: CodeNodeRaw['type'],
  opts: Partial<CodeNodeRaw> = {},
): CodeNodeRaw {
  return {
    id: `${REPO_ID}:${filePath}${name ? `:${name}` : ''}`,
    repo_id: REPO_ID,
    file_path: filePath,
    name: name || filePath,
    type,
    line_start: null,
    line_end: null,
    signature: null,
    exported: true,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
    ...opts,
  }
}

function makeFileNode(filePath: string): CodeNodeRaw {
  return makeNode(filePath, 'file', 'file', { exported: false })
}

function makeDefaultExportNode(filePath: string, symbolName: string): CodeNodeRaw {
  return makeNode(filePath, symbolName, 'class', {
    is_default_export: true,
    exported: true,
  })
}

function makeNamedNode(filePath: string, symbolName: string): CodeNodeRaw {
  return makeNode(filePath, symbolName, 'function', {
    exported: true,
  })
}

function makeDefaultNameNode(filePath: string): CodeNodeRaw {
  // anonymous export default class {} 같이 어댑터가 name='default'으로 저장한 노드
  return makeNode(filePath, 'default', 'class', {
    exported: true,
    is_default_export: false,
  })
}

function makeEdge(
  sourceId: string,
  specifier: string,
  symbol: string | null,
  overrides: Partial<CodeEdgeRaw> = {},
): CodeEdgeRaw {
  return {
    repo_id: REPO_ID,
    source_id: sourceId,
    target_id: null,
    relation: 'imports',
    target_specifier: specifier,
    target_symbol: symbol,
    source: 'static',
    resolve_status: 'pending',
    first_arg: null,
    literal_args: null,
    ...overrides,
  }
}

function makeFile(filePath: string): SourceFile {
  return { path: filePath, content: '', isTest: false }
}

function makeConfig(): ResolverConfig {
  return {
    pathAliases: {},
    baseUrl: '',
    repoPath: REPO,
  }
}

// ────────────────────────────────────────────────
// 테스트
// ────────────────────────────────────────────────

describe('F3a pickTargetInFile — default import resolution', () => {

  /**
   * F-01: import default가 is_default_export=true 노드 직접 가리킴
   *
   * import MyButton from './my-button'  (target_symbol='default')
   * my-button.tsx에 MyButton 클래스 노드 (is_default_export=true)
   * → import edge의 target_id = MyButton 노드 ID
   */
  it('F-01: default import → is_default_export=true 노드 직접 매칭', async () => {
    const srcFile = 'src/other.ts'
    const targetFile = 'src/my-button.tsx'

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(targetFile),
      makeDefaultExportNode(targetFile, 'MyButton'),
    ]

    const edges: CodeEdgeRaw[] = [
      makeEdge(`${REPO_ID}:${srcFile}:file`, './my-button', 'default'),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(targetFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    const myButtonNodeId = `${REPO_ID}:${targetFile}:MyButton`
    expect(resolved).toHaveLength(1)
    expect(resolved[0].target_id).toBe(myButtonNodeId)
    expect(resolved[0].resolve_status).toBe('resolved')
  })

  /**
   * F-02: 같은 파일에 is_default_export=true 노드는 하나뿐 — 단일 매칭 보장
   *
   * 동시에 두 export default는 JS/TS에서 문법 오류이므로
   * 어댑터가 최대 1개만 is_default_export=true로 표시함.
   * 이 테스트는 단일 매칭이 올바르게 작동하는지를 문서화한다.
   */
  it('F-02: is_default_export=true 노드가 하나뿐이면 단일 매칭 보장', async () => {
    const srcFile = 'src/consumer.ts'
    const targetFile = 'src/service.ts'

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(targetFile),
      makeDefaultExportNode(targetFile, 'MyService'),
      // named export는 is_default_export 없음 (default 아님)
      makeNamedNode(targetFile, 'helper'),
    ]

    const edges: CodeEdgeRaw[] = [
      makeEdge(`${REPO_ID}:${srcFile}:file`, './service', 'default'),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(targetFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    const myServiceNodeId = `${REPO_ID}:${targetFile}:MyService`
    expect(resolved).toHaveLength(1)
    expect(resolved[0].target_id).toBe(myServiceNodeId)
  })

  /**
   * F-03: default import + named import 동시 — 혼선 없음
   *
   * import MyButton, { helper } from './lib'
   * → default → MyButton (is_default_export=true)
   * → named  → helper (named node)
   */
  it('F-03: default + named import 동시 — 각자 올바른 노드 매칭', async () => {
    const srcFile = 'src/app.ts'
    const targetFile = 'src/lib.ts'

    const myButtonNode = makeDefaultExportNode(targetFile, 'MyButton')
    const helperNode = makeNamedNode(targetFile, 'helper')

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(targetFile),
      myButtonNode,
      helperNode,
    ]

    const edges: CodeEdgeRaw[] = [
      makeEdge(`${REPO_ID}:${srcFile}:file`, './lib', 'default'),
      makeEdge(`${REPO_ID}:${srcFile}:file`, './lib', 'helper'),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(targetFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    expect(resolved).toHaveLength(2)

    const defaultEdge = resolved.find(e => e.target_symbol === 'default')
    const namedEdge = resolved.find(e => e.target_symbol === 'helper')

    expect(defaultEdge?.target_id).toBe(`${REPO_ID}:${targetFile}:MyButton`)
    expect(namedEdge?.target_id).toBe(`${REPO_ID}:${targetFile}:helper`)
  })

  /**
   * F-04: default 노드 없음 + name='default' 노드 있음 → 그 노드로 resolve
   *
   * anonymous export default class {} 같이 어댑터가 name='default'으로 저장하고
   * is_default_export=false(미지정)인 경우 — 기존 fallback 유지
   */
  it('F-04: is_default_export 노드 없음 + name=default 노드 있음 → name=default 노드 fallback', async () => {
    const srcFile = 'src/consumer.ts'
    const targetFile = 'src/anon.ts'

    const defaultNameNode = makeDefaultNameNode(targetFile)

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(targetFile),
      defaultNameNode,
    ]

    const edges: CodeEdgeRaw[] = [
      makeEdge(`${REPO_ID}:${srcFile}:file`, './anon', 'default'),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(targetFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    const defaultNameNodeId = `${REPO_ID}:${targetFile}:default`
    expect(resolved).toHaveLength(1)
    expect(resolved[0].target_id).toBe(defaultNameNodeId)
    expect(resolved[0].resolve_status).toBe('resolved')
  })

  /**
   * F-05: default 노드 없음 + name='default' 노드도 없음 → file 노드 fallback (마지막 안전망)
   */
  it('F-05: is_default_export 노드도 없고 name=default 노드도 없음 → file 노드 fallback', async () => {
    const srcFile = 'src/consumer.ts'
    const targetFile = 'src/no-default.ts'

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(targetFile),
      // named export만 있고 default export가 전혀 없는 파일
      makeNamedNode(targetFile, 'someHelper'),
    ]

    const edges: CodeEdgeRaw[] = [
      makeEdge(`${REPO_ID}:${srcFile}:file`, './no-default', 'default'),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(targetFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    // file 노드 ID: makeFileNode 생성 규칙 = `p1:${targetFile}:file`
    const fileNodeId = `${REPO_ID}:${targetFile}:file`
    expect(resolved).toHaveLength(1)
    expect(resolved[0].target_id).toBe(fileNodeId)
    expect(resolved[0].resolve_status).toBe('resolved')
  })

  /**
   * F-06: named import는 is_default_export 로직의 영향 없음
   *
   * import { X } from './m' → name='X' 노드 매칭 (기존 동작 불변)
   */
  it('F-06: named import는 is_default_export 로직 영향 없음 — name=X 노드 직접 매칭', async () => {
    const srcFile = 'src/consumer.ts'
    const targetFile = 'src/module.ts'

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(targetFile),
      // default export 노드도 있지만 named import는 X를 찾아야 함
      makeDefaultExportNode(targetFile, 'DefaultClass'),
      makeNamedNode(targetFile, 'X'),
    ]

    const edges: CodeEdgeRaw[] = [
      makeEdge(`${REPO_ID}:${srcFile}:file`, './module', 'X'),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(targetFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    expect(resolved).toHaveLength(1)
    expect(resolved[0].target_id).toBe(`${REPO_ID}:${targetFile}:X`)
    expect(resolved[0].resolve_status).toBe('resolved')
  })
})

// ────────────────────────────────────────────────
// F-07/F-08: barrel default re-export traversal
// 4.c 제거 + 5단계 walkReExports에 is_default_export 매칭 추가 검증
// ────────────────────────────────────────────────

describe('F3a default import — barrel re-export', () => {

  /**
   * F-07: barrel `export { default } from './x'` + named default class
   *
   * barrel.ts: re_exports edge target_symbol='default', target_specifier='./my-button'
   * my-button.tsx: { name: 'MyButton', is_default_export: true }
   * consumer.ts: import Btn from './barrel'  (target_symbol='default')
   *
   * 기대: 4단계 need_barrel → 5단계 walkNamed → my-button.tsx에서 is_default_export 매칭
   * → target_id = MyButton 노드 (이전: 4.c가 barrel.ts:file로 끝냈음)
   */
  it('F-07: barrel export {default} from + named default class → MyButton 정확 매핑', async () => {
    const srcFile = 'src/consumer.ts'
    const barrelFile = 'src/barrel.ts'
    const buttonFile = 'src/my-button.tsx'

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(barrelFile),
      makeFileNode(buttonFile),
      makeDefaultExportNode(buttonFile, 'MyButton'),
    ]

    const edges: CodeEdgeRaw[] = [
      // barrel.ts의 re_exports edge (소비자 import 처리 전에 인덱싱돼야 walkReExports가 찾음)
      {
        repo_id: REPO_ID,
        source_id: `${REPO_ID}:${barrelFile}:file`,
        target_id: null,
        relation: 're_exports',
        target_specifier: './my-button',
        target_symbol: 'default',
        source: 'static',
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      },
      // 소비자의 default import
      makeEdge(`${REPO_ID}:${srcFile}:file`, './barrel', 'default'),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(barrelFile), makeFile(buttonFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    // 소비자 import edge 찾기 (re_exports edge도 같이 풀려서 결과에 섞임)
    const consumerImport = resolved.find(e =>
      e.source_id === `${REPO_ID}:${srcFile}:file` && e.relation === 'imports')
    expect(consumerImport).toBeDefined()
    expect(consumerImport!.resolve_status).toBe('resolved')
    expect(consumerImport!.target_id).toBe(`${REPO_ID}:${buttonFile}:MyButton`)
  })

  /**
   * F-08: 2-hop barrel default chain
   *
   * b1.ts → b2.ts → my-button.tsx 두 단계 default re-export
   * 5단계 재귀 통해 최종 my-button.tsx의 MyButton 노드 매핑
   */
  it('F-08: 2-hop barrel default chain → 최종 MyButton 노드 정확 매핑', async () => {
    const srcFile = 'src/consumer.ts'
    const b1File = 'src/b1.ts'
    const b2File = 'src/b2.ts'
    const buttonFile = 'src/my-button.tsx'

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(b1File),
      makeFileNode(b2File),
      makeFileNode(buttonFile),
      makeDefaultExportNode(buttonFile, 'MyButton'),
    ]

    const edges: CodeEdgeRaw[] = [
      // b1.ts: export { default } from './b2'
      {
        repo_id: REPO_ID,
        source_id: `${REPO_ID}:${b1File}:file`,
        target_id: null,
        relation: 're_exports',
        target_specifier: './b2',
        target_symbol: 'default',
        source: 'static',
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      },
      // b2.ts: export { default } from './my-button'
      {
        repo_id: REPO_ID,
        source_id: `${REPO_ID}:${b2File}:file`,
        target_id: null,
        relation: 're_exports',
        target_specifier: './my-button',
        target_symbol: 'default',
        source: 'static',
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      },
      // 소비자의 default import (b1 경유)
      makeEdge(`${REPO_ID}:${srcFile}:file`, './b1', 'default'),
    ]

    const files: SourceFile[] = [
      makeFile(srcFile), makeFile(b1File), makeFile(b2File), makeFile(buttonFile),
    ]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    const consumerImport = resolved.find(e =>
      e.source_id === `${REPO_ID}:${srcFile}:file` && e.relation === 'imports')
    expect(consumerImport).toBeDefined()
    expect(consumerImport!.resolve_status).toBe('resolved')
    expect(consumerImport!.target_id).toBe(`${REPO_ID}:${buttonFile}:MyButton`)
  })

  /**
   * F-09: barrel `export { default as emailService }` → object-literal default export
   *
   * services/index.ts: re_exports edge target_symbol='emailService' (공개 이름),
   *   target_imported_symbol='default', target_specifier='./email.service'
   * email.service.ts: `export default { sendResetPasswordEmail, ... }` →
   *   default-export 노드 없음, file 노드에서 멤버 const로 contains edge만 존재.
   * consumer.ts: import { emailService } from '../services'  (target_symbol='emailService')
   *
   * 기대: walkReExports가 alias(emailService)로 re-export edge를 찾고, imported symbol(default)이
   * object default라 노드가 없으므로 email.service.ts file 노드로 해석.
   * (그래야 F5가 file 노드의 contains 멤버로 emailService.sendResetPasswordEmail을 푼다.)
   */
  it('F-09: barrel { default as alias } → object default (no default node) → 대상 file 노드 매핑', async () => {
    const srcFile = 'src/controllers/auth.controller.ts'
    const barrelFile = 'src/services/index.ts'
    const svcFile = 'src/services/email.service.ts'

    const nodes: CodeNodeRaw[] = [
      makeFileNode(srcFile),
      makeFileNode(barrelFile),
      makeFileNode(svcFile),
      // email.service.ts의 top-level const (object default가 shorthand로 참조).
      // default-export 노드는 없음 (object literal default).
      makeNamedNode(svcFile, 'sendResetPasswordEmail'),
    ]

    const edges: CodeEdgeRaw[] = [
      // services/index.ts: export { default as emailService } from './email.service'
      {
        repo_id: REPO_ID,
        source_id: `${REPO_ID}:${barrelFile}:file`,
        target_id: null,
        relation: 're_exports',
        target_specifier: './email.service',
        target_symbol: 'emailService',
        target_imported_symbol: 'default',
        source: 'static',
        resolve_status: 'pending',
        first_arg: null,
        literal_args: null,
      },
      // email.service.ts: object default의 contains edge (file 노드 → 멤버 const)
      {
        repo_id: REPO_ID,
        source_id: `${REPO_ID}:${svcFile}:file`,
        target_id: `${REPO_ID}:${svcFile}:sendResetPasswordEmail`,
        relation: 'contains',
        target_specifier: null,
        target_symbol: 'sendResetPasswordEmail',
        source: 'static',
        resolve_status: 'resolved',
        first_arg: null,
        literal_args: null,
      },
      // consumer: import { emailService } from '../services'
      makeEdge(`${REPO_ID}:${srcFile}:file`, '../services', 'emailService', {
        target_imported_symbol: 'emailService',
        target_local_symbol: 'emailService',
      }),
    ]

    const files: SourceFile[] = [makeFile(srcFile), makeFile(barrelFile), makeFile(svcFile)]

    const resolved = await resolveImportEdges(edges, nodes, files, REPO_ID, makeConfig())

    const consumerImport = resolved.find(e =>
      e.source_id === `${REPO_ID}:${srcFile}:file` && e.relation === 'imports')
    expect(consumerImport).toBeDefined()
    expect(consumerImport!.resolve_status).toBe('resolved')
    // 대상은 email.service.ts file 노드 (contains 멤버를 가진 노드) — barrel(index.ts)가 아님.
    expect(consumerImport!.target_id).toBe(`${REPO_ID}:${svcFile}:file`)
  })
})
