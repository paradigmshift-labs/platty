import { ForbiddenException } from '@nestjs/common';
import { ClientKind, ConsentType, PrismaClient } from '@prisma/client';

import { AnalyticsService } from './analytics/analytics.service';
import { ConsentService } from './consent/consent.service';
import { UsersService } from './users/users.service';
import { assertDisposableBackendTestDatabaseUrl } from '../testing/disposable-test-database-url';

jest.setTimeout(30000);

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for backend integration tests');
}

assertDisposableBackendTestDatabaseUrl(databaseUrl, 'backend integration tests');

describe('backend Prisma integration', () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    try {
      await resetDatabase(prisma);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects session-only analytics ingestion when derived consent is denied', async () => {
    const user = await prisma.user.create({ data: { status: 'ANONYMOUS' } });
    const client = await prisma.clientIdentity.create({
      data: {
        userId: user.id,
        clientKind: ClientKind.CLI,
        installationId: 'install-session-denied',
      },
    });
    const session = await prisma.anonymousSession.create({
      data: {
        userId: user.id,
        clientIdentityId: client.id,
        sessionTokenHash: 'session-token-hash',
        refreshTokenHash: 'refresh-token-hash',
        analyticsSessionId: 'analytics-session-denied',
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    await prisma.consentRecord.create({
      data: {
        userId: user.id,
        clientIdentityId: client.id,
        consentType: ConsentType.ANALYTICS,
        granted: false,
        policyVersion: '2026-01',
      },
    });

    const analyticsService = new AnalyticsService(prisma as never, new ConsentService(prisma as never));

    await expect(
      analyticsService.ingestEvent({
        eventId: 'event-session-denied',
        eventName: 'client_initialized',
        occurredAt: '2026-06-09T00:00:00.000Z',
        analyticsSessionId: session.analyticsSessionId ?? undefined,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(prisma.analyticsEvent.count()).resolves.toBe(0);
  });

  it('returns the existing analytics event for duplicate eventId', async () => {
    const analyticsService = new AnalyticsService(prisma as never, new ConsentService(prisma as never));
    const user = await prisma.user.create({ data: { status: 'ANONYMOUS' } });
    const client = await prisma.clientIdentity.create({
      data: {
        userId: user.id,
        clientKind: ClientKind.CLI,
        installationId: 'install-duplicate',
      },
    });

    const first = await analyticsService.ingestEvent({
      eventId: 'event-duplicate',
      eventName: 'client_initialized',
      occurredAt: '2026-06-09T00:00:00.000Z',
      clientIdentityId: client.id,
      properties: { command: 'init' },
    });
    const second = await analyticsService.ingestEvent({
      eventId: 'event-duplicate',
      eventName: 'client_initialized',
      occurredAt: '2026-06-09T00:00:00.000Z',
      clientIdentityId: client.id,
      properties: { command: 'init' },
    });

    expect(second.id).toBe(first.id);
    await expect(prisma.analyticsEvent.count()).resolves.toBe(1);
  });

  it('links anonymous users while migrating client-only and session-only continuity rows', async () => {
    const anonymousUser = await prisma.user.create({ data: { status: 'ANONYMOUS' } });
    const otherUser = await prisma.user.create({ data: { status: 'REGISTERED', registeredAt: new Date() } });
    const targetUser = await prisma.user.create({
      data: {
        status: 'REGISTERED',
        registeredAt: new Date('2026-06-09T00:00:00.000Z'),
      },
    });
    const client = await prisma.clientIdentity.create({
      data: {
        userId: anonymousUser.id,
        clientKind: ClientKind.CLI,
        installationId: 'install-linking',
      },
    });
    const session = await prisma.anonymousSession.create({
      data: {
        userId: anonymousUser.id,
        clientIdentityId: client.id,
        sessionTokenHash: 'link-session-token-hash',
        refreshTokenHash: 'link-refresh-token-hash',
        analyticsSessionId: 'analytics-session-linking',
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    await prisma.analyticsEvent.createMany({
      data: [
        {
          eventId: 'event-user-attributed',
          eventName: 'client_initialized',
          occurredAt: new Date('2026-06-09T00:00:00.000Z'),
          userId: anonymousUser.id,
        },
        {
          eventId: 'event-client-attributed',
          eventName: 'cli_command_started',
          occurredAt: new Date('2026-06-09T00:01:00.000Z'),
          clientIdentityId: client.id,
        },
        {
          eventId: 'event-session-attributed',
          eventName: 'cli_command_completed',
          occurredAt: new Date('2026-06-09T00:02:00.000Z'),
          anonymousSessionId: session.id,
        },
        {
          eventId: 'event-analytics-session-attributed',
          eventName: 'analytics_batch_flushed',
          occurredAt: new Date('2026-06-09T00:03:00.000Z'),
          analyticsSessionId: 'analytics-session-linking',
        },
        {
          eventId: 'event-other-user-with-source-client',
          eventName: 'settings_loaded',
          occurredAt: new Date('2026-06-09T00:04:00.000Z'),
          userId: otherUser.id,
          clientIdentityId: client.id,
        },
        {
          eventId: 'event-other-user-with-source-session',
          eventName: 'settings_saved',
          occurredAt: new Date('2026-06-09T00:05:00.000Z'),
          userId: otherUser.id,
          anonymousSessionId: session.id,
        },
      ],
    });
    await prisma.consentRecord.create({
      data: {
        clientIdentityId: client.id,
        consentType: ConsentType.ANALYTICS,
        granted: true,
        policyVersion: '2026-01',
      },
    });
    await prisma.consentRecord.create({
      data: {
        userId: otherUser.id,
        clientIdentityId: client.id,
        consentType: ConsentType.ERROR_REPORTING,
        granted: false,
        policyVersion: '2026-01',
      },
    });
    await prisma.userSetting.create({
      data: {
        userId: targetUser.id,
        namespace: 'default',
        key: 'theme',
        value: 'light',
      },
    });
    await prisma.userSetting.create({
      data: {
        userId: anonymousUser.id,
        namespace: 'default',
        key: 'theme',
        value: 'dark',
      },
    });
    await prisma.userSetting.create({
      data: {
        userId: anonymousUser.id,
        namespace: 'default',
        key: 'fontSize',
        value: 14,
      },
    });

    const usersService = new UsersService(prisma as never);
    const result = await usersService.linkAnonymousUser({
      anonymousUserId: anonymousUser.id,
      targetUserId: targetUser.id,
    });

    expect(result.migrated.analyticsEvents).toBe(4);
    expect(result.migrated.consentRecords).toBe(1);
    expect(result.migrated.userSettings).toBe(1);

    await expect(
      prisma.analyticsEvent.count({
        where: {
          userId: targetUser.id,
        },
      }),
    ).resolves.toBe(4);
    await expect(
      prisma.analyticsEvent.count({
        where: {
          userId: otherUser.id,
        },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.consentRecord.count({
        where: {
          userId: targetUser.id,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.consentRecord.count({
        where: {
          userId: otherUser.id,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.userSetting.findMany({
        where: { userId: targetUser.id },
        orderBy: { key: 'asc' },
      }),
    ).resolves.toEqual([
      expect.objectContaining({ key: 'fontSize', value: 14 }),
      expect.objectContaining({ key: 'theme', value: 'light' }),
    ]);
  });
});

async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.analyticsEvent.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.userSetting.deleteMany();
  await prisma.anonymousSession.deleteMany();
  await prisma.clientIdentity.deleteMany();
  await prisma.userIdentityAlias.deleteMany();
  await prisma.user.deleteMany();
}
