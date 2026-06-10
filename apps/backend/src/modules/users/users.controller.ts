import { Body, Controller, Post } from '@nestjs/common';

import { LinkAnonymousUserInput, LinkAnonymousUserResponse, UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('link-anonymous')
  linkAnonymousUser(@Body() body: LinkAnonymousUserInput): Promise<LinkAnonymousUserResponse> {
    return this.usersService.linkAnonymousUser(body);
  }
}
