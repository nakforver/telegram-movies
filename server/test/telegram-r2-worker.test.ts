import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as transferModule from '../src/telegram/transfer.js';
import { pendingMovies, processPendingMovies } from '../src/workers/telegram-r2.js';
import type { MovieRecord } from '../src/types.js';

process.env.TELEGRAM_MOVIES_URL = 'https://telegram-movies.example.com';
process.env.ADMIN_SECRET = 'test-admin';

describe('Telegram R2 worker', () => {
  beforeEach(() => {
    process.env.TELEGRAM_MOVIES_URL = 'https://telegram-movies.example.com';
    process.env.ADMIN_SECRET = 'test-admin';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads pending published Telegram records from every catalog page', async () => {
    const moviePage = (movieId: string, totalPages: number) => ({
      success: true,
      data: {
        totalPages,
        items: [
          { movie_id: `${movieId}-ready`, title: 'Ready', type: 'movie', status: 'published', telegram_file_id: 'ready-file', media_source: 'r2', poster_url: '/api/posters/ready' },
          { movie_id: `${movieId}-draft`, title: 'Draft', type: 'movie', status: 'draft', telegram_file_id: 'draft-file', media_source: 'none' },
          { movie_id: movieId, title: movieId, type: 'movie', status: 'published', telegram_file_id: `${movieId}-file`, media_source: 'none' }
        ]
      }
    });
    const fetchMock = vi.fn(async (url: string) => new Response(
      JSON.stringify(String(url).includes('page=2') ? moviePage('page-2', 2) : moviePage('page-1', 2)),
      { status: 200 }
    ));
    vi.stubGlobal('fetch', fetchMock);

    const movies = await pendingMovies();

    expect(movies.map(movie => movie.movie_id)).toEqual(['page-1', 'page-2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('transfers pending movies and saves durable R2 metadata', async () => {
    const movie: MovieRecord = {
      movie_id: 'movie-1',
      title: 'Movie',
      type: 'movie',
      status: 'published',
      telegram_file_id: 'file-1',
      media_source: 'none',
      created_at: '2026-01-01T00:00:00Z'
    };
    const transferred = { ...movie, media_source: 'r2' as const, media_object_key: 'movies/movie-1.mp4', media_status_reason: '', poster_url: '/api/posters/movie-1', backdrop_url: '/api/posters/movie-1' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { items: [movie], totalPages: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: transferred }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const transferMock = vi.spyOn(transferModule, 'transferTelegramMovieToR2');
    transferMock.mockResolvedValueOnce({ transferred: true, record: transferred });

    const count = await processPendingMovies();

    expect(count).toBe(1);
    expect(transferMock).toHaveBeenCalledWith(movie);
    expect(fetchMock).toHaveBeenLastCalledWith('https://telegram-movies.example.com/api/admin/movies/movie-1', expect.objectContaining({
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-secret': 'test-admin' }
    }));
  });
});
