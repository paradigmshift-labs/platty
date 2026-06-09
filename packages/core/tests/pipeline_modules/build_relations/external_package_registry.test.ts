import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FIREBASE_MESSAGING_PACKAGE_SET,
  S3_CLIENT_PACKAGE_SET,
  URL_LAUNCHER_PACKAGE_SET,
  isFirebaseMessagingPackage,
  isS3ClientPackage,
  isUrlLauncherPackage,
} from '@/pipeline_modules/build_relations/adapters/external/packages.js'

const SOURCE_PATHS = {
  adapterLinks: 'src/pipeline_modules/build_relations/adapters/external/links.ts',
  legacyExternalLink: 'src/pipeline_modules/build_relations/candidates/external_link.ts',
  platformExtraction: 'src/pipeline_modules/build_relations/adapters/external/families/platform_extraction.ts',
  storageExtraction: 'src/pipeline_modules/build_relations/adapters/external/families/storage_extraction.ts',
} as const

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('external package registry', () => {
  it('owns external package anchors from one registry', () => {
    expect(isUrlLauncherPackage('url_launcher')).toBe(true)
    expect(isUrlLauncherPackage('package:url_launcher/url_launcher.dart')).toBe(true)
    expect(isFirebaseMessagingPackage('firebase_messaging')).toBe(true)
    expect(isFirebaseMessagingPackage('package:firebase_messaging/firebase_messaging.dart')).toBe(true)
    expect(isS3ClientPackage('@aws-sdk/client-s3')).toBe(true)
    expect(isUrlLauncherPackage('not-url-launcher')).toBe(false)
    expect(URL_LAUNCHER_PACKAGE_SET.has('flutter_web_url_launcher')).toBe(true)
    expect(FIREBASE_MESSAGING_PACKAGE_SET.has('firebase_messaging')).toBe(true)
    expect(S3_CLIENT_PACKAGE_SET.has('@aws-sdk/client-s3')).toBe(true)
  })

  it('keeps external extraction code delegated to package helpers', () => {
    const adapterLinks = readSource(SOURCE_PATHS.adapterLinks)
    const legacyExternalLink = readSource(SOURCE_PATHS.legacyExternalLink)
    const platformExtraction = readSource(SOURCE_PATHS.platformExtraction)
    const storageExtraction = readSource(SOURCE_PATHS.storageExtraction)

    expect(adapterLinks).toContain('isUrlLauncherPackage')
    expect(legacyExternalLink).toContain('isUrlLauncherPackage')
    expect(platformExtraction).toContain('isFirebaseMessagingPackage')
    expect(storageExtraction).toContain('isS3ClientPackage')

    expect(adapterLinks).not.toContain('const LAUNCH_PKGS')
    expect(legacyExternalLink).not.toContain('const LAUNCH_PKGS')
    expect(platformExtraction).not.toMatch(/targetSpecifier === ['"]firebase_messaging['"]/)
    expect(platformExtraction).not.toMatch(/targetSpecifier === ['"]package:firebase_messaging\/firebase_messaging\.dart['"]/)
    expect(storageExtraction).not.toMatch(/targetSpecifier === ['"]@aws-sdk\/client-s3['"]/)
  })
})
