import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';

const CLIENT_KINDS = ['CLI', 'DASHBOARD', 'DESKTOP', 'FLUTTER', 'API', 'UNKNOWN'] as const;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IDENTITY_ACQUISITION_MAX_ATTEMPTS = 3;

const StartAnonymousSessionSchema = z.object({
  clientKind: z.enum(CLIENT_KINDS).optional().default('UNKNOWN'),
  installationId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).optional(),
  appVersion: z.string().trim().min(1).optional(),
  analyticsSessionId: z.string().trim().min(1).optional(),
});

export type StartAnonymousSessionInput = z.input<typeof StartAnonymousSessionSchema>;
type ParsedStartAnonymousSessionInput = z.output<typeof StartAnonymousSessionSchema>;

export interface AnonymousSessionResponse {
  userId: string;
  clientIdentityId: string;
  anonymousSessionId: string;
  sessionToken: string;
  refreshToken: string;
  expiresAt: Date;
}

type ClientKind = (typeof CLIENT_KINDS)[number];
type IdentityAliasKind = 'CLIENT_INSTALLATION_ID' | 'ANALYTICS_SESSION_ID';

interface ClientIdentityRecord {
  id: string;
  userId: string | null;
  installationId: string;
}

interface UserRecord {
  id: string;
}

interface AnonymousSessionRecord {
  id: string;
  expiresAt: Date;
}

interface UserIdentityAliasRecord {
  userId: string;
}

interface AuthTransaction {
  clientIdentity: {
    findUnique(args: { where: { installationId: string } }): Promise<ClientIdentityRecord | null>;
    create(args: {
      data: {
        userId: string;
        clientKind: ClientKind;
        installationId: string;
        displayName?: string;
        appVersion?: string;
        lastSeenAt: Date;
      };
    }): Promise<ClientIdentityRecord>;
    update(args: {
      where: { id: string };
      data: {
        clientKind: ClientKind;
        displayName?: string;
        appVersion?: string;
        lastSeenAt: Date;
      };
    }): Promise<ClientIdentityRecord>;
    updateMany(args: {
      where: { id: string; userId: null };
      data: {
        userId: string;
        clientKind: ClientKind;
        displayName?: string;
        appVersion?: string;
        lastSeenAt: Date;
      };
    }): Promise<{ count: number }>;
  };
  user: {
    create(args: { data: { status: 'ANONYMOUS' } }): Promise<UserRecord>;
  };
  anonymousSession: {
    create(args: {
      data: {
        userId: string;
        clientIdentityId: string;
        sessionTokenHash: string;
        refreshTokenHash: string;
        analyticsSessionId?: string;
        startedAt: Date;
        lastSeenAt: Date;
        expiresAt: Date;
      };
    }): Promise<AnonymousSessionRecord>;
  };
  userIdentityAlias: {
    findUnique(args: {
      where: {
        aliasKind_aliasValue: {
          aliasKind: IdentityAliasKind;
          aliasValue: string;
        };
      };
    }): Promise<UserIdentityAliasRecord | null>;
    create(args: {
      data: {
        userId: string;
        aliasKind: IdentityAliasKind;
        aliasValue: string;
      };
    }): Promise<unknown>;
  };
}

class RetryIdentityAcquisitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryIdentityAcquisitionError';
  }
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async startAnonymousSession(input: StartAnonymousSessionInput): Promise<AnonymousSessionResponse> {
    const parsedInput = this.parseInput(input);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_TTL_MS);
    const sessionToken = this.generateToken();
    const refreshToken = this.generateToken();
    const sessionTokenHash = this.hashToken(sessionToken);
    const refreshTokenHash = this.hashToken(refreshToken);

    return this.retryIdentityAcquisition(() =>
      this.prisma.$transaction(async (tx: AuthTransaction) => {
        return this.startAnonymousSessionInTransaction(tx, {
          parsedInput,
          now,
          expiresAt,
          sessionToken,
          refreshToken,
          sessionTokenHash,
          refreshTokenHash,
        });
      }),
    );
  }

  private async startAnonymousSessionInTransaction(
    tx: AuthTransaction,
    context: {
      parsedInput: ParsedStartAnonymousSessionInput;
      now: Date;
      expiresAt: Date;
      sessionToken: string;
      refreshToken: string;
      sessionTokenHash: string;
      refreshTokenHash: string;
    },
  ): Promise<AnonymousSessionResponse> {
    const { parsedInput, now, expiresAt, sessionToken, refreshToken, sessionTokenHash, refreshTokenHash } = context;

    const existingClient = await tx.clientIdentity.findUnique({
      where: { installationId: parsedInput.installationId },
    });

    let userId = existingClient?.userId ?? null;
    let clientIdentity: ClientIdentityRecord;

    if (existingClient && userId) {
      clientIdentity = await tx.clientIdentity.update({
        where: { id: existingClient.id },
        data: {
          clientKind: parsedInput.clientKind,
          displayName: parsedInput.displayName,
          appVersion: parsedInput.appVersion,
          lastSeenAt: now,
        },
      });
    } else {
      const user = await tx.user.create({ data: { status: 'ANONYMOUS' } });
      userId = user.id;

      if (existingClient) {
        const claim = await tx.clientIdentity.updateMany({
          where: {
            id: existingClient.id,
            userId: null,
          },
          data: {
            userId,
            clientKind: parsedInput.clientKind,
            displayName: parsedInput.displayName,
            appVersion: parsedInput.appVersion,
            lastSeenAt: now,
          },
        });

        if (claim.count === 0) {
          throw new RetryIdentityAcquisitionError('Client identity was claimed by another request');
        }

        clientIdentity = { ...existingClient, userId };
      } else {
        try {
          clientIdentity = await tx.clientIdentity.create({
            data: {
              userId,
              clientKind: parsedInput.clientKind,
              installationId: parsedInput.installationId,
              displayName: parsedInput.displayName,
              appVersion: parsedInput.appVersion,
              lastSeenAt: now,
            },
          });
        } catch (error) {
          if (this.isPrismaUniqueViolation(error)) {
            throw new RetryIdentityAcquisitionError('Client identity was created by another request');
          }

          throw error;
        }
      }
    }

    await this.createAlias(tx, userId, 'CLIENT_INSTALLATION_ID', parsedInput.installationId);
    if (parsedInput.analyticsSessionId) {
      await this.createAlias(tx, userId, 'ANALYTICS_SESSION_ID', parsedInput.analyticsSessionId);
    }

    const session = await this.createAnonymousSession(tx, {
      userId,
      clientIdentityId: clientIdentity.id,
      sessionTokenHash,
      refreshTokenHash,
      analyticsSessionId: parsedInput.analyticsSessionId,
      now,
      expiresAt,
    });

    return {
      userId,
      clientIdentityId: clientIdentity.id,
      anonymousSessionId: session.id,
      sessionToken,
      refreshToken,
      expiresAt: session.expiresAt,
    };
  }

  private parseInput(input: StartAnonymousSessionInput) {
    const parsed = StartAnonymousSessionSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid anonymous auth input',
        issues: parsed.error.issues,
      });
    }

    return parsed.data;
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async createAnonymousSession(
    tx: AuthTransaction,
    input: {
      userId: string;
      clientIdentityId: string;
      sessionTokenHash: string;
      refreshTokenHash: string;
      analyticsSessionId?: string;
      now: Date;
      expiresAt: Date;
    },
  ): Promise<AnonymousSessionRecord> {
    try {
      return await tx.anonymousSession.create({
        data: {
          userId: input.userId,
          clientIdentityId: input.clientIdentityId,
          sessionTokenHash: input.sessionTokenHash,
          refreshTokenHash: input.refreshTokenHash,
          analyticsSessionId: input.analyticsSessionId,
          startedAt: input.now,
          lastSeenAt: input.now,
          expiresAt: input.expiresAt,
        },
      });
    } catch (error) {
      if (!this.isPrismaUniqueViolation(error)) {
        throw error;
      }

      throw new ConflictException({
        message: 'Anonymous session identity is already in use',
      });
    }
  }

  private async createAlias(
    tx: AuthTransaction,
    userId: string,
    aliasKind: IdentityAliasKind,
    aliasValue: string,
  ): Promise<void> {
    const existingAlias = await this.findAlias(tx, aliasKind, aliasValue);
    if (existingAlias) {
      this.assertAliasOwnedByUser(existingAlias, userId, aliasKind, aliasValue);
      return;
    }

    try {
      await tx.userIdentityAlias.create({
        data: {
          userId,
          aliasKind,
          aliasValue,
        },
      });
    } catch (error) {
      if (!this.isPrismaUniqueViolation(error)) {
        throw error;
      }

      throw new RetryIdentityAcquisitionError('Identity alias was created by another request');
    }
  }

  private async findAlias(
    tx: AuthTransaction,
    aliasKind: IdentityAliasKind,
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
    userId: string,
    aliasKind: IdentityAliasKind,
    aliasValue: string,
  ): void {
    if (alias.userId === userId) {
      return;
    }

    throw new ConflictException({
      message: 'Identity alias is already linked to another user',
      aliasKind,
      aliasValue,
    });
  }

  private async retryIdentityAcquisition<T>(operation: () => Promise<T>): Promise<T> {
    let lastRetryError: unknown;

    for (let attempt = 1; attempt <= IDENTITY_ACQUISITION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof RetryIdentityAcquisitionError)) {
          throw error;
        }

        if (attempt === IDENTITY_ACQUISITION_MAX_ATTEMPTS) {
          throw new ConflictException({
            message: 'Anonymous identity could not be acquired after retries',
          });
        }

        lastRetryError = error;
      }
    }

    throw lastRetryError;
  }

  private isPrismaUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
