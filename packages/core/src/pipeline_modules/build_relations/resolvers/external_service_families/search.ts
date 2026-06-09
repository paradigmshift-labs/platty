import type { SearchService } from '../../adapters/external/families/search.js'
import type { ServiceResolver } from './types.js'

export const SEARCH_SERVICE_RESOLVERS = {
  algolia: {
    resourceFor: (candidate) => candidate.firstArg ?? null,
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'saveObject' || method === 'saveObjects') return 'index'
      if (method === 'partialUpdateObject' || method === 'partialUpdateObjects') return 'update'
      if (method === 'deleteObject' || method === 'deleteObjects') return 'delete'
      if (method === 'search' || method === 'browseObjects' || method === 'searchSingleIndex') return 'search'
      return null
    },
  },
  elasticsearch: {
    resourceFor: (candidate) => candidate.firstArg ?? null,
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'create' && candidate.chainPath?.includes('indices')) return 'create_index'
      if (method === 'putMapping') return 'update_mapping'
      if (method === 'exists') return 'read'
      if (method === 'index' || method === 'bulk') return 'index'
      if (method === 'update' || method === 'updateByQuery') return 'update'
      if (method === 'delete' || method === 'deleteByQuery') return 'delete'
      if (method === 'search' || method === 'get' || method === 'count' || method === 'msearch' || method === 'mget') return 'search'
      if (method === 'reindex') return 'reindex'
      return null
    },
  },
} satisfies Record<SearchService, ServiceResolver>
