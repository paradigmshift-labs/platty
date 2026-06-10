import { Body, Controller, Post } from '@nestjs/common';

import { AnalyticsService, IngestAnalyticsEventInput } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('events')
  ingestEvent(@Body() body: IngestAnalyticsEventInput) {
    return this.analyticsService.ingestEvent(body);
  }
}
