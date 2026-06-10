import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConsentType, Prisma } from '@prisma/client';
import { z } from 'zod';

import { ConsentService } from '../consent/consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { isPlattyEventName, validateAnalyticsProperties } from './event-catalog';

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

const JsonObjectSchema = z.record(JsonValueSchema);

const NonEmptyStringSchema = z.string().trim().min(1);

const OccurredAtSchema = NonEmptyStringSchema.pipe(
  z.string().datetime({
    offset: true,
    message: 'occurredAt must be a valid RFC3339 datetime with timezone offset',
  }),
).transform((value) => new Date(value));

const IngestAnalyticsEventSchema = z.object({
  eventId: NonEmptyStringSchema,
  eventName: NonEmptyStringSchema.refine(isPlattyEventName, {
    message: 'Unknown analytics eventName',
  }),
  occurredAt: OccurredAtSchema,
  userId: NonEmptyStringSchema.optional(),
  clientIdentityId: NonEmptyStringSchema.optional(),
  anonymousSessionId: NonEmptyStringSchema.optional(),
  analyticsSessionId: NonEmptyStringSchema.optional(),
  properties: JsonObjectSchema.optional(),
  context: JsonObjectSchema.optional(),
});

export type IngestAnalyticsEventInput = z.input<typeof IngestAnalyticsEventSchema>;

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
} satisfies Prisma.AnalyticsEventSelect;

export type AnalyticsEventResponse = Prisma.AnalyticsEventGetPayload<{
  select: typeof analyticsEventSelect;
}>;

interface AnonymousSessionAttribution {
  id: string;
  userId: string;
  clientIdentityId: string | null;
  analyticsSessionId: string | null;
}

interface ClientIdentityAttribution {
  id: string;
  userId: string | null;
}

interface UserAttribution {
  id: string;
  status: 'ANONYMOUS' | 'REGISTERED' | 'MERGED' | 'DELETED';
}

