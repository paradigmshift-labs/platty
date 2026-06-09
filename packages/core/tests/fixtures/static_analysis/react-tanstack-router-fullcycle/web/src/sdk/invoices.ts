export async function submitInvoice(input: { amountCents: number }) {
  return fetch('/api/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}
