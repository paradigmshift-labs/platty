import { Process, Processor } from '@nestjs/bull'
import { Job } from 'bull'
import { sendTranscodeReadyEmail } from './notification.service'

@Processor('media')
export class MediaProcessor {
  @Process('transcode')
  async handleTranscode(job: Job<{ assetId: string; email: string }>) {
    await sendTranscodeReadyEmail(job.data.email, job.data.assetId)
  }
}