interface ResolvedAnalyticsAttribution {
  userId?: string;
  clientIdentityId?: string;
  anonymousSessionId?: string;
  analyticsSessionId?: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consentService: ConsentService,
  ) {}

  async ingestEvent(input: IngestAnalyticsEventInput): Promise<AnalyticsEventResponse> {
    const parsed = this.parseInput(input);
    this.validateProperties(parsed.properties);
    this.validateProperties(parsed.context);
    const attribution = await this.resolveAttribution(parsed);
    this.assertAnalyticsAttributionPresent(attribution);

    if (attribution.userId || attribution.clientIdentityId) {
      const latestConsent = await this.consentService.getLatestConsent({
        userId: attribution.userId,
        clientIdentityId: attribution.clientIdentityId,
        consentType: ConsentType.ANALYTICS,
      });

      if (latestConsent?.granted === false) {
        throw new ForbiddenException('Analytics consent has been denied');
      }
    }

    try {
      return await this.prisma.analyticsEvent.create({
        data: {
          eventId: parsed.eventId,
          eventName: parsed.eventName,
          occurredAt: parsed.occurredAt,
          userId: attribution.userId,
          clientIdentityId: attribution.clientIdentityId,
          anonymousSessionId: attribution.anonymousSessionId,
          analyticsSessionId: attribution.analyticsSessionId,
          properties:
            parsed.properties === undefined ? undefined : this.toPrismaJsonInput(parsed.properties),
          context: parsed.context === undefined ? undefined : this.toPrismaJsonInput(parsed.context),
        },
        select: analyticsEventSelect,
      });
    } catch (error) {
      if (this.isDuplicateEventIdError(error)) {
        const existingEvent = await this.prisma.analyticsEvent.findUnique({
          where: { eventId: parsed.eventId },
          select: analyticsEventSelect,
        });

        if (existingEvent) {
          return existingEvent;
        }
      }

      throw error;
    }
  }

  private parseInput(input: IngestAnalyticsEventInput): z.output<typeof IngestAnalyticsEventSchema> {
    const result = IngestAnalyticsEventSchema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }

    return result.data;
  }

  private async resolveAttribution(
    parsed: z.output<typeof IngestAnalyticsEventSchema>,
  ): Promise<ResolvedAnalyticsAttribution> {
    let userId = parsed.userId;
    let clientIdentityId = parsed.clientIdentityId;
    let analyticsSessionId = parsed.analyticsSessionId;
    let clientIdentityResolvedFromSession = false;
    let anonymousSessionId = parsed.anonymousSessionId;

    if (anonymousSessionId) {
      const session = await this.prisma.anonymousSession.findUnique({
        where: { id: anonymousSessionId },
        select: {
          id: true,
          userId: true,
          clientIdentityId: true,
          analyticsSessionId: true,
        },
      });

      if (!session) {
        throw new BadRequestException('Unknown anonymousSessionId');
      }

      this.assertSessionAttributionMatchesInput(session, parsed);
      userId = session.userId;
      clientIdentityId = session.clientIdentityId ?? clientIdentityId;
      analyticsSessionId = session.analyticsSessionId ?? analyticsSessionId;
      clientIdentityResolvedFromSession = session.clientIdentityId !== null;
    }

    if (!anonymousSessionId && analyticsSessionId) {
      const session = await this.prisma.anonymousSession.findUnique({
        where: { analyticsSessionId },
        select: {
          id: true,
          userId: true,
          clientIdentityId: true,
          analyticsSessionId: true,
        },
      });

      if (!session) {
        throw new BadRequestException('Unknown analyticsSessionId');
      }

      this.assertSessionAttributionMatchesInput(session, parsed);
      anonymousSessionId = session.id;
      userId = session.userId;
      clientIdentityId = session.clientIdentityId ?? clientIdentityId;
      analyticsSessionId = session.analyticsSessionId ?? analyticsSessionId;
      clientIdentityResolvedFromSession = session.clientIdentityId !== null;
    }

    if (clientIdentityId && !clientIdentityResolvedFromSession) {
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
    }

    if (userId) {
      await this.assertWritableUserId(userId);
    }

    return {
      userId,
      clientIdentityId,
      anonymousSessionId,
      analyticsSessionId,
    };
  }

  private assertAnalyticsAttributionPresent(attribution: ResolvedAnalyticsAttribution): void {
    if (
      attribution.userId ||
      attribution.clientIdentityId ||
      attribution.anonymousSessionId ||
      attribution.analyticsSessionId
    ) {
      return;
    }

    throw new BadRequestException('Analytics attribution is required');
  }

  private async assertWritableUserId(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    }) as UserAttribution | null;

    if (!user) {
      throw new BadRequestException('Unknown userId');
    }

    if (user.status === 'MERGED' || user.status === 'DELETED') {
      throw new BadRequestException('userId cannot receive new writes');
    }
  }

  private assertSessionAttributionMatchesInput(
    session: AnonymousSessionAttribution,
    parsed: z.output<typeof IngestAnalyticsEventSchema>,
  ): void {
    if (parsed.userId && parsed.userId !== session.userId) {
      throw new BadRequestException('anonymousSessionId does not belong to userId');
    }

    if (parsed.clientIdentityId && parsed.clientIdentityId !== session.clientIdentityId) {
      throw new BadRequestException('anonymousSessionId does not belong to clientIdentityId');
    }

    if (parsed.analyticsSessionId && parsed.analyticsSessionId !== session.analyticsSessionId) {
      throw new BadRequestException('anonymousSessionId does not belong to analyticsSessionId');
    }
  }

  private validateProperties(properties: Record<string, unknown> | undefined): void {
    try {
      validateAnalyticsProperties(properties ?? {});
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid analytics properties');
    }
  }

  private toPrismaJsonInput(value: Record<string, unknown>): PrismaJsonInput {
    return value as Prisma.InputJsonValue;
  }

  private isDuplicateEventIdError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
