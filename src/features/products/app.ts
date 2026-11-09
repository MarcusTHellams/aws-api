import { createApp } from '@/http/create-app';

// Read-only example data; replace with persistent storage when the feature needs it.
const products = [
  { id: 'notebook', name: 'Notebook' },
  { id: 'pen', name: 'Pen' },
];

export const app = createApp();

app.get('/products', (c) => c.json({ products }));

app.get('/products/:productId', (c) => {
  const product = products.find((item) => item.id === c.req.param('productId'));
  if (!product) {
    return c.json({ error: 'Product not found' }, 404);
  }
  return c.json({ product });
});
