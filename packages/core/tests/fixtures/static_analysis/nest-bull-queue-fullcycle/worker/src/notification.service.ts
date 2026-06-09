import sgMail from '@sendgrid/mail'

export async function sendTranscodeReadyEmail(email: string, assetId: string) {
  return sgMail.send({
    to: email,
    from: 'media@example.com',
    subject: 'Media transcode is ready',
    text: `Asset ${assetId} is ready`,
  })
}
