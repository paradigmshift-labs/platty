import type { PlatformService } from '../../adapters/external/families/platform.js'
import type { ServiceResolver } from './types.js'

export const PLATFORM_SERVICE_RESOLVERS = {
  firebase: {
    resourceFor: (candidate) => firebaseProduct(candidate.targetSymbol),
    payloadFor: (candidate) => {
      const product = firebaseProduct(candidate.targetSymbol)
      return product ? { firebase_product: product } : {}
    },
    operationFor: (candidate) => firebaseProduct(candidate.targetSymbol) === 'messaging' ? candidate.targetSymbol ?? null : null,
  },
  openai: {
    resourceFor: (candidate) => openaiResource(candidate.chainPath),
    operationFor: (candidate) => {
      const resource = openaiResource(candidate.chainPath)
      if (resource === 'moderations') return 'moderate'
      if (resource === 'embeddings') return 'embed'
      if (resource === 'images') return 'generate_image'
      return resource ? 'generate' : null
    },
  },
  sentry: {
    resourceFor: (candidate) => sentryResource(candidate.targetSymbol),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'captureException') return 'capture_exception'
      if (method === 'captureMessage') return 'capture_message'
      if (method === 'captureEvent') return 'capture_event'
      return null
    },
  },
  mux: {
    resourceFor: (candidate) => muxResource(candidate.chainPath),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      const resource = muxResource(candidate.chainPath)
      if (resource === 'direct_uploads' && method === 'create') return 'create_upload'
      if (resource === 'assets' && method === 'create') return 'create_asset'
      if (method === 'retrieve' || method === 'list') return 'read'
      if (method === 'update') return 'update'
      if (method === 'delete') return 'delete'
      if (method === 'cancel') return 'cancel'
      if (method === 'createPlaybackId') return 'create_playback_id'
      if (method === 'deletePlaybackId') return 'delete_playback_id'
      if (method === 'create') return 'create'
      return null
    },
  },
  sanity: {
    resourceFor: (candidate) => sanityResource(candidate.targetSymbol),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'fetch') return 'query'
      if (method === 'create' || method === 'createIfNotExists' || method === 'createOrReplace') return 'write'
      if (method === 'patch' || method === 'mutate') return 'mutate'
      if (method === 'delete') return 'delete'
      return null
    },
  },
  launchdarkly: {
    resourceFor: (candidate) => launchDarklyResource(candidate.targetSymbol),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'variation' || method === 'variationDetail') return 'evaluate_flag'
      if (method === 'allFlagsState') return 'read_flags'
      if (method === 'identify') return 'identify_context'
      if (method === 'track') return 'track_event'
      if (method === 'flush') return 'flush'
      return null
    },
  },
  hubspot: {
    resourceFor: (candidate) => hubSpotResource(candidate.chainPath),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      const resource = hubSpotResource(candidate.chainPath)
      if (method === 'create' && resource === 'contacts') return 'create_contact'
      if (method === 'create' && resource === 'companies') return 'create_company'
      if (method === 'create' && resource === 'deals') return 'create_deal'
      if (method === 'create' && resource === 'tickets') return 'create_ticket'
      if (method === 'create') return 'create'
      if (method === 'update') return 'update'
      if (method === 'getById' || method === 'getPage') return 'read'
      if (method === 'archive') return 'archive'
      if (method === 'merge') return 'merge'
      if (method === 'doSearch') return 'search'
      return null
    },
  },
} satisfies Record<PlatformService, ServiceResolver>

function firebaseProduct(method: string | null | undefined): string | null {
  if (method === 'getFirestore' || method === 'firestore') return 'firestore'
  if (method === 'getAuth' || method === 'auth') return 'auth'
  if (method === 'getStorage' || method === 'storage') return 'storage'
  if (
    method === 'getToken' ||
    method === 'deleteToken' ||
    method === 'requestPermission' ||
    method === 'onMessage' ||
    method === 'onMessageOpenedApp' ||
    method === 'onBackgroundMessage'
  ) return 'messaging'
  return null
}

function openaiResource(chainPath: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (normalized.includes('chat.completions')) return 'chat_completions'
  if (normalized.includes('responses')) return 'responses'
  if (normalized.includes('moderations')) return 'moderations'
  if (normalized.includes('embeddings')) return 'embeddings'
  if (normalized.includes('images')) return 'images'
  return null
}

function sentryResource(method: string | null | undefined): string | null {
  if (method === 'captureException') return 'errors'
  if (method === 'captureMessage') return 'messages'
  if (method === 'captureEvent') return 'events'
  return null
}

function muxResource(chainPath: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (normalized.includes('video.uploads') || normalized.includes('directUploads') || normalized.includes('direct_uploads')) return 'direct_uploads'
  if (normalized.includes('video.assets') || normalized.includes('assets')) return 'assets'
  if (normalized.includes('video.liveStreams') || normalized.includes('liveStreams')) return 'live_streams'
  if (normalized.includes('video.playbackIds') || normalized.includes('playbackIds')) return 'playback_ids'
  if (normalized.includes('data')) return 'data'
  return null
}

function sanityResource(method: string | null | undefined): string | null {
  if (
    method === 'fetch' ||
    method === 'create' ||
    method === 'createIfNotExists' ||
    method === 'createOrReplace' ||
    method === 'patch' ||
    method === 'delete' ||
    method === 'mutate'
  ) return 'content'
  return null
}

function launchDarklyResource(method: string | null | undefined): string | null {
  if (method === 'variation' || method === 'variationDetail' || method === 'allFlagsState') return 'flags'
  if (method === 'identify') return 'contexts'
  if (method === 'track') return 'events'
  if (method === 'flush') return 'delivery'
  return null
}

function hubSpotResource(chainPath: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (normalized.includes('contacts')) return 'contacts'
  if (normalized.includes('companies')) return 'companies'
  if (normalized.includes('deals')) return 'deals'
  if (normalized.includes('tickets')) return 'tickets'
  if (normalized.includes('owners')) return 'owners'
  if (normalized.includes('associations')) return 'associations'
  if (normalized.includes('objects')) return 'objects'
  return null
}
