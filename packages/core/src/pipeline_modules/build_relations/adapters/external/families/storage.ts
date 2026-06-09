import type { ExternalServiceDefinition } from './types.js'

export type StorageService = 's3' | 'supabase_storage' | 'cloudinary' | 'uploadthing'

export const STORAGE_SERVICE_DEFINITIONS = {
  s3: {
    packages: ['@aws-sdk/client-s3', 'aws-sdk'],
    methods: ['putObject', 'upload', 'getObject', 'deleteObject'],
  },
  supabase_storage: {
    packages: ['@supabase/supabase-js'],
    methods: ['upload', 'remove', 'download'],
  },
  cloudinary: {
    packages: ['cloudinary'],
    methods: 'any',
  },
  uploadthing: {
    packages: ['uploadthing', 'uploadthing/server', 'uploadthing/next', '@uploadthing/react'],
    methods: [
      'uploadFiles',
      'deleteFiles',
      'listFiles',
      'renameFiles',
      'getFileUrls',
      'getSignedURL',
      'createRouteHandler',
      'createUploadthing',
    ],
  },
} satisfies Record<StorageService, ExternalServiceDefinition>
