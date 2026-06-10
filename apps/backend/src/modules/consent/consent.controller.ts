import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { ConsentRecordResponse, ConsentService, LatestConsentInput, RecordConsentInput } from './consent.service';

@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post()
  recordConsent(@Body() body: RecordConsentInput): Promise<ConsentRecordResponse> {
    return this.consentService.recordConsent(body);
  }

  @Get('latest')
  getLatestConsent(
    @Query('userId') userId: string | undefined,
    @Query('clientIdentityId') clientIdentityId: string | undefined,
    @Query('consentType') consentType: LatestConsentInput['consentType'],
  ): Promise<ConsentRecordResponse | null> {
    return this.consentService.getLatestConsent({
      userId,
      clientIdentityId,
      consentType,
    });
  }
}
