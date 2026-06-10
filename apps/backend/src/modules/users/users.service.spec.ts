import { ConflictException } from '@nestjs/common';

import { UsersService } from './users.service';

function createTransactionMock() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    clientIdentity: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    anonymousSession: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    analyticsEvent: {
      updateMany: jest.fn(),
    },
    consentRecord: {
      updateMany: jest.fn(),
    },
    userSetting: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userIdentityAlias: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
  };
}

function createPrismaMock(txs = [createTransactionMock()]) {
  let transactionIndex = 0;

  const prisma = {
    $transaction: jest.fn(
      async (callback: (transaction: ReturnType<typeof createTransactionMock>) => Promise<unknown>) => {
        const tx = txs[transactionIndex] ?? txs[txs.length - 1];
        transactionIndex += 1;
        return callback(tx);
      },
    ),
  };

  return { prisma, tx: txs[0], txs };
}

function createP2002Error(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function mockContinuityUpdates(tx: ReturnType<typeof createPrismaMock>['tx'], counts = {}) {
  const defaults = {
    clientIdentities: 1,
    anonymousSessions: 2,
    analyticsEvents: 3,
    consentRecords: 4,
    userSettings: 5,
  };
  const mergedCounts = { ...defaults, ...counts };

  tx.clientIdentity.updateMany.mockResolvedValue({ count: mergedCounts.clientIdentities });
  tx.anonymousSession.updateMany.mockResolvedValue({ count: mergedCounts.anonymousSessions });
  tx.analyticsEvent.updateMany.mockResolvedValue({ count: mergedCounts.analyticsEvents });
  tx.consentRecord.updateMany.mockResolvedValue({ count: mergedCounts.consentRecords });
  tx.userSetting.updateMany.mockResolvedValue({ count: mergedCounts.userSettings });
  tx.clientIdentity.findMany.mockResolvedValue(
    Array.from({ length: mergedCounts.clientIdentities }, (_, index) => ({
      id: `client-${index}`,
    })),
  );
  tx.anonymousSession.findMany.mockResolvedValue(
    Array.from({ length: mergedCounts.anonymousSessions }, (_, index) => ({
      id: `session-${index}`,
      analyticsSessionId: `analytics-session-${index}`,
    })),
  );
  tx.userSetting.findMany.mockResolvedValueOnce(
    Array.from({ length: mergedCounts.userSettings }, (_, index) => ({
      id: `anonymous-setting-${index + 1}`,
      namespace: 'default',
      key: `setting-${index + 1}`,
    })),
  );
  tx.userSetting.findMany.mockResolvedValueOnce([]);
  tx.userSetting.update.mockResolvedValue({});
  tx.userSetting.delete.mockResolvedValue({});

  return mergedCounts;
}

describe('UsersService', () => {
  it('creates registered target user when targetUserId is absent and marks anonymous user merged', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);
    const migrated = mockContinuityUpdates(tx);

    tx.user.findUnique.mockResolvedValueOnce({
      id: 'anonymous-user',
      status: 'ANONYMOUS',
      mergedIntoUserId: null,
    });
    tx.user.create.mockResolvedValue({
      id: 'registered-user',
      status: 'REGISTERED',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.userIdentityAlias.findMany.mockResolvedValue([]);
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.create.mockResolvedValue({});

    const result = await service.linkAnonymousUser({
      anonymousUserId: 'anonymous-user',
      providerSubject: 'provider|subject',
      emailHash: 'hash-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        status: 'REGISTERED',
        registeredAt: expect.any(Date),
      },
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'anonymous-user', status: 'ANONYMOUS', mergedIntoUserId: null },
      data: {
        status: 'MERGED',
        mergedIntoUserId: 'registered-user',
      },
    });
    expect(tx.userIdentityAlias.create).toHaveBeenCalledWith({
      data: {
        userId: 'registered-user',
        aliasKind: 'AUTH_PROVIDER_SUBJECT',
        aliasValue: 'provider|subject',
        linkedFromUserId: 'anonymous-user',
      },
    });
    expect(tx.userIdentityAlias.create).toHaveBeenCalledWith({
      data: {
        userId: 'registered-user',
        aliasKind: 'EMAIL_HASH',
        aliasValue: 'hash-1',
        linkedFromUserId: 'anonymous-user',
      },
    });
    expect(result).toEqual({
      targetUserId: 'registered-user',
      mergedUserId: 'anonymous-user',
      migrated,
      aliases: {
        moved: 0,
        deletedDuplicates: 0,
        created: [
          { aliasKind: 'AUTH_PROVIDER_SUBJECT', aliasValue: 'provider|subject', action: 'created' },
          { aliasKind: 'EMAIL_HASH', aliasValue: 'hash-1', action: 'created' },
        ],
      },
    });
  });

  it('links into existing target user and migrates continuity records', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);
    mockContinuityUpdates(tx, {
      clientIdentities: 2,
      anonymousSessions: 1,
      analyticsEvents: 8,
      consentRecords: 3,
      userSettings: 0,
    });

    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'REGISTERED',
        mergedIntoUserId: null,
      });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.userIdentityAlias.findMany.mockResolvedValue([
      { id: 'alias-1', userId: 'anonymous-user', aliasKind: 'ANONYMOUS_USER_ID', aliasValue: 'anonymous-user' },
    ]);
    tx.userIdentityAlias.findUnique.mockResolvedValue(null);
    tx.userIdentityAlias.update.mockResolvedValue({});

    const result = await service.linkAnonymousUser({
      anonymousUserId: 'anonymous-user',
      targetUserId: 'target-user',
    });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.clientIdentity.updateMany).toHaveBeenCalledWith({
      where: { userId: 'anonymous-user' },
      data: { userId: 'target-user' },
    });
    expect(tx.anonymousSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'anonymous-user' },
      data: { userId: 'target-user' },
    });
    expect(tx.analyticsEvent.updateMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { userId: 'anonymous-user' },
              { clientIdentityId: { in: ['client-0', 'client-1'] } },
              { anonymousSessionId: { in: ['session-0'] } },
              { analyticsSessionId: { in: ['analytics-session-0'] } },
            ],
          },
          { OR: [{ userId: 'anonymous-user' }, { userId: null }] },
        ],
      },
      data: { userId: 'target-user' },
    });
    expect(tx.consentRecord.updateMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { userId: 'anonymous-user' },
              { clientIdentityId: { in: ['client-0', 'client-1'] } },
            ],
          },
          { OR: [{ userId: 'anonymous-user' }, { userId: null }] },
        ],
      },
      data: { userId: 'target-user' },
    });
    expect(tx.userSetting.updateMany).not.toHaveBeenCalled();
    expect(tx.userSetting.findMany).toHaveBeenCalledWith({
      where: { userId: 'anonymous-user' },
      select: { id: true, namespace: true, key: true },
    });
    expect(tx.userSetting.findMany).toHaveBeenCalledWith({
      where: { userId: 'target-user' },
      select: { id: true, namespace: true, key: true },
    });
    expect(tx.userSetting.update).not.toHaveBeenCalled();
    expect(tx.userSetting.delete).not.toHaveBeenCalled();
    expect(result.migrated.userSettings).toBe(0);
    expect(result.migrated).toEqual({
      clientIdentities: 2,
      anonymousSessions: 1,
      analyticsEvents: 8,
      consentRecords: 3,
      userSettings: 0,
    });
    expect(tx.userIdentityAlias.update).toHaveBeenCalledWith({
      where: { id: 'alias-1' },
      data: {
        userId: 'target-user',
        linkedFromUserId: 'anonymous-user',
      },
    });
    expect(result.targetUserId).toBe('target-user');
    expect(result.mergedUserId).toBe('anonymous-user');
    expect(result.aliases.moved).toBe(1);
  });

  it('deletes duplicate anonymous settings and moves only non-duplicates without bulk setting update', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);
    mockContinuityUpdates(tx, {
      clientIdentities: 0,
      anonymousSessions: 0,
      analyticsEvents: 0,
      consentRecords: 0,
      userSettings: 0,
    });
    tx.userSetting.findMany.mockReset();
    tx.userSetting.findMany
      .mockResolvedValueOnce([
        { id: 'anonymous-duplicate-setting', namespace: 'notifications', key: 'email' },
        { id: 'anonymous-unique-setting', namespace: 'privacy', key: 'share-analytics' },
      ])
      .mockResolvedValueOnce([{ id: 'target-setting', namespace: 'notifications', key: 'email' }]);

    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'REGISTERED',
        mergedIntoUserId: null,
      });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.userSetting.update.mockResolvedValue({});
    tx.userSetting.delete.mockResolvedValue({});
    tx.userIdentityAlias.findMany.mockResolvedValue([]);

    const result = await service.linkAnonymousUser({
      anonymousUserId: 'anonymous-user',
      targetUserId: 'target-user',
    });

    expect(tx.userSetting.findMany).toHaveBeenCalledWith({
      where: { userId: 'anonymous-user' },
      select: { id: true, namespace: true, key: true },
    });
    expect(tx.userSetting.findMany).toHaveBeenCalledWith({
      where: { userId: 'target-user' },
      select: { id: true, namespace: true, key: true },
    });
    expect(tx.userSetting.delete).toHaveBeenCalledWith({
      where: { id: 'anonymous-duplicate-setting' },
    });
    expect(tx.userSetting.update).toHaveBeenCalledWith({
      where: { id: 'anonymous-unique-setting' },
      data: { userId: 'target-user' },
    });
    expect(tx.userSetting.updateMany).not.toHaveBeenCalled();
    expect(result.migrated.userSettings).toBe(1);
  });

  it('retries setting reconciliation when a concurrent target setting creates a unique conflict', async () => {
    const firstTx = createTransactionMock();
    const retryTx = createTransactionMock();
    const { prisma } = createPrismaMock([firstTx, retryTx]);
    const service = new UsersService(prisma as never);

    for (const tx of [firstTx, retryTx]) {
      mockContinuityUpdates(tx, {
        clientIdentities: 0,
        anonymousSessions: 0,
        analyticsEvents: 0,
        consentRecords: 0,
        userSettings: 0,
      });
      tx.user.findUnique
        .mockResolvedValueOnce({
          id: 'anonymous-user',
          status: 'ANONYMOUS',
          mergedIntoUserId: null,
        })
        .mockResolvedValueOnce({
          id: 'target-user',
          status: 'REGISTERED',
          mergedIntoUserId: null,
        });
      tx.user.updateMany.mockResolvedValue({ count: 1 });
      tx.userSetting.findMany.mockReset();
      tx.userIdentityAlias.findMany.mockResolvedValue([]);
    }

    firstTx.userSetting.findMany
      .mockResolvedValueOnce([{ id: 'anonymous-setting', namespace: 'default', key: 'theme' }])
      .mockResolvedValueOnce([]);
    firstTx.userSetting.update.mockRejectedValue(createP2002Error());

    retryTx.userSetting.findMany
      .mockResolvedValueOnce([{ id: 'anonymous-setting', namespace: 'default', key: 'theme' }])
      .mockResolvedValueOnce([{ id: 'target-setting', namespace: 'default', key: 'theme' }]);
    retryTx.userSetting.delete.mockResolvedValue({});

    const result = await service.linkAnonymousUser({
      anonymousUserId: 'anonymous-user',
      targetUserId: 'target-user',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(firstTx.userSetting.update).toHaveBeenCalledWith({
      where: { id: 'anonymous-setting' },
      data: { userId: 'target-user' },
    });
    expect(retryTx.userSetting.delete).toHaveBeenCalledWith({
      where: { id: 'anonymous-setting' },
    });
    expect(retryTx.userSetting.update).not.toHaveBeenCalled();
    expect(result.migrated.userSettings).toBe(0);
  });

  it('rejects anonymous target user', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);

    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      });

    await expect(
      service.linkAnonymousUser({
        anonymousUserId: 'anonymous-user',
        targetUserId: 'target-user',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.clientIdentity.updateMany).not.toHaveBeenCalled();
  });

  it('rejects already merged anonymous user', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);

    tx.user.findUnique.mockResolvedValue({
      id: 'anonymous-user',
      status: 'MERGED',
      mergedIntoUserId: 'target-user',
    });

    await expect(service.linkAnonymousUser({ anonymousUserId: 'anonymous-user' })).rejects.toThrow(ConflictException);
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects providerSubject alias owned by another user', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);

    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'REGISTERED',
        mergedIntoUserId: null,
      });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    mockContinuityUpdates(tx);
    tx.userIdentityAlias.findMany.mockResolvedValue([]);
    tx.userIdentityAlias.findUnique.mockResolvedValue({
      id: 'alias-conflict',
      userId: 'other-user',
      aliasKind: 'AUTH_PROVIDER_SUBJECT',
      aliasValue: 'provider|subject',
    });

    await expect(
      service.linkAnonymousUser({
        anonymousUserId: 'anonymous-user',
        targetUserId: 'target-user',
        providerSubject: 'provider|subject',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.userIdentityAlias.create).not.toHaveBeenCalled();
  });

  it('accepts providerSubject alias already owned by target user', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);
    mockContinuityUpdates(tx);

    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'REGISTERED',
        mergedIntoUserId: null,
      });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.userIdentityAlias.findMany.mockResolvedValue([]);
    tx.userIdentityAlias.findUnique.mockResolvedValue({
      id: 'alias-existing',
      userId: 'target-user',
      aliasKind: 'AUTH_PROVIDER_SUBJECT',
      aliasValue: 'provider|subject',
    });

    const result = await service.linkAnonymousUser({
      anonymousUserId: 'anonymous-user',
      targetUserId: 'target-user',
      providerSubject: 'provider|subject',
    });

    expect(tx.userIdentityAlias.create).not.toHaveBeenCalled();
    expect(result.aliases.created).toEqual([
      { aliasKind: 'AUTH_PROVIDER_SUBJECT', aliasValue: 'provider|subject', action: 'existing' },
    ]);
  });

  it('handles duplicate existing anonymous alias by deleting it when target already owns same alias', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new UsersService(prisma as never);
    mockContinuityUpdates(tx);

    tx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'REGISTERED',
        mergedIntoUserId: null,
      });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.userIdentityAlias.findMany.mockResolvedValue([
      {
        id: 'anonymous-duplicate-alias',
        userId: 'anonymous-user',
        aliasKind: 'AUTH_PROVIDER_SUBJECT',
        aliasValue: 'provider|subject',
      },
    ]);
    tx.userIdentityAlias.findUnique.mockResolvedValue({
      id: 'target-alias',
      userId: 'target-user',
      aliasKind: 'AUTH_PROVIDER_SUBJECT',
      aliasValue: 'provider|subject',
    });

    const result = await service.linkAnonymousUser({
      anonymousUserId: 'anonymous-user',
      targetUserId: 'target-user',
    });

    expect(tx.userIdentityAlias.update).not.toHaveBeenCalled();
    expect(tx.userIdentityAlias.delete).toHaveBeenCalledWith({
      where: { id: 'anonymous-duplicate-alias' },
    });
    expect(result.aliases.deletedDuplicates).toBe(1);
    expect(result.aliases.moved).toBe(0);
  });

  it('retries P2002 alias creation in a fresh transaction before accepting same-target ownership', async () => {
    const firstTx = createTransactionMock();
    const retryTx = createTransactionMock();
    const { prisma } = createPrismaMock([firstTx, retryTx]);
    const service = new UsersService(prisma as never);
    mockContinuityUpdates(firstTx);
    mockContinuityUpdates(retryTx);

    firstTx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'REGISTERED',
        mergedIntoUserId: null,
      });
    firstTx.user.updateMany.mockResolvedValue({ count: 1 });
    firstTx.userIdentityAlias.findMany.mockResolvedValue([]);
    firstTx.userIdentityAlias.findUnique.mockResolvedValueOnce(null);
    firstTx.userIdentityAlias.create.mockRejectedValue(createP2002Error());

    retryTx.user.findUnique
      .mockResolvedValueOnce({
        id: 'anonymous-user',
        status: 'ANONYMOUS',
        mergedIntoUserId: null,
      })
      .mockResolvedValueOnce({
        id: 'target-user',
        status: 'REGISTERED',
        mergedIntoUserId: null,
      });
    retryTx.user.updateMany.mockResolvedValue({ count: 1 });
    retryTx.userIdentityAlias.findMany.mockResolvedValue([]);
    retryTx.userIdentityAlias.findUnique.mockResolvedValue({
      id: 'alias-created-concurrently',
      userId: 'target-user',
      aliasKind: 'AUTH_PROVIDER_SUBJECT',
      aliasValue: 'provider|subject',
    });

    const result = await service.linkAnonymousUser({
      anonymousUserId: 'anonymous-user',
      targetUserId: 'target-user',
      providerSubject: 'provider|subject',
    });

    expect(result.aliases.created).toEqual([
      { aliasKind: 'AUTH_PROVIDER_SUBJECT', aliasValue: 'provider|subject', action: 'existing' },
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(firstTx.userIdentityAlias.findUnique).toHaveBeenCalledTimes(1);
    expect(retryTx.userIdentityAlias.findUnique).toHaveBeenCalledTimes(1);
    expect(retryTx.userIdentityAlias.create).not.toHaveBeenCalled();
  });

  it('stops before migrations and alias changes when guarded merge loses the anonymous user', async () => {
    const txs = [createTransactionMock(), createTransactionMock(), createTransactionMock()];
    const { prisma } = createPrismaMock(txs);
    const service = new UsersService(prisma as never);

    for (const tx of txs) {
      tx.user.findUnique
        .mockResolvedValueOnce({
          id: 'anonymous-user',
          status: 'ANONYMOUS',
          mergedIntoUserId: null,
        })
        .mockResolvedValueOnce({
          id: 'target-user',
          status: 'REGISTERED',
          mergedIntoUserId: null,
        });
      tx.user.updateMany.mockResolvedValue({ count: 0 });
    }

    await expect(
      service.linkAnonymousUser({
        anonymousUserId: 'anonymous-user',
        targetUserId: 'target-user',
        providerSubject: 'provider|subject',
      }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    for (const tx of txs) {
      expect(tx.clientIdentity.updateMany).not.toHaveBeenCalled();
      expect(tx.anonymousSession.updateMany).not.toHaveBeenCalled();
      expect(tx.analyticsEvent.updateMany).not.toHaveBeenCalled();
      expect(tx.consentRecord.updateMany).not.toHaveBeenCalled();
      expect(tx.userSetting.updateMany).not.toHaveBeenCalled();
      expect(tx.userIdentityAlias.findMany).not.toHaveBeenCalled();
      expect(tx.userIdentityAlias.create).not.toHaveBeenCalled();
    }
  });
});
