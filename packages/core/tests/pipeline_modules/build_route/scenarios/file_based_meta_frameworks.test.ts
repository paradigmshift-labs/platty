import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { nuxt } from '@/pipeline_modules/build_route/adapters/nuxt.js'
import { sveltekit } from '@/pipeline_modules/build_route/adapters/sveltekit.js'
import { astro } from '@/pipeline_modules/build_route/adapters/astro.js'
import { TEST_REPO as REPO, loaded, n, resetEdgeId } from '../helpers/graph_builders.js'

function file(path: string) {
  return n({ id: `r1:${path}`, type: 'file', filePath: path, name: path })
}

describe('file-based JS/TS meta-framework route adapters', () => {
  it('Nuxt: pages + server/api method suffix paths', async () => {
    resetEdgeId()
    const graph = createGraphIndex({
      nodes: [
        file('pages/index.vue'),
        file('pages/users/[id].vue'),
        file('server/api/orders/[id].get.ts'),
      ],
      edges: [],
    })
    const r = await runRuleEngine({ adapters: [loaded(nuxt)], graph, repoId: REPO })
    expect(r.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ framework: 'nuxt', kind: 'page', fullPath: '/' }),
      expect.objectContaining({ framework: 'nuxt', kind: 'page', fullPath: '/users/:id' }),
      expect.objectContaining({ framework: 'nuxt', kind: 'api', fullPath: '/api/orders/:id' }),
    ]))
  })

  it('SvelteKit: +page.svelte and +server.ts paths', async () => {
    resetEdgeId()
    const graph = createGraphIndex({
      nodes: [
        file('src/routes/+page.svelte'),
        file('src/routes/users/[id]/+page.svelte'),
        file('src/routes/api/orders/[id]/+server.ts'),
      ],
      edges: [],
    })
    const r = await runRuleEngine({ adapters: [loaded(sveltekit)], graph, repoId: REPO })
    expect(r.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ framework: 'sveltekit', kind: 'page', fullPath: '/' }),
      expect.objectContaining({ framework: 'sveltekit', kind: 'page', fullPath: '/users/:id' }),
      expect.objectContaining({ framework: 'sveltekit', kind: 'api', fullPath: '/api/orders/:id' }),
    ]))
  })

  it('Astro: src/pages routes and src/pages/api routes', async () => {
    resetEdgeId()
    const graph = createGraphIndex({
      nodes: [
        file('src/pages/index.astro'),
        file('src/pages/blog/[...slug].astro'),
        file('src/pages/api/orders/[id].ts'),
      ],
      edges: [],
    })
    const r = await runRuleEngine({ adapters: [loaded(astro)], graph, repoId: REPO })
    expect(r.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ framework: 'astro', kind: 'page', fullPath: '/' }),
      expect.objectContaining({ framework: 'astro', kind: 'page', fullPath: '/blog/:slug*' }),
      expect.objectContaining({ framework: 'astro', kind: 'api', fullPath: '/api/orders/:id' }),
    ]))
  })
})
