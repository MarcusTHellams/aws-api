import { app } from '../src/features/orders/app';
import { handler } from '../src/features/orders/handler';
import { restEvent } from './fixtures/rest-event';

const firstOrder = {
  id: 'order-1001',
  status: 'pending',
  items: [{ productId: 'notebook', quantity: 2 }],
};

describe('orders feature', () => {
  it('lists sample orders with shared response headers', async () => {
    const response = await app.request('/orders');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      orders: [
        firstOrder,
        { id: 'order-1002', status: 'shipped', items: [{ productId: 'pen', quantity: 3 }] },
      ],
    });
  });

  it('finds an order by its path parameter', async () => {
    const response = await app.request('/orders/order-1001');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ order: firstOrder });
  });

  it('returns JSON 404 for missing orders', async () => {
    const response = await app.request('/orders/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Order not found' });
  });

  it('does not serve another feature through the orders app', async () => {
    const response = await app.request('/products');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it.each(['/orders', '/orders/order-1001'])('handles a REST API event for %s', async (path) => {
    // The adapter types require `version`, which REST API v1 events do not include.
    const response = await handler(restEvent(path) as unknown as Parameters<typeof handler>[0]);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toHaveProperty(
      path === '/orders' ? 'orders' : 'order',
    );
  });
});
