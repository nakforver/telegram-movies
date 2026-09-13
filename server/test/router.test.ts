import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CatalogService } from '../src/storage/catalog-service.js';
import { MemoryStore } from '../src/storage/memory.js';
import { handleApi } from '../src/http/router.js';

describe('movie API', () => {
  let server: Server;
  const catalog = new CatalogService(new MemoryStore([
    { movie_id: 'movie-1', title: 'Action Movie', type: 'movie', status: 'published', created_at: '2026-01-01T00:00:00Z', telegram_chat_id: '-100123', telegram_message_id: '456', category: 'Action' },
    { movie_id: 'movie-2', title: 'Draft Movie', type: 'movie', status: 'draft', created_at: '2026-01-02T00:00:00Z' },
    { movie_id: 'series-1', title: 'Demo Series', type: 'series', status: 'published', season: '1', created_at: '2026-01-03T00:00:00Z' },
    { movie_id: 'series-1-s1-e1', title: 'Demo Series', type: 'series', status: 'published', season: '1', episode: '1', created_at: '2026-01-04T00:00:00Z', telegram_chat_id: '-100123', telegram_message_id: '789' }
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
  it('returns published titles without standalone episode rows', async () => { expect((await json('/api/movies')).data.total).toBe(2); });
  it('returns categories', async () => { expect((await json('/api/categories')).data).toEqual([{ name: 'Action', count: 1 }]); });
  it('searches catalog fields', async () => { expect((await json('/api/search?q=action')).data.total).toBe(1); });
  it('returns movie details and episodes', async () => { expect((await json('/api/movies/series-1')).data.episodes).toHaveLength(1); });
  it('rejects invalid IDs', async () => { expect((await json('/api/movies/missing')).success).toBe(false); });
  it('does not claim Telegram metadata is browser-playable', async () => { expect((await json('/api/play/series-1-s1-e1')).data.playable).toBe(false); });
  it('rejects missing Telegram references', async () => { expect((await json('/api/play/series-1')).data.playable).toBe(false); });
  it('protects admin endpoints', async () => { expect((await json('/api/admin/movies', { method: 'POST' })).success).toBe(false); });
});
