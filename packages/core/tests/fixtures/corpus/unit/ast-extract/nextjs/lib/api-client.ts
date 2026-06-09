export async function fetchOrders() {
  const res = await fetch('/api/orders');
  return res.json();
}

export async function createOrder(data: unknown) {
  const res = await fetch('/api/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}
