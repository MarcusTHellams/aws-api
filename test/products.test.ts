import { app } from '../src/features/products/app';
import { handler } from '../src/features/products/handler';
import { restEvent } from './fixtures/rest-event';

describe('products feature', () => {
  it('lists example products with shared response headers', async () => {
    const response = await app.request('/products');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      products: [
        { id: 'notebook', name: 'Notebook' },
        { id: 'pen', name: 'Pen' },
      ],
    });
  });

  it('finds a product by its path parameter', async () => {
    const response = await app.request('/products/notebook');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ product: { id: 'notebook', name: 'Notebook' } });
  });

  it('returns JSON 404 for missing products', async () => {
    const response = await app.request('/products/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Product not found' });
  });

  it('returns JSON 404 for unregistered application routes', async () => {
    const response = await app.request('/unregistered');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it.each(['/products', '/products/notebook'])(
    'handles REST API events for %s without treating the stage as a route prefix',
    async (path) => {
      // The adapter types require `version`, which REST API v1 events do not include.
      const response = await handler(restEvent(path) as unknown as Parameters<typeof handler>[0]);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body ?? '{}')).toHaveProperty(
        path === '/products' ? 'products' : 'product',
      );
    },
  );
});
