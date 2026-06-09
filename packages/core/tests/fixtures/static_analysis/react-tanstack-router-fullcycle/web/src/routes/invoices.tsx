import { createFileRoute } from '@tanstack/react-router'
import { submitInvoice } from '../sdk/invoices'

export const Route = createFileRoute('/invoices')({
  component: InvoicesPage,
})

function InvoicesPage() {
  async function onSubmit() {
    await submitInvoice({ amountCents: 4900 })
  }

  return <button onClick={onSubmit}>Create invoice</button>
}
