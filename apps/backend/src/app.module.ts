import { Module } from '@nestjs/common';

import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConsentModule } from './modules/consent/consent.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [AuthModule, SettingsModule, ConsentModule, AnalyticsModule, UsersModule],
})
export class AppModule {}
