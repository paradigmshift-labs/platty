import { createHash } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

import { AuthService } from './auth.service';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createPrismaMock() {
  const tx = {
    clientIdentity: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      create: jest.fn(),
    },
    anonymousSession: {
      create: jest.fn(),
    },
    userIdentityAlias: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return { prisma, tx };
}

function createP2002Error(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

describe('AuthService', () => {
  it('creates anonymous user, client, and session for a new installation', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);
    const nowBefore = Date.now();

    tx.clientIdentity.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 'user-new', status: 'ANONYMOUS' });
    tx.clientIdentity.create.mockResolvedValue({
      id: 'client-new',
      userId: 'user-new',
      installationId: 'install-1',
    });
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-new',
      ...data,
    }));
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.create.mockResolvedValue({});

    const result = await service.startAnonymousSession({
      installationId: 'install-1',
      clientKind: 'CLI',
      displayName: 'Local CLI',
      appVersion: '1.2.3',
      analyticsSessionId: 'analytics-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledWith({ data: { status: 'ANONYMOUS' } });
    expect(tx.clientIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-new',
        installationId: 'install-1',
        clientKind: 'CLI',
        displayName: 'Local CLI',
        appVersion: '1.2.3',
      }),
    });
    expect(tx.anonymousSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-new',
        clientIdentityId: 'client-new',
        analyticsSessionId: 'analytics-1',
        sessionTokenHash: expect.any(String),
        refreshTokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        userId: 'user-new',
        clientIdentityId: 'client-new',
        anonymousSessionId: 'session-new',
        sessionToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    );
    expect(result.sessionToken).toHaveLength(64);
    expect(result.refreshToken).toHaveLength(64);
    expect(result.expiresAt.getTime()).toBeGreaterThan(nowBefore + 29 * 24 * 60 * 60 * 1000);
  });

  it('reuses an existing client user for the same installation', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.clientIdentity.update.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-existing',
      ...data,
    }));
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.create.mockResolvedValue({});

    const result = await service.startAnonymousSession({
      installationId: 'install-1',
      clientKind: 'DASHBOARD',
      displayName: 'Dashboard',
      appVersion: '2.0.0',
    });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.clientIdentity.create).not.toHaveBeenCalled();
    expect(tx.clientIdentity.update).toHaveBeenCalledWith({
      where: { id: 'client-existing' },
      data: expect.objectContaining({
        clientKind: 'DASHBOARD',
        displayName: 'Dashboard',
        appVersion: '2.0.0',
        lastSeenAt: expect.any(Date),
      }),
    });
    expect(result.userId).toBe('user-existing');
    expect(result.clientIdentityId).toBe('client-existing');
  });

  it('stores token hashes instead of raw tokens', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 'user-new', status: 'ANONYMOUS' });
    tx.clientIdentity.create.mockResolvedValue({
      id: 'client-new',
      userId: 'user-new',
      installationId: 'install-1',
    });
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-new',
      ...data,
    }));
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.create.mockResolvedValue({});

    const result = await service.startAnonymousSession({ installationId: 'install-1' });
    const sessionCreate = tx.anonymousSession.create.mock.calls[0][0].data;

    expect(sessionCreate.sessionTokenHash).toBe(hashToken(result.sessionToken));
    expect(sessionCreate.refreshTokenHash).toBe(hashToken(result.refreshToken));
    expect(sessionCreate.sessionTokenHash).not.toBe(result.sessionToken);
    expect(sessionCreate.refreshTokenHash).not.toBe(result.refreshToken);
    expect(sessionCreate.sessionToken).toBeUndefined();
    expect(sessionCreate.refreshToken).toBeUndefined();
  });

  it('creates installation and analytics aliases for the canonical user', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 'user-new', status: 'ANONYMOUS' });
    tx.clientIdentity.create.mockResolvedValue({
      id: 'client-new',
      userId: 'user-new',
      installationId: 'install-1',
    });
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-new',
      ...data,
    }));
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.create.mockResolvedValue({});

    await service.startAnonymousSession({
      installationId: 'install-1',
      analyticsSessionId: 'analytics-1',
    });

    expect(tx.userIdentityAlias.create).toHaveBeenCalledTimes(2);
    expect(tx.userIdentityAlias.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-new',
        aliasKind: 'CLIENT_INSTALLATION_ID',
        aliasValue: 'install-1',
      }),
    });
    expect(tx.userIdentityAlias.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-new',
        aliasKind: 'ANALYTICS_SESSION_ID',
        aliasValue: 'analytics-1',
      }),
    });
  });

  it('retries when another request creates the same installation first', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'client-canonical',
        userId: 'user-canonical',
        installationId: 'install-1',
      });
    tx.user.create.mockResolvedValueOnce({ id: 'user-loser', status: 'ANONYMOUS' });
    tx.clientIdentity.create.mockRejectedValueOnce(createP2002Error());
    tx.clientIdentity.update.mockResolvedValueOnce({
      id: 'client-canonical',
      userId: 'user-canonical',
      installationId: 'install-1',
    });
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-canonical',
      ...data,
    }));
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.create.mockResolvedValue({});

    const result = await service.startAnonymousSession({ installationId: 'install-1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.anonymousSession.create).toHaveBeenCalledTimes(1);
    expect(tx.anonymousSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-canonical',
        clientIdentityId: 'client-canonical',
      }),
    });
    expect(result.userId).toBe('user-canonical');
    expect(result.clientIdentityId).toBe('client-canonical');
  });

  it('retries when a nullable existing client is claimed by another request first', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique
      .mockResolvedValueOnce({
        id: 'client-existing',
        userId: null,
        installationId: 'install-1',
      })
      .mockResolvedValueOnce({
        id: 'client-existing',
        userId: 'user-canonical',
        installationId: 'install-1',
      });
    tx.user.create.mockResolvedValueOnce({ id: 'user-loser', status: 'ANONYMOUS' });
    tx.clientIdentity.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.clientIdentity.update.mockResolvedValueOnce({
      id: 'client-existing',
      userId: 'user-canonical',
      installationId: 'install-1',
    });
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-canonical',
      ...data,
    }));
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.create.mockResolvedValue({});

    const result = await service.startAnonymousSession({ installationId: 'install-1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.clientIdentity.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'client-existing',
        userId: null,
      },
      data: expect.objectContaining({
        userId: 'user-loser',
        clientKind: 'UNKNOWN',
        lastSeenAt: expect.any(Date),
      }),
    });
    expect(tx.anonymousSession.create).toHaveBeenCalledTimes(1);
    expect(tx.anonymousSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-canonical',
        clientIdentityId: 'client-existing',
      }),
    });
    expect(result.userId).toBe('user-canonical');
    expect(result.clientIdentityId).toBe('client-existing');
  });

  it('accepts an existing alias owned by the same user', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.clientIdentity.update.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.userIdentityAlias.findUnique.mockResolvedValue({
      id: 'alias-existing',
      userId: 'user-existing',
      aliasKind: 'CLIENT_INSTALLATION_ID',
      aliasValue: 'install-1',
    });
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-existing',
      ...data,
    }));

    await service.startAnonymousSession({ installationId: 'install-1' });

    expect(tx.userIdentityAlias.create).not.toHaveBeenCalled();
  });

  it('rejects an existing alias owned by a different user', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.clientIdentity.update.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.userIdentityAlias.findUnique.mockResolvedValue({
      id: 'alias-other',
      userId: 'user-other',
      aliasKind: 'CLIENT_INSTALLATION_ID',
      aliasValue: 'install-1',
    });

    await expect(service.startAnonymousSession({ installationId: 'install-1' })).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.userIdentityAlias.create).not.toHaveBeenCalled();
    expect(tx.anonymousSession.create).not.toHaveBeenCalled();
  });

  it('retries alias creation races in a fresh transaction before accepting same-user ownership', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.clientIdentity.update.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.userIdentityAlias.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'alias-existing',
        userId: 'user-existing',
        aliasKind: 'CLIENT_INSTALLATION_ID',
        aliasValue: 'install-1',
      });
    tx.userIdentityAlias.create.mockRejectedValueOnce(createP2002Error());
    tx.anonymousSession.create.mockImplementation(async ({ data }) => ({
      id: 'session-existing',
      ...data,
    }));

    const result = await service.startAnonymousSession({ installationId: 'install-1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.userIdentityAlias.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.userIdentityAlias.findUnique.mock.invocationCallOrder[1]).toBeGreaterThan(
      prisma.$transaction.mock.invocationCallOrder[1],
    );
    expect(tx.userIdentityAlias.create).toHaveBeenCalledTimes(1);
    expect(tx.anonymousSession.create).toHaveBeenCalledTimes(1);
    expect(tx.anonymousSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-existing',
        clientIdentityId: 'client-existing',
      }),
    });
    expect(result.userId).toBe('user-existing');
    expect(result.clientIdentityId).toBe('client-existing');
  });

  it('returns conflict when identity acquisition retries are exhausted', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 'user-loser' });
    tx.clientIdentity.create.mockRejectedValue(createP2002Error());

    await expect(service.startAnonymousSession({ installationId: 'install-race' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(tx.anonymousSession.create).not.toHaveBeenCalled();
  });

  it('returns conflict when analyticsSessionId is already used by an existing session', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new AuthService(prisma as never);

    tx.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.clientIdentity.update.mockResolvedValue({
      id: 'client-existing',
      userId: 'user-existing',
      installationId: 'install-1',
    });
    tx.userIdentityAlias.findUnique.mockResolvedValue({
      id: 'alias-existing',
      userId: 'user-existing',
      aliasKind: 'ANALYTICS_SESSION_ID',
      aliasValue: 'analytics-1',
    });
    tx.anonymousSession.create.mockRejectedValue(createP2002Error());

    await expect(
      service.startAnonymousSession({
        installationId: 'install-1',
        analyticsSessionId: 'analytics-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
