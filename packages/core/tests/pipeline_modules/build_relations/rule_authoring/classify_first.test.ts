import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, CodeNodeLike, CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { findRelationGaps, runRelationRuleDiscovery, type RelationRuleAuthor, type LibraryClassifier } from '@/pipeline_modules/build_relations/rule_authoring/autonomous_loop.js'
import { classifyFromSeed, relationKindFor } from '@/pipeline_modules/build_relations/rule_authoring/library_identity.js'

// classify-first discovery: the loop must (A) only treat REAL npm packages as gaps (not relative/alias
// imports), root-normalized; later (B/C) classify each by library identity before authoring.

let edgeId = 1
function node(p: Partial<CodeNodeLike> & Pick<CodeNodeLike, 'id' | 'type' | 'filePath'>): CodeNodeLike {
  return { repoId: 'r', name: p.id, lineStart: 1, lineEnd: 99, isTest: false, parseStatus: 'ok', ...p } as CodeNodeLike
}
function edge(p: Partial<CodeEdgeLike> & Pick<CodeEdgeLike, 'sourceId' | 'relation'>): CodeEdgeLike {
  return {
    id: edgeId++, repoId: 'r', targetId: null, targetSpecifier: null, targetSymbol: null, typeRefSubtype: null,
    chainPath: null, firstArg: null, literalArgs: null, argExpressions: null, resolveStatus: 'resolved', confidence: null, source: 'static', ...p,
  } as CodeEdgeLike
}
function importsRepo(specs: string[]): BuildRelationsInputs {
  edgeId = 1
  const file = node({ id: 'r:a.ts', type: 'file', filePath: 'a.ts' })
  const edges = specs.map((s) => edge({ sourceId: file.id, relation: 'imports', targetSpecifier: s }))
  return { repoId: 'r', repoPath: null, includeTestSources: false, nodes: [file], edges, models: [] }
}

describe('A. findRelationGaps — only real npm packages, root-normalized', () => {
  it('excludes relative/alias/absolute imports', () => {
    const inputs = importsRepo(['./local', '../x/y', '@/utils/supabase', '~/lib/z', '/abs/path'])
    const gaps = findRelationGaps(inputs, buildSemanticIndex(inputs), new Set())
    expect(gaps.map((g) => g.packageSpecifier)).toEqual([])
  })

  it('keeps bare + scoped packages and root-normalizes subpaths', () => {
    const inputs = importsRepo(['redaxios', 'next/head', 'next/router', '@chakra-ui/react', '@scope/pkg/sub'])
    const gaps = findRelationGaps(inputs, buildSemanticIndex(inputs), new Set())
    // next/head + next/router collapse to one 'next' gap; scoped subpath → '@scope/pkg'
    expect(gaps.map((g) => g.packageSpecifier).sort()).toEqual(['@chakra-ui/react', '@scope/pkg', 'next', 'redaxios'])
  })

  it('still honors knownPackages (covered → not a gap), comparing on the root', () => {
    const inputs = importsRepo(['redaxios', 'axios', '@nestjs/axios/dist/x'])
    const gaps = findRelationGaps(inputs, buildSemanticIndex(inputs), new Set(['axios', '@nestjs/axios']))
    expect(gaps.map((g) => g.packageSpecifier)).toEqual(['redaxios'])
  })

  it('mixed real-repo shape (311app): relative/alias + ui frameworks survive only as real packages', () => {
    const inputs = importsRepo([
      'redaxios', 'react', 'next/head', 'next/router', 'next/link', '@chakra-ui/react',
      'react-hook-form', '@/components/global/Navbar', '@/utils/supabase', '@/utils/react-query/user',
    ])
    const gaps = findRelationGaps(inputs, buildSemanticIndex(inputs), new Set()).map((g) => g.packageSpecifier).sort()
    expect(gaps).toEqual(['@chakra-ui/react', 'next', 'react', 'react-hook-form', 'redaxios'])
  })
})

