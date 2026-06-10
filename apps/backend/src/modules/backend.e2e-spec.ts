import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request = require('supertest');

import { AppModule } from '../app.module';
import { PrismaService } from './prisma/prisma.service';
import { assertDisposableBackendTestDatabaseUrl } from '../testing/disposable-test-database-url';

jest.setTimeout(30000);

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for backend e2e tests');
}

assertDisposableBackendTestDatabaseUrl(databaseUrl, 'backend e2e tests');

describe('backend HTTP e2e', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(getPrisma());
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await resetDatabase(prisma);
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('runs the anonymous auth, consent, analytics, settings, and linking HTTP flow', async () => {
    const httpServer = getApp().getHttpServer();
    const database = getPrisma();

    const anonymousAuthResponse = await request(httpServer)
      .post('/auth/anonymous')
      .send({
        installationId: 'e2e-install-anonymous',
        clientKind: 'CLI',
        displayName: 'E2E CLI',
        appVersion: '0.1.0',
        analyticsSessionId: 'e2e-analytics-session',
      })
      .expect(201);

    expect(anonymousAuthResponse.body).toEqual({
      userId: expect.any(String),
      clientIdentityId: expect.any(String),
      anonymousSessionId: expect.any(String),
      sessionToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresAt: expect.any(String),
    });

    const {
      userId,
      clientIdentityId,
      anonymousSessionId,
      sessionToken,
      refreshToken,
      expiresAt,
    } = anonymousAuthResponse.body as {
      userId: string;
      clientIdentityId: string;
      anonymousSessionId: string;
      sessionToken: string;
      refreshToken: string;
      expiresAt: string;
    };

    expect(userId).not.toHaveLength(0);
    expect(clientIdentityId).not.toHaveLength(0);
    expect(anonymousSessionId).not.toHaveLength(0);
    expect(sessionToken).not.toHaveLength(0);
    expect(refreshToken).not.toHaveLength(0);
    expect(expiresAt).not.toHaveLength(0);

    const consentResponse = await request(httpServer)
      .post('/consent')
      .send({
        clientIdentityId,
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
        source: 'e2e',
      })
      .expect(201);

    expect(consentResponse.body).toEqual(
      expect.objectContaining({
        userId,
        clientIdentityId,
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
        source: 'e2e',
      }),
    );

    const analyticsResponse = await request(httpServer)
      .post('/analytics/events')
      .send({
        eventId: 'e2e-event-client-initialized',
        eventName: 'client_initialized',
        occurredAt: '2026-06-09T00:00:00.000Z',
        analyticsSessionId: 'e2e-analytics-session',
        properties: { command: 'init' },
      })
      .expect(201);

    expect(analyticsResponse.body).toEqual(
      expect.objectContaining({
        eventId: 'e2e-event-client-initialized',
        userId,
        clientIdentityId,
        anonymousSessionId,
        analyticsSessionId: 'e2e-analytics-session',
      }),
    );

    const settingValue = { mode: 'dark' };
    const settingsUpdateResponse = await request(httpServer)
      .put(`/users/${userId}/settings/default/theme`)
      .send({
        value: settingValue,
        updatedByClientIdentityId: clientIdentityId,
      })
      .expect(200);

    expect(settingsUpdateResponse.body).toEqual(
      expect.objectContaining({
        userId,
        namespace: 'default',
        key: 'theme',
        value: settingValue,
        updatedByClientIdentityId: clientIdentityId,
      }),
    );

    const settingsListResponse = await request(httpServer)
      .get(`/users/${userId}/settings`)
      .expect(200);

    expect(settingsListResponse.body).toEqual([
      expect.objectContaining({
        userId,
        namespace: 'default',
        key: 'theme',
        value: settingValue,
        updatedByClientIdentityId: clientIdentityId,
      }),
    ]);

    const targetUser = await database.user.create({
      data: {
        status: 'REGISTERED',
        registeredAt: new Date('2026-06-09T00:00:00.000Z'),
      },
    });

    const linkResponse = await request(httpServer)
      .post('/users/link-anonymous')
      .send({
        anonymousUserId: userId,
        targetUserId: targetUser.id,
      })
      .expect(201);

    expect(linkResponse.body).toEqual(
      expect.objectContaining({
        targetUserId: targetUser.id,
        mergedUserId: userId,
        migrated: {
          clientIdentities: 1,
          anonymousSessions: 1,
          analyticsEvents: 1,
          consentRecords: 1,
          userSettings: 1,
        },
      }),
    );

    await expect(
      database.analyticsEvent.count({
        where: {
          userId: targetUser.id,
          eventId: 'e2e-event-client-initialized',
        },
      }),
    ).resolves.toBe(1);

    await expect(
      database.userSetting.count({
        where: {
          userId: targetUser.id,
          namespace: 'default',
          key: 'theme',
        },
      }),
    ).resolves.toBe(1);
  });

  it('rejects analytics ingestion over HTTP when derived analytics consent is denied', async () => {
    const httpServer = getApp().getHttpServer();
    const database = getPrisma();

    const anonymousAuthResponse = await request(httpServer)
      .post('/auth/anonymous')
      .send({
        installationId: 'e2e-install-denied',
        clientKind: 'CLI',
        analyticsSessionId: 'e2e-denied-analytics-session',
      })
      .expect(201);

    const { userId, clientIdentityId } = anonymousAuthResponse.body as {
      userId: string;
      clientIdentityId: string;
    };

    await request(httpServer)
      .post('/consent')
      .send({
        userId,
        clientIdentityId,
        consentType: 'ANALYTICS',
        granted: false,
        policyVersion: '2026-01',
      })
      .expect(201);

    const analyticsResponse = await request(httpServer)
      .post('/analytics/events')
      .send({
        eventId: 'e2e-denied-event',
        eventName: 'client_initialized',
        occurredAt: '2026-06-09T00:00:00.000Z',
        analyticsSessionId: 'e2e-denied-analytics-session',
      })
      .expect(403);

    expect(analyticsResponse.body).toEqual(
      expect.objectContaining({
        message: 'Analytics consent has been denied',
      }),
    );

    await expect(
      database.analyticsEvent.count({
        where: {
          eventId: 'e2e-denied-event',
        },
      }),
    ).resolves.toBe(0);
  });

  it('rejects analytics ingestion over HTTP without resolvable attribution', async () => {
    const httpServer = getApp().getHttpServer();

    const analyticsResponse = await request(httpServer)
      .post('/analytics/events')
      .send({
        eventId: 'e2e-no-attribution',
        eventName: 'client_initialized',
        occurredAt: '2026-06-09T00:00:00.000Z',
      })
      .expect(400);

    expect(analyticsResponse.body).toEqual(
      expect.objectContaining({
        message: 'Analytics attribution is required',
      }),
    );
  });

  function getApp(): INestApplication {
    if (!app) {
      throw new Error('Nest application was not initialized');
    }

    return app;
  }

  function getPrisma(): PrismaService {
    if (!prisma) {
      throw new Error('PrismaService was not initialized');
    }

    return prisma;
  }
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
