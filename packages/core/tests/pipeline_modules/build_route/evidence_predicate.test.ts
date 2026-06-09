import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { evaluateEvidence } from '@/pipeline_modules/build_route/evidence_predicate.js'
import { n, e, resetEdgeId } from './helpers/graph_builders.js'

// The unified evidence primitive — the self-gate both DSL rules and exception handlers use.
// Key invariants: fires only when the specific graph evidence is present (no framework guess),
// and matchedFiles is per-source-file (so DSL rules can keep only edges from carrying files).
describe('evidence_predicate — evaluateEvidence', () => {
  function graph(builders: () => { nodes: ReturnType<typeof n>[]; edges: ReturnType<typeof e>[] }) {
    resetEdgeId()
    const { nodes, edges } = builders()
    return createGraphIndex({ nodes, edges })
  }

  describe('importSpecifier (generalizes requires_import)', () => {
    it('fires for the file that imports the package; matchedFiles is that file only', () => {
      const g = graph(() => {
        const a = n({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts', name: 'a.ts' })
        const b = n({ id: 'r1:b.ts', type: 'file', filePath: 'b.ts', name: 'b.ts' })
        return {
          nodes: [a, b],
          edges: [e({ sourceId: a.id, relation: 'imports', targetSymbol: 'Router', targetSpecifier: 'express' })],
        }
      })
      const r = evaluateEvidence({ all: [{ importSpecifier: ['express'] }] }, g)
      expect(r.fired).toBe(true)
      expect([...r.matchedFiles]).toEqual(['a.ts'])
    })

    it('does NOT fire when no file imports the package', () => {
      const g = graph(() => {
        const a = n({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts', name: 'a.ts' })
        return { nodes: [a], edges: [e({ sourceId: a.id, relation: 'imports', targetSymbol: 'x', targetSpecifier: 'koa' })] }
      })
      const r = evaluateEvidence({ all: [{ importSpecifier: ['express'] }] }, g)
      expect(r.fired).toBe(false)
      expect(r.matchedFiles.size).toBe(0)
    })
  })

  describe('decoratesSymbol (NestJS self-gate)', () => {
    it('fires when a decorates edge to the symbol exists', () => {
      const g = graph(() => {
        const c = n({ id: 'r1:c.ts:Cats', type: 'class', filePath: 'c.ts', name: 'Cats' })
        return { nodes: [c], edges: [e({ sourceId: c.id, relation: 'decorates', targetSymbol: 'Controller' })] }
      })
      expect(evaluateEvidence({ any: [{ decoratesSymbol: ['Controller', 'Resolver'] }] }, g).fired).toBe(true)
      expect(evaluateEvidence({ any: [{ decoratesSymbol: ['Module'] }] }, g).fired).toBe(false)
    })
  })

  describe('calls (express app.get self-gate)', () => {
    it('fires for a matching call with a non-null first arg', () => {
      const g = graph(() => {
        const f = n({ id: 'r1:s.ts:setup', type: 'function', filePath: 's.ts', name: 'setup' })
        return { nodes: [f], edges: [e({ sourceId: f.id, relation: 'calls', targetSymbol: 'get', chainPath: 'app', firstArg: '/x' })] }
      })
      expect(evaluateEvidence({ all: [{ callsMethod: ['get'], firstArgNonNull: true }] }, g).fired).toBe(true)
      expect(evaluateEvidence({ all: [{ callsMethod: ['post'] }] }, g).fired).toBe(false)
    })
  })

  describe('relation (react-router <Route> renders)', () => {
    it('fires when a renders edge to Route exists', () => {
      const g = graph(() => {
        const f = n({ id: 'r1:App.tsx:App', type: 'function', filePath: 'App.tsx', name: 'App' })
        return { nodes: [f], edges: [e({ sourceId: f.id, relation: 'renders', targetSymbol: 'Route', firstArg: '/login' })] }
      })
      expect(evaluateEvidence({ all: [{ relation: 'renders', targetSymbol: ['Route'] }] }, g).fired).toBe(true)
    })
  })

  describe('all vs any (per-file semantics)', () => {
    it('all: a file must satisfy every condition', () => {
      const g = graph(() => {
        const a = n({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts', name: 'a.ts' })
        const af = n({ id: 'r1:a.ts:setup', type: 'function', filePath: 'a.ts', name: 'setup' })
        const b = n({ id: 'r1:b.ts', type: 'file', filePath: 'b.ts', name: 'b.ts' })
        return {
          nodes: [a, af, b],
          edges: [
            e({ sourceId: a.id, relation: 'imports', targetSymbol: 'x', targetSpecifier: 'express' }),
            e({ sourceId: af.id, relation: 'calls', targetSymbol: 'use', chainPath: 'app', firstArg: '/api' }),
            // b imports express but has no app.use → must NOT match the all-trigger
            e({ sourceId: b.id, relation: 'imports', targetSymbol: 'y', targetSpecifier: 'express' }),
          ],
        }
      })
      const r = evaluateEvidence({ all: [{ importSpecifier: ['express'] }, { callsMethod: ['use'] }] }, g)
      expect([...r.matchedFiles].sort()).toEqual(['a.ts'])
    })

    it('empty trigger never fires', () => {
      const g = graph(() => ({ nodes: [n({ id: 'r1:a.ts', type: 'file', filePath: 'a.ts', name: 'a.ts' })], edges: [] }))
      expect(evaluateEvidence({}, g).fired).toBe(false)
    })
  })
})
