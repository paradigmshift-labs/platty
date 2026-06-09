import type { Adapter } from '../types.js'

export const astro: Adapter = {
  name: 'astro',
  version: '1.0.0',
  type: 'A',
  language: 'typescript',
  detection: {
    manifestFrameworkMatch: ['astro'],
    importSpecifiers: ['astro'],
  },
  minEvidence: 'manifest_only',
  priority: 40,
  entrypointRules: [
    {
      id: 'astro_page_file',
      kind: 'page',
      select: {
        node_type: 'file',
        file_glob: [
          'src/pages/**/*.astro',
          'src/pages/**/*.mdx',
          'src/pages/**/*.md',
          'src/pages/**/*.vue',
          'src/pages/**/*.svelte',
          'src/pages/**/*.tsx',
          'src/pages/**/*.jsx',
          'src/pages/**/*.ts',
          'src/pages/**/*.js',
        ],
        exclude_glob: ['src/pages/api/**/*'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'astro_api_file',
      kind: 'api',
      select: {
        node_type: 'file',
        file_glob: ['src/pages/api/**/*.ts', 'src/pages/api/**/*.js'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
  ],
}
