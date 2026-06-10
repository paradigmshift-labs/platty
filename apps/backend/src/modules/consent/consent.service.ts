import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsentType, Prisma } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';

const ConsentTypeSchema = z.nativeEnum(ConsentType);

type PrismaJsonInput = Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;

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

const IdentityFields = {
  userId: z.string().trim().min(1).optional(),
  clientIdentityId: z.string().trim().min(1).optional(),
};

const RecordConsentSchema = z
  .object({
    ...IdentityFields,
    consentType: ConsentTypeSchema,
    granted: z.boolean(),
    policyVersion: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
    metadata: JsonValueSchema.optional(),
  })
  .refine((input) => input.userId || input.clientIdentityId, {
    message: 'At least one of userId or clientIdentityId is required',
    path: ['userId'],
  });

const LatestConsentSchema = z
  .object({
    ...IdentityFields,
    consentType: ConsentTypeSchema,
  })
  .refine((input) => input.userId || input.clientIdentityId, {
    message: 'At least one of userId or clientIdentityId is required',
    path: ['userId'],
  });

export type RecordConsentInput = z.input<typeof RecordConsentSchema>;
export type LatestConsentInput = z.input<typeof LatestConsentSchema>;

const consentRecordSelect = {
  id: true,
  userId: true,
  clientIdentityId: true,
  consentType: true,
  granted: true,
  policyVersion: true,
  source: true,
  recordedAt: true,
  metadata: true,
} satisfies Prisma.ConsentRecordSelect;

export type ConsentRecordResponse = Prisma.ConsentRecordGetPayload<{
  select: typeof consentRecordSelect;
}>;

interface ResolvedConsentIdentity {
  userId?: string;
  clientIdentityId?: string;
}

interface UserIdentity {
  id: string;
  status: 'ANONYMOUS' | 'REGISTERED' | 'MERGED' | 'DELETED';
}

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async recordConsent(input: RecordConsentInput): Promise<ConsentRecordResponse> {
    const parsed = this.parseRecordInput(input);
    const identity = await this.resolveConsentIdentity(parsed, { requireWritableUser: true });

    return this.prisma.consentRecord.create({
      data: {
        userId: identity.userId,
        clientIdentityId: identity.clientIdentityId,
        consentType: parsed.consentType,
        granted: parsed.granted,
        policyVersion: parsed.policyVersion,
        source: parsed.source,
        metadata: parsed.metadata === undefined ? undefined : this.toPrismaJsonInput(parsed.metadata),
      },
      select: consentRecordSelect,
    });
  }

  async getLatestConsent(input: LatestConsentInput): Promise<ConsentRecordResponse | null> {
    const parsed = this.parseLatestInput(input);
    const identity = await this.resolveConsentIdentity(parsed);

    return this.prisma.consentRecord.findFirst({
      where: this.buildLatestConsentWhere({ ...identity, consentType: parsed.consentType }),
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      select: consentRecordSelect,
    });
  }

  private parseRecordInput(input: RecordConsentInput): z.output<typeof RecordConsentSchema> {
    const result = RecordConsentSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }

    return result.data;
  }

  private parseLatestInput(input: LatestConsentInput): z.output<typeof LatestConsentSchema> {
    const result = LatestConsentSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }

    return result.data;
  }

  private async resolveConsentIdentity(
    input: z.output<typeof RecordConsentSchema | typeof LatestConsentSchema>,
    options: { requireWritableUser?: boolean } = {},
  ): Promise<ResolvedConsentIdentity> {
    let userId = input.userId;
    let clientIdentityId = input.clientIdentityId;

    if (!clientIdentityId) {
      if (userId) {
        await this.assertKnownUserId(userId, options);
      }

      return { userId };
    }

    const clientIdentity = await this.prisma.clientIdentity.findUnique({
      where: { id: clientIdentityId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!clientIdentity) {
      throw new BadRequestException('Unknown clientIdentityId');
    }

    if (userId && !clientIdentity.userId) {
      throw new BadRequestException('clientIdentityId has no canonical userId');
    }

    if (userId && clientIdentity.userId && userId !== clientIdentity.userId) {
      throw new BadRequestException('clientIdentityId does not belong to userId');
    }

    userId = userId ?? clientIdentity.userId ?? undefined;
    clientIdentityId = clientIdentity.id;

    if (userId) {
      await this.assertKnownUserId(userId, options);
    }

    return { userId, clientIdentityId };
  }

  private async assertKnownUserId(
    userId: string,
    options: { requireWritableUser?: boolean } = {},
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    }) as UserIdentity | null;

    if (!user) {
      throw new BadRequestException('Unknown userId');
    }

    if (options.requireWritableUser && (user.status === 'MERGED' || user.status === 'DELETED')) {
      throw new BadRequestException('userId cannot receive new writes');
    }
  }

  private buildLatestConsentWhere(input: z.output<typeof LatestConsentSchema>): Prisma.ConsentRecordWhereInput {
    const identityFilters: Prisma.ConsentRecordWhereInput[] = [];
    if (input.userId) {
      identityFilters.push({ userId: input.userId });
    }
    if (input.clientIdentityId) {
      identityFilters.push({ clientIdentityId: input.clientIdentityId });
    }

    if (identityFilters.length === 1) {
      return {
        ...identityFilters[0],
        consentType: input.consentType,
      };
    }

    return {
      consentType: input.consentType,
      OR: identityFilters,
    };
  }

  private toPrismaJsonInput(value: unknown): PrismaJsonInput {
    return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }
}
