export const URL_LAUNCHER_PACKAGES = [
  'url_launcher',
  'flutter_url_launcher',
  'flutter_web_url_launcher',
  'package:url_launcher/url_launcher.dart',
  'package:flutter_url_launcher/flutter_url_launcher.dart',
  'package:flutter_web_url_launcher/flutter_web_url_launcher.dart',
] as const

export const FIREBASE_MESSAGING_PACKAGES = [
  'firebase_messaging',
  'package:firebase_messaging/firebase_messaging.dart',
] as const

export const S3_CLIENT_PACKAGES = [
  '@aws-sdk/client-s3',
] as const

export const URL_LAUNCHER_PACKAGE_SET = new Set<string>(URL_LAUNCHER_PACKAGES)
export const FIREBASE_MESSAGING_PACKAGE_SET = new Set<string>(FIREBASE_MESSAGING_PACKAGES)
export const S3_CLIENT_PACKAGE_SET = new Set<string>(S3_CLIENT_PACKAGES)

export function isUrlLauncherPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && URL_LAUNCHER_PACKAGE_SET.has(pkg))
}

export function isFirebaseMessagingPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && FIREBASE_MESSAGING_PACKAGE_SET.has(pkg))
}

export function isS3ClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && S3_CLIENT_PACKAGE_SET.has(pkg))
}
