import type { StorageService } from '../../adapters/external/families/storage.js'
import type { ServiceResolver } from './types.js'

export const STORAGE_SERVICE_RESOLVERS = {
  s3: {
    resourceFor: (candidate) => candidate.firstArg ?? null,
    operationFor: (candidate) => storageOperation(candidate.targetSymbol),
  },
  supabase_storage: {
    resourceFor: (candidate) => candidate.firstArg ?? candidate.chainPath?.match(/\.from\(['"]([^'"]+)['"]\)/)?.[1] ?? null,
    operationFor: (candidate) => storageOperation(candidate.targetSymbol),
  },
  cloudinary: {
    targetFor: () => 'cloudinary',
    resourceFor: () => null,
    operationFor: (candidate) => storageOperation(candidate.targetSymbol),
  },
  uploadthing: {
    resourceFor: (candidate) => uploadThingResource(candidate.targetSymbol),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'uploadFiles') return 'upload'
      if (method === 'deleteFiles') return 'delete'
      if (method === 'renameFiles') return 'rename'
      if (method === 'listFiles' || method === 'getFileUrls' || method === 'getSignedURL') return 'read'
      if (method === 'createRouteHandler' || method === 'createUploadthing') return 'configure_route'
      return null
    },
  },
} satisfies Record<StorageService, ServiceResolver>

function storageOperation(method: string | null | undefined): string | null {
  if (method === 'putObject' || method === 'upload' || method === 'uploadStream' || method === 'uploadFiles') return 'upload'
  if (method === 'getObject' || method === 'download') return 'download'
  if (method === 'deleteObject' || method === 'remove' || method === 'destroy') return 'delete'
  return null
}

function uploadThingResource(method: string | null | undefined): string | null {
  if (
    method === 'uploadFiles' ||
    method === 'deleteFiles' ||
    method === 'renameFiles' ||
    method === 'listFiles' ||
    method === 'getFileUrls' ||
    method === 'getSignedURL'
  ) return 'files'
  if (method === 'createRouteHandler' || method === 'createUploadthing') return 'file_routes'
  return null
}
