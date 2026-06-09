// RED SPEC (describe.skip) — absorbed from pre-refactor build_graph resolution WIP.
// Un-skip + make GREEN when re-implementing resolution on the refactored engine.
// Reference impl: ~/main-wip-backup/source.patch ; design: specs/static_analysis_strategy/ideal_architecture_reverse_design.md
/**
 * Regression: CommonJS `require()` destructuring should emit `imports` edges and
 * bind the destructured symbol so cross-module calls resolve to the exported
 * function (not the local import-binding variable node).
 *
 * Real-world pattern (sequelize-express-example): route files do
 *   const { getIdParam } = require('../helpers');
 *   ... getIdParam(req) ...
 * The ES counterpart `import { getIdParam } from '../helpers'` already emits an
 * `imports` edge + sets the call's target_specifier. CommonJS must behave the
 * same way (generalizable rule, no fixture/repo name branching).
 */
import { describe, expect, it } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'express/routes/instruments.js', repoId = 'r1') {
  return adapter.parseFile(content, filePath, repoId)
}

describe('TypeScriptParserAdapter CommonJS require destructuring imports', () => {
  it('emits an imports edge for `const { x } = require("./mod")`', () => {
    const result = parse(`
const { getIdParam } = require('../helpers');

async function getById(req, res) {
  const id = getIdParam(req);
  return id;
}

module.exports = { getById };
`)

    const importEdge = result.edges.find(
      (e) => e.relation === 'imports' && e.target_symbol === 'getIdParam',
    )
    expect(importEdge).toBeDefined()
    expect(importEdge?.target_specifier).toBe('../helpers')
    expect(importEdge?.source_id).toBe('r1:express/routes/instruments.js')
    // No pinned target yet — F3a resolves it cross-module later.
    expect(importEdge?.target_id).toBeNull()
  })

  it('sets target_specifier on a call to a require-destructured symbol', () => {
    const result = parse(`
const { getIdParam } = require('../helpers');

async function getById(req, res) {
  const id = getIdParam(req);
  return id;
}
`)

    const callEdge = result.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'getIdParam',
    )
    expect(callEdge).toBeDefined()
    // The bug: target_specifier was null, so resolveSameFileBareSymbolCall pinned
    // the call to the local import-binding `variable` node instead of routing it
    // through resolveImportedCall to the exported helpers.js function.
    expect(callEdge?.target_specifier).toBe('../helpers')
  })

  it('handles aliased destructuring `const { a: b } = require("./mod")`', () => {
    const result = parse(`
const { getIdParam: getId } = require('../helpers');

async function getById(req, res) {
  return getId(req);
}
`)

    const importEdge = result.edges.find(
      (e) => e.relation === 'imports' && e.target_local_symbol === 'getId',
    )
    expect(importEdge).toBeDefined()
    expect(importEdge?.target_specifier).toBe('../helpers')
    expect(importEdge?.target_symbol).toBe('getIdParam')

    const callEdge = result.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'getId',
    )
    expect(callEdge?.target_specifier).toBe('../helpers')
  })

  it('does not emit an imports edge for non-require destructuring', () => {
    const result = parse(`
const { a, b } = someLocalObject;

function use() {
  return a + b;
}
`)

    const importEdges = result.edges.filter((e) => e.relation === 'imports')
    expect(importEdges).toHaveLength(0)
  })
})
