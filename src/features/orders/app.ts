import { createApp } from '@/http/create-app';

// Read-only example data; replace with persistent storage when the feature needs it.
const orders = [
  { id: 'order-1001', status: 'pending', items: [{ productId: 'notebook', quantity: 2 }] },
  { id: 'order-1002', status: 'shipped', items: [{ productId: 'pen', quantity: 3 }] },
];

export const app = createApp();

app.get('/orders', (c) => c.json({ orders }));

app.get('/orders/:orderId', (c) => {
  const order = orders.find((item) => item.id === c.req.param('orderId'));
  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }
  return c.json({ order });
});
