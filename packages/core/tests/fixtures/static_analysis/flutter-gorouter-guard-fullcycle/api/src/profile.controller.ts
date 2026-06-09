import { Controller, Get } from '@nestjs/common'

@Controller('/api/mobile/profile')
export class ProfileController {
  @Get()
  getProfile() {
    return { id: 'user_1', name: 'Ada' }
  }
}
