import { Body, Controller, Post } from '@nestjs/common'
import { MediaQueueService } from './media-queue.service'

@Controller('/api/media')
export class MediaController {
  constructor(private readonly mediaQueue: MediaQueueService) {}

  @Post('transcode')
  enqueueTranscode(@Body() body: { assetId: string; email: string }) {
    return this.mediaQueue.enqueueTranscode(body.assetId, body.email)
  }
}
