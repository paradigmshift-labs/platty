import { Body, Controller, Get, Param, Put } from '@nestjs/common';

import { SettingsService, UpsertUserSettingInput, UserSettingResponse } from './settings.service';

interface UpsertUserSettingBody {
  value: UpsertUserSettingInput['value'];
  updatedByClientIdentityId?: string;
}

@Controller('users/:userId/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Put(':namespace/:key')
  upsertUserSetting(
    @Param('userId') userId: string,
    @Param('namespace') namespace: string,
    @Param('key') key: string,
    @Body() body: UpsertUserSettingBody | null | undefined,
  ): Promise<UserSettingResponse> {
    const safeBody: Partial<UpsertUserSettingBody> = body ?? {};

    return this.settingsService.upsertUserSetting({
      userId,
      namespace,
      key,
      value: safeBody.value,
      updatedByClientIdentityId: safeBody.updatedByClientIdentityId,
    });
  }

  @Get()
  listAllUserSettings(@Param('userId') userId: string): Promise<UserSettingResponse[]> {
    return this.settingsService.listUserSettings(userId);
  }

  @Get(':namespace')
  listUserSettingsByNamespace(
    @Param('userId') userId: string,
    @Param('namespace') namespace: string,
  ): Promise<UserSettingResponse[]> {
    return this.settingsService.listUserSettings(userId, namespace);
  }
}
