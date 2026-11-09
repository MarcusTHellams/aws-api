import { createApp } from '@/http/create-app';
import { db } from '@/prisma/db';
import codes from 'http-codes';

export const app = createApp();

app.get('/movies', async (c) => {
  const movies = await db.orm.public.Movies.all();
  return c.json(movies);
});

app.get('/movies/:movieId', async (c) => {
  const movie = await db.orm.public.Movies.first({ movieId: c.req.param('movieId') });
  if (!movie) {
    return c.json(
      { message: `movie not found with id of ${c.req.param('movieId')}` },
      codes.NOT_FOUND,
    );
  }
  return c.json(movie);
});
