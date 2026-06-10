import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';

const LinkAnonymousUserSchema = z.object({
  anonymousUserId: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1).optional(),
  providerSubject: z.string().trim().min(1).optional(),
  emailHash: z.string().trim().min(1).optional(),
});

export type LinkAnonymousUserInput = z.input<typeof LinkAnonymousUserSchema>;
type ParsedLinkAnonymousUserInput = z.output<typeof LinkAnonymousUserSchema>;

type UserStatusValue = 'ANONYMOUS' | 'REGISTERED' | 'MERGED' | 'DELETED';
type IdentityAliasKindValue =
  | 'ANONYMOUS_USER_ID'
  | 'CLIENT_INSTALLATION_ID'
  | 'ANALYTICS_SESSION_ID'
  | 'AUTH_PROVIDER_SUBJECT'
  | 'EMAIL_HASH';
type LinkedAliasKindValue = 'AUTH_PROVIDER_SUBJECT' | 'EMAIL_HASH';
type AliasAction = 'created' | 'existing';
const USER_LINK_MAX_ATTEMPTS = 3;

interface UserRecord {
  id: string;
  status: UserStatusValue;
  mergedIntoUserId: string | null;
}

interface UserIdentityAliasRecord {
  id: string;
  userId: string;
  aliasKind: IdentityAliasKindValue;
  aliasValue: string;
}

interface UserSettingKeyRecord {
  id: string;
  namespace: string;
  key: string;
}

interface IdRecord {
  id: string;
}

interface AnonymousSessionMigrationRecord {
  id: string;
  analyticsSessionId: string | null;
}

interface UpdateManyResult {
  count: number;
}

