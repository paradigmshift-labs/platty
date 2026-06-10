import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AnalyticsService } from './analytics.service';

function createPrismaMock() {
  return {
    analyticsEvent: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    anonymousSession: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    clientIdentity: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'ANONYMOUS' }),
    },
  };
}

function createConsentServiceMock() {
  return {
    getLatestConsent: jest.fn(),
  };
}

const analyticsEventSelect = {
  id: true,
  eventId: true,
  eventName: true,
  occurredAt: true,
  receivedAt: true,
  userId: true,
  clientIdentityId: true,
  anonymousSessionId: true,
  analyticsSessionId: true,
  properties: true,
  context: true,
};

describe('AnalyticsService', () => {
  it('stores a valid event and converts occurredAt to Date', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    const savedEvent = {
      id: 'analytics-1',
      eventId: 'event-1',
      eventName: 'client_initialized',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      userId: 'user-1',
      clientIdentityId: 'client-1',
      anonymousSessionId: 'anonymous-1',
      analyticsSessionId: 'analytics-session-1',
      properties: { command: 'init', durationMs: 42 },
      context: { app: { version: '0.1.0' }, timezone: 'Asia/Seoul' },
    };
    consentService.getLatestConsent.mockResolvedValue({ granted: true });
    prisma.anonymousSession.findUnique.mockResolvedValue({
      id: 'anonymous-1',
      userId: 'user-1',
      clientIdentityId: 'client-1',
      analyticsSessionId: 'analytics-session-1',
    });
    prisma.analyticsEvent.create.mockResolvedValue(savedEvent);

    const result = await service.ingestEvent({
      eventId: 'event-1',
      eventName: 'client_initialized',
      occurredAt: '2026-01-01T00:00:00.000Z',
      userId: 'user-1',
      clientIdentityId: 'client-1',
      anonymousSessionId: 'anonymous-1',
      analyticsSessionId: 'analytics-session-1',
      properties: { command: 'init', durationMs: 42 },
      context: { app: { version: '0.1.0' }, timezone: 'Asia/Seoul' },
    });

    expect(consentService.getLatestConsent).toHaveBeenCalledWith({
      userId: 'user-1',
      clientIdentityId: 'client-1',
      consentType: 'ANALYTICS',
    });
    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith({
      data: {
        eventId: 'event-1',
        eventName: 'client_initialized',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        userId: 'user-1',
        clientIdentityId: 'client-1',
        anonymousSessionId: 'anonymous-1',
        analyticsSessionId: 'analytics-session-1',
        properties: { command: 'init', durationMs: 42 },
        context: { app: { version: '0.1.0' }, timezone: 'Asia/Seoul' },
      },
      select: analyticsEventSelect,
    });
    expect(result).toEqual(savedEvent);
  });

  it('rejects unknown eventName', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    await expect(
      service.ingestEvent({
        eventId: 'event-2',
        eventName: 'unknown_event',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects impossible occurredAt dates', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    await expect(
      service.ingestEvent({
        eventId: 'event-impossible-date',
        eventName: 'client_initialized',
        occurredAt: '2026-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects ambiguous non-ISO occurredAt strings', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    await expect(
      service.ingestEvent({
        eventId: 'event-ambiguous-date',
        eventName: 'client_initialized',
        occurredAt: '1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects sensitive nested properties using event-catalog validation', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    await expect(
      service.ingestEvent({
        eventId: 'event-3',
        eventName: 'cli_command_started',
        occurredAt: '2026-01-01T00:00:00.000Z',
        properties: {
          command: 'init',
          metadata: {
            accessToken: 'secret',
          },
        },
      }),
    ).rejects.toThrow(/sensitive analytics key/);
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects sensitive nested context keys using event-catalog validation', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    await expect(
      service.ingestEvent({
        eventId: 'event-sensitive-context',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        context: {
          device: {
            accessToken: 'secret',
          },
        },
      }),
    ).rejects.toThrow(/sensitive analytics key/);
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects client analytics events without any resolvable attribution', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    await expect(
      service.ingestEvent({
        eventId: 'event-no-attribution',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects analytics events for an unknown direct userId before persistence', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.ingestEvent({
        eventId: 'event-unknown-user',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        userId: 'missing-user',
      }),
    ).rejects.toThrow('Unknown userId');
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects analytics events for a merged direct userId before persistence', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    prisma.user.findUnique.mockResolvedValue({ id: 'merged-user', status: 'MERGED' });

    await expect(
      service.ingestEvent({
        eventId: 'event-merged-user',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        userId: 'merged-user',
      }),
    ).rejects.toThrow('userId cannot receive new writes');
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects analytics events for a merged userId even with matching client attribution', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-merged',
      userId: 'merged-user',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'merged-user', status: 'MERGED' });

    await expect(
      service.ingestEvent({
        eventId: 'event-merged-user-client',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        userId: 'merged-user',
        clientIdentityId: 'client-merged',
      }),
    ).rejects.toThrow('userId cannot receive new writes');
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects analytics events for a merged userId resolved from an anonymous session', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    prisma.anonymousSession.findUnique.mockResolvedValue({
      id: 'anonymous-merged',
      userId: 'merged-user',
      clientIdentityId: null,
      analyticsSessionId: 'analytics-merged',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'merged-user', status: 'MERGED' });

    await expect(
      service.ingestEvent({
        eventId: 'event-merged-user-session',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        anonymousSessionId: 'anonymous-merged',
      }),
    ).rejects.toThrow('userId cannot receive new writes');
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects when latest analytics consent exists and granted false', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    consentService.getLatestConsent.mockResolvedValue({ granted: false });
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'user-1',
    });

    await expect(
      service.ingestEvent({
        eventId: 'event-4',
        eventName: 'settings_loaded',
        occurredAt: '2026-01-01T00:00:00.000Z',
        clientIdentityId: 'client-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(consentService.getLatestConsent).toHaveBeenCalledWith({
      userId: 'user-1',
      clientIdentityId: 'client-1',
      consentType: 'ANALYTICS',
    });
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('allows when latest analytics consent is absent', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    const savedEvent = {
      id: 'analytics-5',
      eventId: 'event-5',
      eventName: 'settings_loaded',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      userId: null,
      clientIdentityId: 'client-1',
      anonymousSessionId: null,
      analyticsSessionId: null,
      properties: null,
      context: null,
    };
    consentService.getLatestConsent.mockResolvedValue(null);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: null,
    });
    prisma.analyticsEvent.create.mockResolvedValue(savedEvent);

    const result = await service.ingestEvent({
      eventId: 'event-5',
      eventName: 'settings_loaded',
      occurredAt: '2026-01-01T00:00:00.000Z',
      clientIdentityId: 'client-1',
    });

    expect(result).toEqual(savedEvent);
    expect(prisma.analyticsEvent.create).toHaveBeenCalled();
  });

  it('derives consent identity from anonymousSessionId before storing', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    const savedEvent = {
      id: 'analytics-session-only',
      eventId: 'event-session-only',
      eventName: 'cli_command_completed',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      userId: 'user-from-session',
      clientIdentityId: 'client-from-session',
      anonymousSessionId: 'session-1',
      analyticsSessionId: 'analytics-from-session',
      properties: null,
      context: null,
    };
    prisma.anonymousSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-from-session',
      clientIdentityId: 'client-from-session',
      analyticsSessionId: 'analytics-from-session',
    });
    consentService.getLatestConsent.mockResolvedValue({ granted: true });
    prisma.analyticsEvent.create.mockResolvedValue(savedEvent);

    const result = await service.ingestEvent({
      eventId: 'event-session-only',
      eventName: 'cli_command_completed',
      occurredAt: '2026-01-01T00:00:00.000Z',
      anonymousSessionId: 'session-1',
    });

    expect(consentService.getLatestConsent).toHaveBeenCalledWith({
      userId: 'user-from-session',
      clientIdentityId: 'client-from-session',
      consentType: 'ANALYTICS',
    });
    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-from-session',
        clientIdentityId: 'client-from-session',
        anonymousSessionId: 'session-1',
        analyticsSessionId: 'analytics-from-session',
      }),
      select: analyticsEventSelect,
    });
    expect(result).toEqual(savedEvent);
  });

  it('rejects mismatched anonymous session attribution', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    prisma.anonymousSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'canonical-user',
      clientIdentityId: 'canonical-client',
      analyticsSessionId: 'canonical-analytics-session',
    });

    await expect(
      service.ingestEvent({
        eventId: 'event-mismatch',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        userId: 'spoofed-user',
        anonymousSessionId: 'session-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects session-only events when derived analytics consent is denied', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    prisma.anonymousSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-from-session',
      clientIdentityId: 'client-from-session',
      analyticsSessionId: null,
    });
    consentService.getLatestConsent.mockResolvedValue({ granted: false });

    await expect(
      service.ingestEvent({
        eventId: 'event-denied-session',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        anonymousSessionId: 'session-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('derives consent identity from analyticsSessionId before storing', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    const savedEvent = {
      id: 'analytics-session-id-only',
      eventId: 'event-analytics-session-id-only',
      eventName: 'cli_command_completed',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      userId: 'user-from-analytics-session',
      clientIdentityId: 'client-from-analytics-session',
      anonymousSessionId: 'session-from-analytics-session',
      analyticsSessionId: 'analytics-session-1',
      properties: null,
      context: null,
    };
    prisma.anonymousSession.findUnique.mockResolvedValue({
      id: 'session-from-analytics-session',
      userId: 'user-from-analytics-session',
      clientIdentityId: 'client-from-analytics-session',
      analyticsSessionId: 'analytics-session-1',
    });
    consentService.getLatestConsent.mockResolvedValue({ granted: true });
    prisma.analyticsEvent.create.mockResolvedValue(savedEvent);

    const result = await service.ingestEvent({
      eventId: 'event-analytics-session-id-only',
      eventName: 'cli_command_completed',
      occurredAt: '2026-01-01T00:00:00.000Z',
      analyticsSessionId: 'analytics-session-1',
    });

    expect(consentService.getLatestConsent).toHaveBeenCalledWith({
      userId: 'user-from-analytics-session',
      clientIdentityId: 'client-from-analytics-session',
      consentType: 'ANALYTICS',
    });
    expect(prisma.analyticsEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-from-analytics-session',
        clientIdentityId: 'client-from-analytics-session',
        anonymousSessionId: 'session-from-analytics-session',
        analyticsSessionId: 'analytics-session-1',
      }),
      select: analyticsEventSelect,
    });
    expect(result).toEqual(savedEvent);
  });

  it('rejects analyticsSessionId-only events when derived analytics consent is denied', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    prisma.anonymousSession.findUnique.mockResolvedValue({
      id: 'session-from-analytics-session',
      userId: 'user-from-analytics-session',
      clientIdentityId: 'client-from-analytics-session',
      analyticsSessionId: 'analytics-session-1',
    });
    consentService.getLatestConsent.mockResolvedValue({ granted: false });

    await expect(
      service.ingestEvent({
        eventId: 'event-analytics-session-denied',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        analyticsSessionId: 'analytics-session-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects explicit user attribution for a client identity without canonical user', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);

    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-orphan',
      userId: null,
    });

    await expect(
      service.ingestEvent({
        eventId: 'event-orphan-client',
        eventName: 'client_initialized',
        occurredAt: '2026-01-01T00:00:00.000Z',
        userId: 'spoofed-user',
        clientIdentityId: 'client-orphan',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consentService.getLatestConsent).not.toHaveBeenCalled();
    expect(prisma.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('returns an existing event when duplicate eventId P2002 occurs', async () => {
    const prisma = createPrismaMock();
    const consentService = createConsentServiceMock();
    const service = new AnalyticsService(prisma as never, consentService as never);
    const existingEvent = {
      id: 'analytics-6',
      eventId: 'event-6',
      eventName: 'client_initialized',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      userId: 'user-1',
      clientIdentityId: 'client-1',
      anonymousSessionId: null,
      analyticsSessionId: null,
      properties: { command: 'init' },
      context: null,
    };
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'user-1',
    });
    consentService.getLatestConsent.mockResolvedValue(null);
    prisma.analyticsEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.0',
      }),
    );
    prisma.analyticsEvent.findUnique.mockResolvedValue(existingEvent);

    const result = await service.ingestEvent({
      eventId: 'event-6',
      eventName: 'client_initialized',
      occurredAt: '2026-01-01T00:00:00.000Z',
      clientIdentityId: 'client-1',
      properties: { command: 'init' },
    });

    expect(prisma.analyticsEvent.findUnique).toHaveBeenCalledWith({
      where: { eventId: 'event-6' },
      select: analyticsEventSelect,
    });
    expect(result).toEqual(existingEvent);
  });
});
