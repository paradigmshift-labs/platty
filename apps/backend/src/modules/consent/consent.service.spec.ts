import { BadRequestException } from '@nestjs/common';

import { ConsentService } from './consent.service';

function createPrismaMock() {
  return {
    clientIdentity: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'ANONYMOUS' }),
    },
    consentRecord: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

describe('ConsentService', () => {
  it('records consent with the provided identity and metadata', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    const record = {
      id: 'consent-1',
      userId: 'user-1',
      clientIdentityId: 'client-1',
      consentType: 'ANALYTICS',
      granted: true,
      policyVersion: '2026-01',
      source: 'settings',
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      metadata: { locale: 'en-US' },
    };
    prisma.consentRecord.create.mockResolvedValue(record);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'user-1',
    });

    const result = await service.recordConsent({
      userId: 'user-1',
      clientIdentityId: 'client-1',
      consentType: 'ANALYTICS',
      granted: true,
      policyVersion: '2026-01',
      source: 'settings',
      metadata: { locale: 'en-US' },
    });

    expect(prisma.consentRecord.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        clientIdentityId: 'client-1',
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
        source: 'settings',
        metadata: { locale: 'en-US' },
      },
      select: {
        id: true,
        userId: true,
        clientIdentityId: true,
        consentType: true,
        granted: true,
        policyVersion: true,
        source: true,
        recordedAt: true,
        metadata: true,
      },
    });
    expect(result).toEqual(record);
  });

  it('canonicalizes consent recording through client identity ownership', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    const record = {
      id: 'consent-canonical',
      userId: 'canonical-user',
      clientIdentityId: 'client-1',
      consentType: 'ANALYTICS',
      granted: false,
      policyVersion: '2026-01',
      source: null,
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      metadata: null,
    };
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'canonical-user',
    });
    prisma.consentRecord.create.mockResolvedValue(record);

    const result = await service.recordConsent({
      clientIdentityId: 'client-1',
      consentType: 'ANALYTICS',
      granted: false,
      policyVersion: '2026-01',
    });

    expect(prisma.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'canonical-user',
        clientIdentityId: 'client-1',
      }),
      select: expect.any(Object),
    });
    expect(result).toEqual(record);
  });

  it('rejects mismatched user and client identity while recording consent', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'canonical-user',
    });

    await expect(
      service.recordConsent({
        userId: 'spoofed-user',
        clientIdentityId: 'client-1',
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.consentRecord.create).not.toHaveBeenCalled();
  });

  it('rejects explicit user consent for an orphan client identity', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-orphan',
      userId: null,
    });

    await expect(
      service.recordConsent({
        userId: 'spoofed-user',
        clientIdentityId: 'client-orphan',
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.consentRecord.create).not.toHaveBeenCalled();
  });

  it('rejects recording consent for an unknown direct userId before persistence', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.recordConsent({
        userId: 'missing-user',
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
      }),
    ).rejects.toThrow('Unknown userId');
    expect(prisma.consentRecord.create).not.toHaveBeenCalled();
  });

  it('rejects recording consent for a merged direct userId before persistence', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    prisma.user.findUnique.mockResolvedValue({ id: 'merged-user', status: 'MERGED' });

    await expect(
      service.recordConsent({
        userId: 'merged-user',
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
      }),
    ).rejects.toThrow('userId cannot receive new writes');
    expect(prisma.consentRecord.create).not.toHaveBeenCalled();
  });

  it('rejects recording consent for a merged userId even with matching client attribution', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-merged',
      userId: 'merged-user',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'merged-user', status: 'MERGED' });

    await expect(
      service.recordConsent({
        userId: 'merged-user',
        clientIdentityId: 'client-merged',
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
      }),
    ).rejects.toThrow('userId cannot receive new writes');
    expect(prisma.consentRecord.create).not.toHaveBeenCalled();
  });

  it('queries the latest consent by identity and type with deterministic ordering', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    const record = {
      id: 'consent-2',
      userId: null,
      clientIdentityId: 'client-1',
      consentType: 'ERROR_REPORTING',
      granted: false,
      policyVersion: '2026-01',
      source: null,
      recordedAt: new Date('2026-01-02T00:00:00.000Z'),
      metadata: null,
    };
    prisma.consentRecord.findFirst.mockResolvedValue(record);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: null,
    });

    const result = await service.getLatestConsent({
      clientIdentityId: 'client-1',
      consentType: 'ERROR_REPORTING',
    });

    expect(prisma.consentRecord.findFirst).toHaveBeenCalledWith({
      where: {
        clientIdentityId: 'client-1',
        consentType: 'ERROR_REPORTING',
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        clientIdentityId: true,
        consentType: true,
        granted: true,
        policyVersion: true,
        source: true,
        recordedAt: true,
        metadata: true,
      },
    });
    expect(result).toEqual(record);
  });

  it('queries latest consent with OR semantics when both identities are provided', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    const record = {
      id: 'consent-3',
      userId: 'user-1',
      clientIdentityId: null,
      consentType: 'ANALYTICS',
      granted: true,
      policyVersion: '2026-01',
      source: 'settings',
      recordedAt: new Date('2026-01-03T00:00:00.000Z'),
      metadata: null,
    };
    prisma.consentRecord.findFirst.mockResolvedValue(record);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'user-1',
    });

    const result = await service.getLatestConsent({
      userId: 'user-1',
      clientIdentityId: 'client-1',
      consentType: 'ANALYTICS',
    });

    expect(prisma.consentRecord.findFirst).toHaveBeenCalledWith({
      where: {
        consentType: 'ANALYTICS',
        OR: [{ userId: 'user-1' }, { clientIdentityId: 'client-1' }],
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        clientIdentityId: true,
        consentType: true,
        granted: true,
        policyVersion: true,
        source: true,
        recordedAt: true,
        metadata: true,
      },
    });
    expect(result).toEqual(record);
  });

  it('rejects mismatched user and client identity while querying latest consent', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'canonical-user',
    });

    await expect(
      service.getLatestConsent({
        userId: 'spoofed-user',
        clientIdentityId: 'client-1',
        consentType: 'ANALYTICS',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.consentRecord.findFirst).not.toHaveBeenCalled();
  });

  it('rejects recording consent without any identity', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);

    await expect(
      service.recordConsent({
        consentType: 'ANALYTICS',
        granted: true,
        policyVersion: '2026-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.consentRecord.create).not.toHaveBeenCalled();
  });

  it('rejects latest consent queries without any identity', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);

    await expect(
      service.getLatestConsent({
        consentType: 'PRODUCT_UPDATES',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.consentRecord.findFirst).not.toHaveBeenCalled();
  });

  it('rejects latest consent queries for an unknown direct userId', async () => {
    const prisma = createPrismaMock();
    const service = new ConsentService(prisma as never);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.getLatestConsent({
        userId: 'missing-user',
        consentType: 'ANALYTICS',
      }),
    ).rejects.toThrow('Unknown userId');
    expect(prisma.consentRecord.findFirst).not.toHaveBeenCalled();
  });
});