interface UsersTransaction {
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserRecord | null>;
    create(args: { data: { status: 'REGISTERED'; registeredAt: Date } }): Promise<UserRecord>;
    updateMany(args: {
      where: { id: string; status: 'ANONYMOUS'; mergedIntoUserId: null };
      data: { status: 'MERGED'; mergedIntoUserId: string };
    }): Promise<UpdateManyResult>;
  };
  clientIdentity: {
    findMany(args: { where: { userId: string }; select: { id: true } }): Promise<IdRecord[]>;
    updateMany(args: { where: { userId: string }; data: { userId: string } }): Promise<UpdateManyResult>;
  };
  anonymousSession: {
    findMany(args: {
      where: { userId: string };
      select: { id: true; analyticsSessionId: true };
    }): Promise<AnonymousSessionMigrationRecord[]>;
    updateMany(args: { where: { userId: string }; data: { userId: string } }): Promise<UpdateManyResult>;
  };
  analyticsEvent: {
    updateMany(args: { where: Prisma.AnalyticsEventWhereInput; data: { userId: string } }): Promise<UpdateManyResult>;
  };
  consentRecord: {
    updateMany(args: { where: Prisma.ConsentRecordWhereInput; data: { userId: string } }): Promise<UpdateManyResult>;
  };
  userSetting: {
    findMany(args: {
      where: { userId: string };
      select: { id: true; namespace: true; key: true };
    }): Promise<UserSettingKeyRecord[]>;
    update(args: { where: { id: string }; data: { userId: string } }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  userIdentityAlias: {
    findMany(args: { where: { userId: string } }): Promise<UserIdentityAliasRecord[]>;
    findUnique(args: {
      where: {
        aliasKind_aliasValue: {
          aliasKind: IdentityAliasKindValue;
          aliasValue: string;
        };
      };
    }): Promise<UserIdentityAliasRecord | null>;
    update(args: {
      where: { id: string };
      data: { userId: string; linkedFromUserId: string };
    }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
    create(args: {
      data: {
        userId: string;
        aliasKind: LinkedAliasKindValue;
        aliasValue: string;
        linkedFromUserId: string;
      };
    }): Promise<unknown>;
  };
}

export interface LinkAnonymousUserResponse {
  targetUserId: string;
  mergedUserId: string;
  migrated: {
    clientIdentities: number;
    anonymousSessions: number;
    analyticsEvents: number;
    consentRecords: number;
    userSettings: number;
  };
  aliases: {
    moved: number;
    deletedDuplicates: number;
    created: Array<{
      aliasKind: LinkedAliasKindValue;
      aliasValue: string;
      action: AliasAction;
    }>;
  };
}

class RetryUserLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryUserLinkError';
  }
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async linkAnonymousUser(input: LinkAnonymousUserInput): Promise<LinkAnonymousUserResponse> {
    const parsedInput = this.parseInput(input);
    const now = new Date();

    return this.retryUserLink(() =>
      this.prisma.$transaction(async (tx: UsersTransaction) => {
        return this.linkAnonymousUserInTransaction(tx, parsedInput, now);
      }),
    );
  }

  private async linkAnonymousUserInTransaction(
    tx: UsersTransaction,
    parsedInput: ParsedLinkAnonymousUserInput,
    now: Date,
  ): Promise<LinkAnonymousUserResponse> {
    const anonymousUser = await tx.user.findUnique({
      where: { id: parsedInput.anonymousUserId },
    });

    this.assertAnonymousUserCanBeLinked(anonymousUser, parsedInput.anonymousUserId);

    const targetUser = await this.resolveTargetUser(tx, parsedInput, now);

    await this.markAnonymousUserMerged(tx, anonymousUser.id, targetUser.id);

    const migrated = await this.migrateContinuityRecords(tx, anonymousUser.id, targetUser.id);
    const movedAliases = await this.moveExistingAliases(tx, anonymousUser.id, targetUser.id);
    const createdAliases = await this.addRequestedAliases(tx, parsedInput, targetUser.id, anonymousUser.id);

    return {
      targetUserId: targetUser.id,
      mergedUserId: anonymousUser.id,
      migrated,
      aliases: {
        ...movedAliases,
        created: createdAliases,
      },
    };
  }

  private async markAnonymousUserMerged(
    tx: UsersTransaction,
    anonymousUserId: string,
    targetUserId: string,
  ): Promise<void> {
    const merge = await tx.user.updateMany({
      where: { id: anonymousUserId, status: 'ANONYMOUS', mergedIntoUserId: null },
      data: {
        status: 'MERGED',
        mergedIntoUserId: targetUserId,
      },
    });

    if (merge.count === 0) {
      throw new RetryUserLinkError('Anonymous user was merged by another request');
    }
  }

  private parseInput(input: LinkAnonymousUserInput): ParsedLinkAnonymousUserInput {
    const result = LinkAnonymousUserSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid anonymous user link input',
        issues: result.error.issues,
      });
    }

    return result.data;
  }

  private assertAnonymousUserCanBeLinked(user: UserRecord | null, userId: string): asserts user is UserRecord {
    if (!user) {
      throw new NotFoundException({
        message: 'Anonymous user was not found',
        userId,
      });
    }

    if (user.status === 'MERGED' || user.status === 'DELETED') {
      throw new ConflictException({
        message: 'Anonymous user cannot be linked',
        userId: user.id,
        status: user.status,
      });
    }

    if (user.status !== 'ANONYMOUS') {
      throw new ConflictException({
        message: 'User is not anonymous',
        userId: user.id,
        status: user.status,
      });
    }
  }

  private async resolveTargetUser(
    tx: UsersTransaction,
    input: ParsedLinkAnonymousUserInput,
    now: Date,
  ): Promise<UserRecord> {
    if (!input.targetUserId) {
      return tx.user.create({
        data: {
          status: 'REGISTERED',
          registeredAt: now,
        },
      });
    }

    if (input.targetUserId === input.anonymousUserId) {
      throw new ConflictException({
        message: 'Anonymous user cannot be linked into itself',
        userId: input.anonymousUserId,
      });
    }

    const targetUser = await tx.user.findUnique({
      where: { id: input.targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException({
        message: 'Target user was not found',
        userId: input.targetUserId,
      });
    }

    if (targetUser.status !== 'REGISTERED' || targetUser.mergedIntoUserId) {
      throw new ConflictException({
        message: 'Target user cannot receive anonymous link',
        userId: targetUser.id,
        status: targetUser.status,
        mergedIntoUserId: targetUser.mergedIntoUserId,
      });
    }

    return targetUser;
  }

  private async migrateContinuityRecords(
    tx: UsersTransaction,
    anonymousUserId: string,
    targetUserId: string,
  ): Promise<LinkAnonymousUserResponse['migrated']> {
    const [sourceClientIdentities, sourceAnonymousSessions] = await Promise.all([
      tx.clientIdentity.findMany({
        where: { userId: anonymousUserId },
        select: { id: true },
      }),
      tx.anonymousSession.findMany({
        where: { userId: anonymousUserId },
        select: { id: true, analyticsSessionId: true },
      }),
    ]);
    const sourceClientIdentityIds = sourceClientIdentities.map((clientIdentity) => clientIdentity.id);
    const sourceAnonymousSessionIds = sourceAnonymousSessions.map((session) => session.id);
    const sourceAnalyticsSessionIds = sourceAnonymousSessions.flatMap((session) =>
      session.analyticsSessionId ? [session.analyticsSessionId] : [],
    );

    const clientIdentities = await tx.clientIdentity.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: targetUserId },
    });
    const anonymousSessions = await tx.anonymousSession.updateMany({
      where: { userId: anonymousUserId },
      data: { userId: targetUserId },
    });
    const analyticsEvents = await tx.analyticsEvent.updateMany({
      where: this.buildAnalyticsMigrationWhere(
        anonymousUserId,
        sourceClientIdentityIds,
        sourceAnonymousSessionIds,
        sourceAnalyticsSessionIds,
      ),
      data: { userId: targetUserId },
    });
    const consentRecords = await tx.consentRecord.updateMany({
      where: this.buildConsentMigrationWhere(anonymousUserId, sourceClientIdentityIds),
      data: { userId: targetUserId },
    });
    const userSettings = await this.reconcileUserSettings(tx, anonymousUserId, targetUserId);

    return {
      clientIdentities: clientIdentities.count,
      anonymousSessions: anonymousSessions.count,
      analyticsEvents: analyticsEvents.count,
      consentRecords: consentRecords.count,
      userSettings: userSettings.moved,
    };
  }

  private buildAnalyticsMigrationWhere(
    anonymousUserId: string,
    clientIdentityIds: string[],
    anonymousSessionIds: string[],
    analyticsSessionIds: string[],
  ): Prisma.AnalyticsEventWhereInput {
    const filters: Prisma.AnalyticsEventWhereInput[] = [{ userId: anonymousUserId }];

    if (clientIdentityIds.length > 0) {
      filters.push({ clientIdentityId: { in: clientIdentityIds } });
    }

    if (anonymousSessionIds.length > 0) {
      filters.push({ anonymousSessionId: { in: anonymousSessionIds } });
    }

    if (analyticsSessionIds.length > 0) {
      filters.push({ analyticsSessionId: { in: analyticsSessionIds } });
    }

    return this.buildGuardedMigrationWhere(anonymousUserId, filters);
  }

  private buildConsentMigrationWhere(
    anonymousUserId: string,
    clientIdentityIds: string[],
  ): Prisma.ConsentRecordWhereInput {
    const filters: Prisma.ConsentRecordWhereInput[] = [{ userId: anonymousUserId }];

    if (clientIdentityIds.length > 0) {
      filters.push({ clientIdentityId: { in: clientIdentityIds } });
    }

    return this.buildGuardedMigrationWhere(anonymousUserId, filters);
  }

  private buildGuardedMigrationWhere<T extends Prisma.AnalyticsEventWhereInput | Prisma.ConsentRecordWhereInput>(
    anonymousUserId: string,
    filters: T[],
  ): T {
    if (filters.length === 1) {
      return { userId: anonymousUserId } as T;
    }

    return {
      AND: [
        {
          OR: filters,
        },
        {
          OR: [{ userId: anonymousUserId }, { userId: null }],
        },
      ],
    } as T;
  }

  private async reconcileUserSettings(
    tx: UsersTransaction,
    anonymousUserId: string,
    targetUserId: string,
  ): Promise<{ moved: number; deletedDuplicates: number }> {
    const select = { id: true, namespace: true, key: true } as const;
    const [anonymousSettings, targetSettings] = await Promise.all([
      tx.userSetting.findMany({
        where: { userId: anonymousUserId },
        select,
      }),
      tx.userSetting.findMany({
        where: { userId: targetUserId },
        select,
      }),
    ]);
    const targetSettingKeys = new Set(targetSettings.map((setting) => this.serializeSettingKey(setting)));
    let moved = 0;
    let deletedDuplicates = 0;

    try {
      for (const setting of anonymousSettings) {
        if (targetSettingKeys.has(this.serializeSettingKey(setting))) {
          await tx.userSetting.delete({
            where: { id: setting.id },
          });
          deletedDuplicates += 1;
          continue;
        }

        await tx.userSetting.update({
          where: { id: setting.id },
          data: { userId: targetUserId },
        });
        moved += 1;
      }
    } catch (error) {
      if (this.isPrismaUniqueViolation(error)) {
        throw new RetryUserLinkError('User setting conflict occurred during anonymous link');
      }

      throw error;
    }

    return { moved, deletedDuplicates };
  }

  private serializeSettingKey(setting: Pick<UserSettingKeyRecord, 'namespace' | 'key'>): string {
    return JSON.stringify([setting.namespace, setting.key]);
  }

  private async moveExistingAliases(
    tx: UsersTransaction,
    anonymousUserId: string,
    targetUserId: string,
  ): Promise<Pick<LinkAnonymousUserResponse['aliases'], 'moved' | 'deletedDuplicates'>> {
    const aliases = await tx.userIdentityAlias.findMany({
      where: { userId: anonymousUserId },
    });
    let moved = 0;
    let deletedDuplicates = 0;

    for (const alias of aliases) {
      const existingAlias = await this.findAlias(tx, alias.aliasKind, alias.aliasValue);
      if (existingAlias && existingAlias.id !== alias.id) {
        this.assertAliasOwnedByUser(existingAlias, targetUserId, alias.aliasKind, alias.aliasValue);
        await tx.userIdentityAlias.delete({
          where: { id: alias.id },
        });
        deletedDuplicates += 1;
        continue;
      }

      await tx.userIdentityAlias.update({
        where: { id: alias.id },
        data: {
          userId: targetUserId,
          linkedFromUserId: anonymousUserId,
        },
      });
      moved += 1;
    }

    return { moved, deletedDuplicates };
  }

  private async addRequestedAliases(
    tx: UsersTransaction,
    input: ParsedLinkAnonymousUserInput,
    targetUserId: string,
    anonymousUserId: string,
  ): Promise<LinkAnonymousUserResponse['aliases']['created']> {
    const aliases: LinkAnonymousUserResponse['aliases']['created'] = [];

    if (input.providerSubject) {
      aliases.push(
        await this.addRequestedAlias(tx, targetUserId, anonymousUserId, 'AUTH_PROVIDER_SUBJECT', input.providerSubject),
      );
    }

    if (input.emailHash) {
      aliases.push(await this.addRequestedAlias(tx, targetUserId, anonymousUserId, 'EMAIL_HASH', input.emailHash));
    }

    return aliases;
  }

  private async addRequestedAlias(
    tx: UsersTransaction,
    targetUserId: string,
    anonymousUserId: string,
    aliasKind: LinkedAliasKindValue,
    aliasValue: string,
  ): Promise<LinkAnonymousUserResponse['aliases']['created'][number]> {
    const existingAlias = await this.findAlias(tx, aliasKind, aliasValue);
    if (existingAlias) {
      this.assertAliasOwnedByUser(existingAlias, targetUserId, aliasKind, aliasValue);
      return { aliasKind, aliasValue, action: 'existing' };
    }

    try {
      await tx.userIdentityAlias.create({
        data: {
          userId: targetUserId,
          aliasKind,
          aliasValue,
          linkedFromUserId: anonymousUserId,
        },
      });
    } catch (error) {
      if (!this.isPrismaUniqueViolation(error)) {
        throw error;
      }

      throw new RetryUserLinkError('Identity alias was created by another request');
    }

    return { aliasKind, aliasValue, action: 'created' };
  }

  private findAlias(
    tx: UsersTransaction,
    aliasKind: IdentityAliasKindValue,
    aliasValue: string,
  ): Promise<UserIdentityAliasRecord | null> {
    return tx.userIdentityAlias.findUnique({
      where: {
        aliasKind_aliasValue: {
          aliasKind,
          aliasValue,
        },
      },
    });
  }

  private assertAliasOwnedByUser(
    alias: UserIdentityAliasRecord,
    targetUserId: string,
    aliasKind: IdentityAliasKindValue,
    aliasValue: string,
  ): void {
    if (alias.userId === targetUserId) {
      return;
    }

    throw new ConflictException({
      message: 'Identity alias is already linked to another user',
      aliasKind,
      aliasValue,
    });
  }

  private async retryUserLink<T>(operation: () => Promise<T>): Promise<T> {
    let lastRetryError: RetryUserLinkError | undefined;

    for (let attempt = 1; attempt <= USER_LINK_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof RetryUserLinkError)) {
          throw error;
        }

        lastRetryError = error;
        if (attempt === USER_LINK_MAX_ATTEMPTS) {
          break;
        }
      }
    }

    throw new ConflictException({
      message: 'Anonymous user link could not be completed because another request changed the same records',
      reason: lastRetryError?.message,
    });
  }

  private isPrismaUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
