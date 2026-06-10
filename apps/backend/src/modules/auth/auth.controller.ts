import { Body, Controller, Post } from '@nestjs/common';

import { AnonymousSessionResponse, AuthService, StartAnonymousSessionInput } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('anonymous')
  startAnonymousSession(@Body() body: StartAnonymousSessionInput): Promise<AnonymousSessionResponse> {
    return this.authService.startAnonymousSession(body);
  }
}
