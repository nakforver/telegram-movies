import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CatalogService } from '../src/storage/catalog-service.js';
import { MemoryStore } from '../src/storage/memory.js';
import * as r2Module from '../src/storage/r2.js';
import * as transferModule from '../src/telegram/transfer.js';
import type { MovieRecord } from '../src/types.js';

const adminSecret = process.env.ADMIN_SECRET;
process.env.ADMIN_SECRET = 'test';

const { handleApi } = await import('../src/http/router.js');

process.env.PLAYBACK_TOKEN_SECRET = 'test-playback-secret';
afterAll(() => {
  process.env.ADMIN_SECRET = adminSecret;
});

describe('movie API', () => {
  let server: Server;
  const catalog = new CatalogService(new MemoryStore([
    { movie_id: 'movie-1', title: 'Action Movie', type: 'movie', status: 'published', created_at: '2026-01-01T00:00:00Z', telegram_chat_id: '-100123', telegram_message_id: '456', telegram_file_id: 'file-1', category: 'Action' },
    { movie_id: 'movie-2', title: 'Draft Movie', type: 'movie', status: 'draft', created_at: '2026-01-02T00:00:00Z' },
    { movie_id: 'series-1', title: 'Demo Series', type: 'series', status: 'published', season: '1', created_at: '2026-01-03T00:00:00Z' },
    { movie_id: 'series-1-s1-e1', title: 'Demo Series', type: 'series', status: 'published', season: '1', episode: '1', created_at: '2026-01-04T00:00:00Z', media_source: 'r2', media_object_key: 'movies/series-1-s1-e1.mp4' },
    { movie_id: 'missing-file-id', title: 'Missing File', type: 'movie', status: 'published', created_at: '2026-01-05T00:00:00Z', telegram_chat_id: '-100123', telegram_message_id: '790' }
  ]), 60_000);

  beforeEach(() => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      void handleApi(request, response, catalog, url.pathname, url.searchParams);
    });
    server.listen(0);
  });
  afterEach(async () => { await new Promise(resolve => server.close(resolve)); });

  const base = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function json(path: string, init?: RequestInit) {
    const response = await fetch(base() + path, init);
    return await response.json();
  }

  it('returns health', async () => { expect((await json('/api/health')).success).toBe(true); });
  it('returns published titles without standalone episode rows', async () => { expect((await json('/api/movies')).data.total).toBe(3); });
  it('returns categories', async () => { expect((await json('/api/categories')).data).toEqual([{ name: 'Action', count: 1 }]); });
  it('searches catalog fields', async () => { expect((await json('/api/search?q=action')).data.total).toBe(1); });
  it('returns movie details and episodes', async () => { expect((await json('/api/movies/series-1')).data.episodes).toHaveLength(1); });
  it('rejects invalid IDs', async () => { expect((await json('/api/movies/missing')).success).toBe(false); });
  it('provides a signed backend media URL for playable R2 metadata', async () => {
    const result = (await json('/api/play/series-1-s1-e1')).data;
    expect(result.playable).toBe(true);
    expect(result.url).toMatch(/^\/api\/media\/series-1-s1-e1\?token=\d+\.[^?]+$/);
  });
  it('rejects missing Telegram references', async () => { expect((await json('/api/play/series-1')).data.playable).toBe(false); });
  it('rejects playback when the R2 source is missing', async () => {
    const result = (await json('/api/play/missing-file-id')).data;
    expect(result.playable).toBe(false);
    expect(result.url).toBeUndefined();
  });
  it('protects admin endpoints', async () => { expect((await json('/api/admin/movies', { method: 'POST' })).success).toBe(false); });

  it('protects Telegram-to-R2 retry transfers', async () => {
    const response = await fetch(base() + '/api/admin/movies/movie-1/transfer', { method: 'POST', headers: { 'x-admin-secret': 'invalid' } });
    expect(response.status).toBe(401);
  });

  it('rejects a Telegram-to-R2 retry without a file reference', async () => {
    const response = await fetch(base() + '/api/admin/movies/series-1/transfer', { method: 'POST', headers: { 'x-admin-secret': 'test' } });
    expect(response.status).toBe(409);
  });

  it('retries a Telegram-to-R2 transfer for an existing movie', async () => {
    const transferMock = vi.spyOn(transferModule, 'transferTelegramMovieToR2');
    transferMock.mockResolvedValueOnce({
      transferred: true,
      record: { movie_id: 'movie-1', title: 'Action Movie', type: 'movie', status: 'published', telegram_file_id: 'file-1', media_source: 'r2', media_object_key: 'movies/movie-1.mp4' } as MovieRecord
    });
    const response = await fetch(base() + '/api/admin/movies/movie-1/transfer', { method: 'POST', headers: { 'x-admin-secret': 'test' } });
    const body = await response.json() as { success: boolean; data: { transferred: boolean; mediaSource: string; mediaObjectKey: string } };
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ transferred: true, mediaSource: 'r2', mediaObjectKey: 'movies/movie-1.mp4' });
    transferMock.mockRestore();
  });

  it('uploads a streamed video to R2 and marks it playable', async () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_BUCKET = 'test-bucket';
    const uploadMock = vi.spyOn(r2Module, 'uploadToR2');
    uploadMock.mockResolvedValueOnce({ objectKey: 'movies/movie-1.mp4' });
    const video = new Uint8Array([1, 2, 3, 4, 5]);
    const response = await fetch(base() + '/api/admin/movies/movie-1/upload', {
      method: 'PUT',
      headers: { 'x-admin-secret': 'test', 'content-type': 'video/mp4', 'content-length': String(video.byteLength) },
      body: video
    });
    const body = await response.json() as { success: boolean; data: { transferred: boolean; mediaSource: string; mediaObjectKey: string } };
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ transferred: true, mediaSource: 'r2', mediaObjectKey: 'movies/movie-1.mp4' });
    expect(uploadMock).toHaveBeenCalledWith('movies/movie-1.mp4', expect.any(ReadableStream), 'video/mp4', 5);
    uploadMock.mockRestore();
  });

  it('protects poster backfills', async () => {
    const response = await fetch(base() + '/api/admin/movies/movie-1/poster', { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('rejects a poster backfill for a missing movie', async () => {
    const response = await fetch(base() + '/api/admin/movies/missing/poster', { method: 'POST', headers: { 'x-admin-secret': 'test' } });
    expect(response.status).toBe(404);
  });

  it('rejects a poster backfill when Telegram provided no thumbnail', async () => {
    const response = await fetch(base() + '/api/admin/movies/movie-1/poster', { method: 'POST', headers: { 'x-admin-secret': 'test' } });
    expect(response.status).toBe(409);
  });

  it('backfills a poster from Telegram to R2 without re-uploading twice', async () => {
    await catalog.upsert({ movie_id: 'poster-movie', title: 'Poster Movie', type: 'movie', status: 'published', telegram_thumbnail_file_id: 'thumb-1', created_at: '2026-01-06T00:00:00Z' });
    const thumbnailMock = vi.spyOn(transferModule, 'withTelegramThumbnail');
    thumbnailMock.mockResolvedValueOnce({
      movie_id: 'poster-movie', title: 'Poster Movie', type: 'movie', status: 'published',
      telegram_thumbnail_file_id: 'thumb-1', poster_url: '/api/posters/poster-movie', backdrop_url: '/api/posters/poster-movie'
    } as MovieRecord);
    const response = await fetch(base() + '/api/admin/movies/poster-movie/poster', { method: 'POST', headers: { 'x-admin-secret': 'test' } });
    const body = await response.json() as { success: boolean; data: { uploaded: boolean; posterUrl: string } };
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ uploaded: true, posterUrl: '/api/posters/poster-movie' });
    expect(thumbnailMock).toHaveBeenCalledWith(expect.objectContaining({ movie_id: 'poster-movie' }), { force: true });
    thumbnailMock.mockRestore();

    const repeat = await fetch(base() + '/api/admin/movies/poster-movie/poster', { method: 'POST', headers: { 'x-admin-secret': 'test' } });
    const repeatBody = await repeat.json() as { success: boolean; data: { uploaded: boolean } };
    expect(repeat.status).toBe(200);
    expect(repeatBody.data.uploaded).toBe(false);
    await catalog.delete('poster-movie');
  });
});
