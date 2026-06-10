import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';

type PrismaJsonInput = Prisma.InputJsonValue | Prisma.JsonNullValueInput;

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

const UpsertUserSettingSchema = z.object({
  userId: z.string().trim().min(1),
  namespace: z.string().trim().min(1).optional().default('default'),
  key: z.string().trim().min(1),
  value: JsonValueSchema,
  updatedByClientIdentityId: z.string().trim().min(1).optional(),
});

const ListUserSettingsSchema = z.object({
  userId: z.string().trim().min(1),
  namespace: z.string().trim().min(1).optional(),
});

export type UpsertUserSettingInput = z.input<typeof UpsertUserSettingSchema>;

const userSettingSelect = {
  id: true,
  userId: true,
  namespace: true,
  key: true,
  value: true,
  updatedByClientIdentityId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSettingSelect;

export type UserSettingResponse = Prisma.UserSettingGetPayload<{
  select: typeof userSettingSelect;
}>;

interface UserIdentity {
  id: string;
  status: 'ANONYMOUS' | 'REGISTERED' | 'MERGED' | 'DELETED';
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertUserSetting(input: UpsertUserSettingInput): Promise<UserSettingResponse> {
    const parsed = this.parseUpsertInput(input);
    await this.assertClientIdentityCanUpdateUser(parsed.userId, parsed.updatedByClientIdentityId);
    await this.assertWritableUserId(parsed.userId);

    return this.prisma.userSetting.upsert({
      where: {
        userId_namespace_key: {
          userId: parsed.userId,
          namespace: parsed.namespace,
          key: parsed.key,
        },
      },
      create: {
        userId: parsed.userId,
        namespace: parsed.namespace,
        key: parsed.key,
        value: this.toPrismaJsonInput(parsed.value),
        updatedByClientIdentityId: parsed.updatedByClientIdentityId,
      },
      update: {
        value: this.toPrismaJsonInput(parsed.value),
        updatedByClientIdentityId: parsed.updatedByClientIdentityId,
      },
      select: userSettingSelect,
    });
  }

  async listUserSettings(userId: string, namespace?: string): Promise<UserSettingResponse[]> {
    const parsed = this.parseListInput({ userId, namespace });
    await this.assertKnownUserId(parsed.userId);

    return this.prisma.userSetting.findMany({
      where: {
        userId: parsed.userId,
        namespace: parsed.namespace,
      },
      orderBy: [{ namespace: 'asc' }, { key: 'asc' }],
      select: userSettingSelect,
    });
  }

  private parseUpsertInput(input: UpsertUserSettingInput): z.output<typeof UpsertUserSettingSchema> {
    const result = UpsertUserSettingSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }

    return result.data;
  }

  private async assertClientIdentityCanUpdateUser(
    userId: string,
    updatedByClientIdentityId: string | undefined,
  ): Promise<void> {
    if (!updatedByClientIdentityId) {
      return;
    }

    const clientIdentity = await this.prisma.clientIdentity.findUnique({
      where: { id: updatedByClientIdentityId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!clientIdentity) {
      throw new BadRequestException('Unknown updatedByClientIdentityId');
    }

    if (clientIdentity.userId !== userId) {
      throw new BadRequestException('updatedByClientIdentityId does not belong to userId');
    }
  }

  private parseListInput(input: z.input<typeof ListUserSettingsSchema>): z.output<typeof ListUserSettingsSchema> {
    const result = ListUserSettingsSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }

    return result.data;
  }

  private async assertKnownUserId(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    }) as UserIdentity | null;

    if (!user) {
      throw new BadRequestException('Unknown userId');
    }
  }

  private async assertWritableUserId(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    }) as UserIdentity | null;

    if (!user) {
      throw new BadRequestException('Unknown userId');
    }

    if (user.status === 'MERGED' || user.status === 'DELETED') {
      throw new BadRequestException('userId cannot receive new writes');
    }
  }

  private toPrismaJsonInput(value: unknown): PrismaJsonInput {
    return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }
}
