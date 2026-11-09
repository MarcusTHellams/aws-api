import { app as moviesApp } from '../src/features/movies/app';
import { handler as movies } from '../src/features/movies/handler';
import { handler as orders } from '../src/features/orders/handler';
import { handler as products } from '../src/features/products/handler';
import { restEvent } from './fixtures/rest-event';

const features = [
  { path: '/products', id: 'notebook', key: 'product', handler: products },
  { path: '/orders', id: 'order-1001', key: 'order', handler: orders },
  { path: '/movies', id: 'movie-1001', key: 'movie', handler: movies },
];

describe.each(features)('$path proxy routing', ({ path, id, key, handler }) => {
  it.each([
    [path, `${key}s`],
    [`${path}/${id}`, key],
  ])('routes the REST event for %s through Hono', async (url, responseKey) => {
    const event = restEvent(url, true);
    const response = await handler(event as unknown as Parameters<typeof handler>[0]);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toHaveProperty(responseKey);
  });

  it('returns a Hono JSON 404 for an unknown nested path', async () => {
    const event = restEvent(`${path}/${id}/unknown`, true);
    const response = await handler(event as unknown as Parameters<typeof handler>[0]);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? '{}')).toEqual({ error: 'Not found' });
  });

  it('does not turn ANY forwarding into an implemented write endpoint', async () => {
    const event = restEvent(path, true);
    event.httpMethod = 'POST';
    event.requestContext.httpMethod = 'POST';
    const response = await handler(event as unknown as Parameters<typeof handler>[0]);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? '{}')).toEqual({ error: 'Not found' });
  });
});

describe('movies feature', () => {
  it('returns the movie details', async () => {
    const response = await moviesApp.request('/movies/movie-1001');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      movie: { id: 'movie-1001', title: 'The Matrix', year: 1999 },
    });
  });

  it('returns a JSON 404 for a missing movie', async () => {
    const response = await moviesApp.request('/movies/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Movie not found' });
  });

  it('does not serve the copied orders routes', async () => {
    const response = await moviesApp.request('/orders');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});
