import { BadRequestException } from '@nestjs/common';

import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

function createPrismaMock() {
  return {
    clientIdentity: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'ANONYMOUS' }),
    },
    userSetting: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('SettingsService', () => {
  it('upserts a user setting using the default namespace and unique key', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    const setting = {
      id: 'setting-1',
      userId: 'user-1',
      namespace: 'default',
      key: 'theme',
      value: { mode: 'dark' },
      updatedByClientIdentityId: 'client-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    prisma.userSetting.upsert.mockResolvedValue(setting);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'user-1',
    });

    const result = await service.upsertUserSetting({
      userId: 'user-1',
      key: 'theme',
      value: { mode: 'dark' },
      updatedByClientIdentityId: 'client-1',
    });

    expect(prisma.userSetting.upsert).toHaveBeenCalledWith({
      where: {
        userId_namespace_key: {
          userId: 'user-1',
          namespace: 'default',
          key: 'theme',
        },
      },
      create: {
        userId: 'user-1',
        namespace: 'default',
        key: 'theme',
        value: { mode: 'dark' },
        updatedByClientIdentityId: 'client-1',
      },
      update: {
        value: { mode: 'dark' },
        updatedByClientIdentityId: 'client-1',
      },
      select: {
        id: true,
        userId: true,
        namespace: true,
        key: true,
        value: true,
        updatedByClientIdentityId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result).toEqual(setting);
  });

  it('rejects settings updates from a client identity owned by another user', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-1',
      userId: 'other-user',
    });

    await expect(
      service.upsertUserSetting({
        userId: 'user-1',
        key: 'theme',
        value: { mode: 'dark' },
        updatedByClientIdentityId: 'client-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects settings updates for an unknown direct userId before persistence', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.upsertUserSetting({
        userId: 'missing-user',
        key: 'theme',
        value: { mode: 'dark' },
      }),
    ).rejects.toThrow('Unknown userId');
    expect(prisma.userSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects settings updates for a merged direct userId before persistence', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    prisma.user.findUnique.mockResolvedValue({ id: 'merged-user', status: 'MERGED' });

    await expect(
      service.upsertUserSetting({
        userId: 'merged-user',
        key: 'theme',
        value: { mode: 'dark' },
      }),
    ).rejects.toThrow('userId cannot receive new writes');
    expect(prisma.userSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects settings updates for a merged userId even with matching client attribution', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    prisma.clientIdentity.findUnique.mockResolvedValue({
      id: 'client-merged',
      userId: 'merged-user',
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'merged-user', status: 'MERGED' });

    await expect(
      service.upsertUserSetting({
        userId: 'merged-user',
        key: 'theme',
        value: { mode: 'dark' },
        updatedByClientIdentityId: 'client-merged',
      }),
    ).rejects.toThrow('userId cannot receive new writes');
    expect(prisma.userSetting.upsert).not.toHaveBeenCalled();
  });

  it('lists user settings ordered by namespace and key with an optional namespace filter', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    const settings = [
      {
        id: 'setting-1',
        userId: 'user-1',
        namespace: 'editor',
        key: 'theme',
        value: 'dark',
        updatedByClientIdentityId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ];
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.userSetting.findMany.mockResolvedValue(settings);

    const result = await service.listUserSettings('user-1', 'editor');

    expect(prisma.userSetting.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        namespace: 'editor',
      },
      orderBy: [{ namespace: 'asc' }, { key: 'asc' }],
      select: {
        id: true,
        userId: true,
        namespace: true,
        key: true,
        value: true,
        updatedByClientIdentityId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result).toEqual(settings);
  });

  it('rejects listing settings for an unknown userId', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.listUserSettings('missing-user')).rejects.toThrow('Unknown userId');
    expect(prisma.userSetting.findMany).not.toHaveBeenCalled();
  });

  it('rejects empty required identifiers', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);

    await expect(
      service.upsertUserSetting({
        userId: ' ',
        namespace: 'default',
        key: 'theme',
        value: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userSetting.upsert).not.toHaveBeenCalled();
  });

  it('passes an empty body through service validation instead of dereferencing null', async () => {
    const prisma = createPrismaMock();
    const service = new SettingsService(prisma as never);
    const controller = new SettingsController(service);

    await expect(
      controller.upsertUserSetting('user-1', 'default', 'theme', null as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userSetting.upsert).not.toHaveBeenCalled();
  });
});
