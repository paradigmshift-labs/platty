import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const schemaPath = join(root, 'apps/backend/prisma/schema.prisma')

function readSchema() {
  return readFileSync(schemaPath, 'utf8')
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'))
}

function assertIncludesAll(schema, snippets) {
  for (const snippet of snippets) {
    assert.match(schema, snippet)
  }
}

function schemaBlock(schema, kind, name) {
  const match = new RegExp(`^${kind}\\s+${name}\\s*{`, 'm').exec(schema)
  assert.notEqual(match, null, `${kind} ${name} is declared`)

  const end = schema.indexOf('\n}', match.index)
  assert.notEqual(end, -1, `${kind} ${name} is closed`)

  return schema.slice(match.index, end + 2)
}

describe('backend Prisma schema contract', () => {
  it('declares the backend Prisma schema location and datasource', () => {
    assert.equal(existsSync(schemaPath), true)
    const schema = readSchema()

    assert.match(schema, /generator\s+client\s*{[\s\S]*provider\s*=\s*"prisma-client-js"[\s\S]*}/)
    assert.match(schema, /datasource\s+db\s*{[\s\S]*provider\s*=\s*"postgresql"[\s\S]*url\s*=\s*env\("DATABASE_URL"\)[\s\S]*}/)
  })

  it('ships a deployable initial migration', () => {
    const manifest = readJson('apps/backend/package.json')
    assert.equal(manifest.scripts['prisma:deploy'], 'prisma migrate deploy')

    const migrationsPath = join(root, 'apps/backend/prisma/migrations')
    assert.equal(existsSync(migrationsPath), true)
    const migrationDirs = readdirSync(migrationsPath).filter((entry) => entry.includes('initial_backend_foundation'))
    assert.equal(migrationDirs.length, 1)

    const migrationSql = readFileSync(join(migrationsPath, migrationDirs[0], 'migration.sql'), 'utf8')
    assert.match(migrationSql, /CREATE TYPE "UserStatus"/)
    assert.match(migrationSql, /CREATE TABLE "User"/)
    assert.match(migrationSql, /CREATE TABLE "AnalyticsEvent"/)
    assert.match(migrationSql, /CREATE UNIQUE INDEX "AnalyticsEvent_eventId_key"/)
  })

  it('contains only the anonymous-first backend models for this phase', () => {
    const schema = readSchema()

    assertIncludesAll(schema, [
      /model\s+User\s*{/,
      /model\s+ClientIdentity\s*{/,
      /model\s+AnonymousSession\s*{/,
      /model\s+UserIdentityAlias\s*{/,
      /model\s+UserSetting\s*{/,
      /model\s+ConsentRecord\s*{/,
      /model\s+AnalyticsEvent\s*{/,
    ])

    for (const futureScopeModel of ['Workspace', 'License', 'Billing', 'Project', 'Repository']) {
      assert.doesNotMatch(schema, new RegExp(`model\\s+${futureScopeModel}\\s*{`))
    }
  })

  it('declares the backend auth and analytics enums', () => {
    const schema = readSchema()

    const userStatus = schemaBlock(schema, 'enum', 'UserStatus')
    assertIncludesAll(userStatus, [/ANONYMOUS/, /REGISTERED/, /MERGED/, /DELETED/])

    const clientKind = schemaBlock(schema, 'enum', 'ClientKind')
    assertIncludesAll(clientKind, [/CLI/, /DASHBOARD/, /DESKTOP/, /FLUTTER/, /API/, /UNKNOWN/])

    const identityAliasKind = schemaBlock(schema, 'enum', 'IdentityAliasKind')
    assertIncludesAll(identityAliasKind, [
      /ANONYMOUS_USER_ID/,
      /CLIENT_INSTALLATION_ID/,
      /ANALYTICS_SESSION_ID/,
      /AUTH_PROVIDER_SUBJECT/,
      /EMAIL_HASH/,
    ])

    const consentType = schemaBlock(schema, 'enum', 'ConsentType')
    assertIncludesAll(consentType, [/ANALYTICS/, /PRODUCT_UPDATES/, /ERROR_REPORTING/])
  })

  it('keeps identity, session, settings, and event continuity queryable', () => {
    const schema = readSchema()

    const clientIdentity = schemaBlock(schema, 'model', 'ClientIdentity')
    assertIncludesAll(clientIdentity, [
      /installationId\s+String\s+@unique/,
      /anonymousSessions\s+AnonymousSession\[\]/,
      /consentRecords\s+ConsentRecord\[\]/,
      /analyticsEvents\s+AnalyticsEvent\[\]/,
      /updatedSettings\s+UserSetting\[\]\s+@relation\("UserSettingUpdatedByClientIdentity"\)/,
      /@@index\(\[userId\]\)/,
      /@@index\(\[clientKind\]\)/,
    ])

    const anonymousSession = schemaBlock(schema, 'model', 'AnonymousSession')
    assertIncludesAll(anonymousSession, [
      /sessionTokenHash\s+String\s+@unique/,
      /analyticsSessionId\s+String\?\s+@unique/,
      /clientIdentity\s+ClientIdentity\?\s+@relation\(fields:\s*\[clientIdentityId\],\s*references:\s*\[id\]\)/,
      /@@index\(\[userId\]\)/,
      /@@index\(\[clientIdentityId\]\)/,
      /@@index\(\[expiresAt\]\)/,
    ])

    const userIdentityAlias = schemaBlock(schema, 'model', 'UserIdentityAlias')
    assertIncludesAll(userIdentityAlias, [
      /@@unique\(\[aliasKind,\s*aliasValue\]\)/,
      /@@index\(\[userId\]\)/,
      /@@index\(\[linkedFromUserId\]\)/,
      /metadata\s+Json\?/,
    ])

    const userSetting = schemaBlock(schema, 'model', 'UserSetting')
    assertIncludesAll(userSetting, [
      /value\s+Json/,
      /updatedByClientIdentityId\s+String\?/,
      /updatedByClientIdentity\s+ClientIdentity\?\s+@relation\("UserSettingUpdatedByClientIdentity",\s*fields:\s*\[updatedByClientIdentityId\],\s*references:\s*\[id\]\)/,
      /@@unique\(\[userId,\s*namespace,\s*key\]\)/,
      /@@index\(\[namespace\]\)/,
      /@@index\(\[updatedByClientIdentityId\]\)/,
    ])

    const consentRecord = schemaBlock(schema, 'model', 'ConsentRecord')
    assertIncludesAll(consentRecord, [
      /clientIdentity\s+ClientIdentity\?\s+@relation\(fields:\s*\[clientIdentityId\],\s*references:\s*\[id\]\)/,
      /metadata\s+Json\?/,
      /@@index\(\[userId\]\)/,
      /@@index\(\[clientIdentityId\]\)/,
      /@@index\(\[consentType\]\)/,
      /@@index\(\[recordedAt\]\)/,
      /@@index\(\[userId,\s*consentType,\s*recordedAt\]\)/,
      /@@index\(\[clientIdentityId,\s*consentType,\s*recordedAt\]\)/,
    ])

    const analyticsEvent = schemaBlock(schema, 'model', 'AnalyticsEvent')
    assertIncludesAll(analyticsEvent, [
      /eventId\s+String\s+@unique/,
      /properties\s+Json\?/,
      /context\s+Json\?/,
      /@@index\(\[eventName\]\)/,
      /@@index\(\[occurredAt\]\)/,
      /@@index\(\[receivedAt\]\)/,
      /@@index\(\[userId\]\)/,
      /@@index\(\[clientIdentityId\]\)/,
      /@@index\(\[anonymousSessionId\]\)/,
      /@@index\(\[analyticsSessionId\]\)/,
    ])
  })
})