describe('B. library identity — seed denylist + relation-kind mapping', () => {
  it('relationKindFor: only client/db/vendor map to a loop; everything else is skipped', () => {
    expect(relationKindFor('http_client')).toBe('api_call')
    expect(relationKindFor('db_client')).toBe('db_access')
    expect(relationKindFor('vendor_service')).toBe('external_service')
    for (const k of ['ui_framework', 'state_mgmt', 'build_tool', 'utility', 'unknown'] as const) {
      expect(relationKindFor(k)).toBeNull()
    }
  })

  it('classifyFromSeed: known non-services classify deterministically; an unknown package returns null (→ LLM)', () => {
    expect(classifyFromSeed('react')?.kind).toBe('ui_framework')
    expect(classifyFromSeed('next')?.kind).toBe('ui_framework')
    expect(classifyFromSeed('@chakra-ui/react')?.kind).toBe('ui_framework')
    expect(classifyFromSeed('react-hook-form')?.kind).toBe('utility')
    expect(classifyFromSeed('redux')?.kind).toBe('state_mgmt')
    // the loop's job is to discover THESE — not seeded, so the LLM classifier decides:
    expect(classifyFromSeed('redaxios')).toBeNull()
    expect(classifyFromSeed('some-unknown-vendor-sdk')).toBeNull()
  })

  it('the 311app false-positive packages all classify as skip (no relation loop)', () => {
    for (const pkg of ['react', 'next', '@chakra-ui/react', 'react-hook-form']) {
      const id = classifyFromSeed(pkg)!
      expect(relationKindFor(id.kind), `${pkg} must be skipped`).toBeNull()
    }
  })
})

describe('C. classify gate — skip non-services, route real clients to the right loop', () => {
  it('react (seed→ui) skipped; redaxios (classified http_client) authored for api_call; @/ filtered out', async () => {
    const inputs = importsRepo(['react', 'redaxios', '@/utils/x'])
    const authored: { pkg: string; kind: string }[] = []
    const author: RelationRuleAuthor = async (gap, _ctx, kindHint) => { authored.push({ pkg: gap.packageSpecifier, kind: kindHint }); return null }
    const classifier: LibraryClassifier = async (pkg) => (pkg === 'redaxios' ? { kind: 'http_client', reason: 'stub' } : { kind: 'unknown', reason: 'stub' })
    const result = await runRelationRuleDiscovery({
      inputs, index: buildSemanticIndex(inputs), foreignInputs: [], knownPackages: [], knownRuleIds: [],
      classifyPackage: classifier, authorCandidate: author,
    })
    expect(authored).toEqual([{ pkg: 'redaxios', kind: 'api_call' }]) // only redaxios authored, AS api_call
    expect(result.skipped.map((s) => s.package)).toEqual(['react']) // react skipped (ui_framework); @/utils/x never a gap
    expect(result.gaps.map((g) => g.packageSpecifier).sort()).toEqual(['react', 'redaxios'])
  })

  it('NO classifier → unknown packages are skipped (no LLM, no spurious authoring)', async () => {
    const inputs = importsRepo(['some-unknown-pkg'])
    const authored: string[] = []
    const author: RelationRuleAuthor = async (gap) => { authored.push(gap.packageSpecifier); return null }
    const result = await runRelationRuleDiscovery({
      inputs, index: buildSemanticIndex(inputs), foreignInputs: [], knownPackages: [], knownRuleIds: [],
      authorCandidate: author, // no classifyPackage
    })
    expect(authored).toEqual([])
    expect(result.skipped).toEqual([{ package: 'some-unknown-pkg', kind: 'unknown' }])
  })
})

// NOTE: the in-code LLM library classifier (buildLibraryClassifyPrompt / parseLibraryIdentity /
// createLlmLibraryClassifier) was REMOVED — the codebase is LLM-free. Library classification at discovery time
// now happens OUTSIDE the code (the agent / the dsl-build skill). The deterministic seed classifier
// (classifyFromSeed, covered in describe B above) and the injected-classifier loop (describe C) remain.
