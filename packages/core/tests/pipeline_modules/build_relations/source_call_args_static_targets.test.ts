import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  resolveFirstArgFromGraphArgExpressions,
  resolveFirstArgsFromSource,
} from '@/pipeline_modules/build_relations/source_call_args.js'
import type {
  BuildRelationsInputs,
  CodeEdgeLike,
  CodeNodeLike,
} from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_static_args'

function makeNode(opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id: `${REPO_ID}:src/page.tsx:Page`,
    repoId: REPO_ID,
    type: 'function',
    name: 'Page',
    filePath: 'src/page.tsx',
    lineStart: 1,
    lineEnd: 20,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

function makeEdge(opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: 1,
    repoId: REPO_ID,
    sourceId: `${REPO_ID}:src/page.tsx:Page`,
    targetId: null,
    relation: 'calls',
    targetSpecifier: null,
    targetSymbol: 'push',
    typeRefSubtype: null,
    chainPath: 'router',
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'pending',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function makeInputs(repoPath: string | null, node: CodeNodeLike, edge: CodeEdgeLike): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath,
    includeTestSources: false,
    nodes: [node],
    edges: [edge],
    models: [],
  }
}

describe('source_call_args static target extraction', () => {
  it('keeps member expression first arguments as resolver-friendly static candidates', () => {
    const edge = makeEdge({
      argExpressions: [
        { index: 0, kind: 'member', raw: 'ROUTES.dashboard', resolution: 'dynamic' },
      ],
    })

    expect(resolveFirstArgFromGraphArgExpressions(edge)).toBe('ROUTES.dashboard')
  })

  it('resolves template literal constant prefixes while preserving dynamic tail placeholders', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-static-args-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/page.tsx'), `
      import { ROUTES } from './routes'
      export function Page() {
        const productId = 'sku-1'
        router.replace(\`\${ROUTES.products}/\${productId}\`)
      }
    `)
    writeFileSync(join(repoPath, 'src/routes.ts'), `
      export const ROUTES = {
        products: '/products',
      } as const
    `)

    const node = makeNode()
    const edge = makeEdge({
      targetSymbol: 'replace',
      argExpressions: [
        {
          index: 0,
          kind: 'template',
          raw: '`${ROUTES.products}/${productId}`',
          staticPattern: ':products/:productId',
          identifiers: ['ROUTES', 'products', 'productId'],
          resolution: 'partial',
        },
      ],
    })

    expect(resolveFirstArgsFromSource(makeInputs(repoPath, node, edge), node, edge))
      .toEqual(['/products/sku-1'])
  })

  it('falls back to source scan for member call arguments when graph argExpressions are absent', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-static-args-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/page.tsx'), `
      export function Page() {
        router.push(ROUTES.orders)
      }
    `)

    const node = makeNode()
    const edge = makeEdge({ targetSymbol: 'push', chainPath: 'router' })

    expect(resolveFirstArgsFromSource(makeInputs(repoPath, node, edge), node, edge))
      .toEqual(['ROUTES.orders'])
  })
})
