import { Body, Controller, Post } from '@nestjs/common'
import { PrismaService } from './prisma.service'

interface CreateInvoiceBody {
  amountCents: number
}

@Controller('api/invoices')
export class InvoicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@Body() body: CreateInvoiceBody) {
    return this.prisma.invoice.create({
      data: {
        amountCents: body.amountCents,
        status: 'open',
      },
    })
  }
}
