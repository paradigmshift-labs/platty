import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { graphFromBuildGraph } from '@/pipeline_modules/build_route/rule_authoring/load_build_graph.js'
import { evaluateRouteRuleForPromotion } from '@/pipeline_modules/build_route/rule_authoring/promote_gate.js'
import { PROMOTED_ROUTE_RULES, generateRuleTestSpec } from '@/pipeline_modules/build_route/rule_authoring/promoted_rules.js'

// Keystone: every entry in the promoted-rules rulebook must STILL pass the deterministic referee on real
// corpus build_graph — it reproduces its anchor, self-gates on its evidence, and stays clean on the other
// frameworks' repos. Appending a rule to PROMOTED_ROUTE_RULES auto-extends this guard (tested-by-construction).

const FIX = 'tests/fixtures/build_route/rule_authoring'
const GRAPH_NAMES = ['express', 'fastify', 'nestjs', 'react', 'flutter'] as const
const loadGraph = (name: string) =>
  graphFromBuildGraph(JSON.parse(readFileSync(`${FIX}/${name}.build_graph.json`, 'utf-8')))

// each promoted rule's framework label maps to a committed graph fixture of that framework
const anchorGraphName = (framework: string) => (GRAPH_NAMES as readonly string[]).includes(framework) ? framework : framework

describe('promoted route rules — keystone (every rulebook entry stays promotable)', () => {
  it('rulebook is non-empty and every rule id is unique', () => {
    expect(PROMOTED_ROUTE_RULES.length).toBeGreaterThan(0)
    const ids = PROMOTED_ROUTE_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const candidate of PROMOTED_ROUTE_RULES) {
    it(`${candidate.id} → PROMOTE on real ${candidate.framework} build_graph, clean on the others`, async () => {
      const anchor = anchorGraphName(candidate.framework)
      const foreign = GRAPH_NAMES.filter((g) => g !== anchor).map((g) => ({ fixture: g, graph: loadGraph(g) }))
      const v = await evaluateRouteRuleForPromotion({
        candidate,
        anchorGraph: loadGraph(anchor),
        foreignGraphs: foreign,
      })
      expect({ promote: v.promote, reason: v.reason }).toMatchObject({ promote: true })
    })

    it(`${candidate.id} → carries a RuleTestSpec (fire + evidence-withheld obligation)`, () => {
      expect(generateRuleTestSpec(candidate)).toEqual({
        ruleId: candidate.id,
        anchorFixture: candidate.anchorFixture,
        fires: candidate.anchorEdgeIds,
        evidenceWithheld: candidate.requiresImport,
      })
    })
  }
})
