import type { ExternalServiceDefinition } from './types.js'

export type SearchService = 'algolia' | 'elasticsearch'

export const SEARCH_SERVICE_DEFINITIONS = {
  algolia: {
    packages: ['algoliasearch'],
    methods: [
      'saveObject',
      'saveObjects',
      'partialUpdateObject',
      'partialUpdateObjects',
      'deleteObject',
      'deleteObjects',
      'search',
      'browseObjects',
      'searchSingleIndex',
    ],
  },
  elasticsearch: {
    packages: ['@elastic/elasticsearch', 'elasticsearch'],
    methods: [
      'index',
      'bulk',
      'update',
      'delete',
      'search',
      'get',
      'create',
      'putMapping',
      'exists',
      'count',
      'msearch',
      'mget',
      'updateByQuery',
      'deleteByQuery',
      'reindex',
    ],
  },
} satisfies Record<SearchService, ExternalServiceDefinition>
