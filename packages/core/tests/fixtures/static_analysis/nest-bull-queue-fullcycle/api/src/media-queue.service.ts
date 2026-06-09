import { InjectQueue } from '@nestjs/bull'
import { Injectable } from '@nestjs/common'
import { Queue } from 'bull'

@Injectable()
export class MediaQueueService {
  constructor(@InjectQueue('media') private readonly mediaQueue: Queue) {}

  enqueueTranscode(assetId: string, email: string) {
    return this.mediaQueue.add('transcode', {
      assetId,
      email,
    })
  }
}
