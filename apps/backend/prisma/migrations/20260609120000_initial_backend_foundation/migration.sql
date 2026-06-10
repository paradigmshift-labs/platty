-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ANONYMOUS', 'REGISTERED', 'MERGED', 'DELETED');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('CLI', 'DASHBOARD', 'DESKTOP', 'FLUTTER', 'API', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IdentityAliasKind" AS ENUM ('ANONYMOUS_USER_ID', 'CLIENT_INSTALLATION_ID', 'ANALYTICS_SESSION_ID', 'AUTH_PROVIDER_SUBJECT', 'EMAIL_HASH');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('ANALYTICS', 'PRODUCT_UPDATES', 'ERROR_REPORTING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ANONYMOUS',
    "registeredAt" TIMESTAMP(3),
    "mergedIntoUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clientKind" "ClientKind" NOT NULL,
    "installationId" TEXT NOT NULL,
    "displayName" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnonymousSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientIdentityId" TEXT,
    "sessionTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT,
    "analyticsSessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AnonymousSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdentityAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aliasKind" "IdentityAliasKind" NOT NULL,
    "aliasValue" TEXT NOT NULL,
    "linkedFromUserId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "UserIdentityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'default',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByClientIdentityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clientIdentityId" TEXT,
    "consentType" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "source" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "clientIdentityId" TEXT,
    "anonymousSessionId" TEXT,
    "analyticsSessionId" TEXT,
    "properties" JSONB,
    "context" JSONB,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_mergedIntoUserId_idx" ON "User"("mergedIntoUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientIdentity_installationId_key" ON "ClientIdentity"("installationId");

-- CreateIndex
CREATE INDEX "ClientIdentity_userId_idx" ON "ClientIdentity"("userId");

-- CreateIndex
CREATE INDEX "ClientIdentity_clientKind_idx" ON "ClientIdentity"("clientKind");

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousSession_sessionTokenHash_key" ON "AnonymousSession"("sessionTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousSession_refreshTokenHash_key" ON "AnonymousSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "AnonymousSession_userId_idx" ON "AnonymousSession"("userId");

-- CreateIndex
CREATE INDEX "AnonymousSession_clientIdentityId_idx" ON "AnonymousSession"("clientIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousSession_analyticsSessionId_key" ON "AnonymousSession"("analyticsSessionId");

-- CreateIndex
CREATE INDEX "AnonymousSession_expiresAt_idx" ON "AnonymousSession"("expiresAt");

-- CreateIndex
CREATE INDEX "UserIdentityAlias_userId_idx" ON "UserIdentityAlias"("userId");

-- CreateIndex
CREATE INDEX "UserIdentityAlias_linkedFromUserId_idx" ON "UserIdentityAlias"("linkedFromUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentityAlias_aliasKind_aliasValue_key" ON "UserIdentityAlias"("aliasKind", "aliasValue");

-- CreateIndex
CREATE INDEX "UserSetting_namespace_idx" ON "UserSetting"("namespace");

-- CreateIndex
CREATE INDEX "UserSetting_updatedByClientIdentityId_idx" ON "UserSetting"("updatedByClientIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSetting_userId_namespace_key_key" ON "UserSetting"("userId", "namespace", "key");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_idx" ON "ConsentRecord"("userId");

-- CreateIndex
CREATE INDEX "ConsentRecord_clientIdentityId_idx" ON "ConsentRecord"("clientIdentityId");

-- CreateIndex
CREATE INDEX "ConsentRecord_consentType_idx" ON "ConsentRecord"("consentType");

-- CreateIndex
CREATE INDEX "ConsentRecord_recordedAt_idx" ON "ConsentRecord"("recordedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_consentType_recordedAt_idx" ON "ConsentRecord"("userId", "consentType", "recordedAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_clientIdentityId_consentType_recordedAt_idx" ON "ConsentRecord"("clientIdentityId", "consentType", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_eventId_key" ON "AnalyticsEvent"("eventId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_idx" ON "AnalyticsEvent"("eventName");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_receivedAt_idx" ON "AnalyticsEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_idx" ON "AnalyticsEvent"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_clientIdentityId_idx" ON "AnalyticsEvent"("clientIdentityId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_anonymousSessionId_idx" ON "AnalyticsEvent"("anonymousSessionId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_analyticsSessionId_idx" ON "AnalyticsEvent"("analyticsSessionId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_mergedIntoUserId_fkey" FOREIGN KEY ("mergedIntoUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIdentity" ADD CONSTRAINT "ClientIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnonymousSession" ADD CONSTRAINT "AnonymousSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnonymousSession" ADD CONSTRAINT "AnonymousSession_clientIdentityId_fkey" FOREIGN KEY ("clientIdentityId") REFERENCES "ClientIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityAlias" ADD CONSTRAINT "UserIdentityAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentityAlias" ADD CONSTRAINT "UserIdentityAlias_linkedFromUserId_fkey" FOREIGN KEY ("linkedFromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSetting" ADD CONSTRAINT "UserSetting_updatedByClientIdentityId_fkey" FOREIGN KEY ("updatedByClientIdentityId") REFERENCES "ClientIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_clientIdentityId_fkey" FOREIGN KEY ("clientIdentityId") REFERENCES "ClientIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_clientIdentityId_fkey" FOREIGN KEY ("clientIdentityId") REFERENCES "ClientIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_anonymousSessionId_fkey" FOREIGN KEY ("anonymousSessionId") REFERENCES "AnonymousSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
