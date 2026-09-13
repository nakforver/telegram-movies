import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CatalogService } from '../src/storage/catalog-service.js';
import { MemoryStore } from '../src/storage/memory.js';
import { handleMedia } from '../src/http/media.js';
import { resolveTelegramFileUrl } from '../src/telegram/media.js';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
const realFetch = fetch.bind(globalThis);

describe('Telegram media endpoint', () => {
  let server: Server;
  const catalog = new CatalogService(new MemoryStore([
    {
      movie_id: 'movie-1',
      title: 'Action Movie',
      type: 'movie',
      status: 'published',
      created_at: '2026-01-01T00:00:00Z',
      telegram_chat_id: '-100123',
      telegram_message_id: '456',
      telegram_file_id: 'test-file-id'
    },
    {
      movie_id: 'missing-file',
      title: 'Missing File',
      type: 'movie',
      status: 'published',
      created_at: '2026-01-01T00:00:00Z'
    }
  ]), 0);

  beforeEach(() => {
    catalog.invalidate();
    server = createServer(async (request, response) => {
      const movieId = decodeURIComponent(request.url?.split('/').pop()?.replace(/\?.*$/, '') ?? '');
      try { await handleMedia(request, response, catalog, movieId); }
      catch (error) {
        response.writeHead((error as { status?: number }).status ?? 500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: (error as Error).message }));
      }
    });
    server.listen(0);
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const base = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  function stubTelegram(size = 5, content = new Uint8Array([1, 2, 3, 4, 5])) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('http://127.0.0.1:')) return realFetch(url, init);
      if (url.includes('/bot') && !url.includes('/file/bot')) {
        return new Response(JSON.stringify({ ok: true, result: { file_id: 'test-file-id', file_path: 'videos/test.mp4', file_size: size } }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(content as unknown as BodyInit, {
        headers: { 'content-type': 'video/mp4', 'content-length': String(content.byteLength) },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns 200 and streams resolved Telegram media', async () => {
    const fetchMock = stubTelegram();
    const response = await fetch(`${base()}/movie-1`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe('5');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/bot'), expect.anything());
  });

  it('orders a range request and returns 206 with the requested portion', async () => {
    const media = new Uint8Array([2, 3, 4]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('http://127.0.0.1:')) return realFetch(url, init);
      if (url.includes('/bot') && !url.includes('/file/bot')) {
        return new Response(JSON.stringify({ ok: true, result: { file_id: 'test-file-id', file_path: 'videos/test.mp4', file_size: 5 } }));
      }
      expect(init?.headers).toEqual({ range: 'bytes=1-3' });
      return new Response(media, {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-length': '3', 'content-range': 'bytes 1-3/5', 'accept-ranges': 'bytes' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetch(`${base()}/movie-1`, { headers: { range: 'bytes=1-3' } });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 1-3/5');
    expect(response.headers.get('content-length')).toBe('3');
    expect(bytes).toEqual(media);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/file/bot'), expect.objectContaining({ headers: { range: 'bytes=1-3' } }));
  });

  it('rejects an unsatisfiable range request', async () => {
    stubTelegram();
    const response = await fetch(`${base()}/movie-1`, { headers: { range: 'bytes=10-20' } });
    expect(response.status).toBe(416);
  });

  it('returns 404 for a missing movie', async () => {
    const response = await fetch(`${base()}/missing`);
    expect(response.status).toBe(404);
  });

  it('returns 404 when a catalog record has no Telegram file ID', async () => {
    const response = await fetch(`${base()}/missing-file`);
    expect(response.status).toBe(404);
  });

  it('returns 502 when Telegram getFile fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('http://127.0.0.1:')) return realFetch(url, init);
      return new Response(JSON.stringify({ ok: false, description: 'Bad file' }), { status: 400 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetch(`${base()}/movie-1`);
    expect(response.status).toBe(502);
  });
});

describe('resolveTelegramFileUrl', () => {
  it('returns the file URL and expiry metadata', async () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { file_id: 'test-file-id', file_path: 'videos/test.mp4', file_size: 25 } })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await resolveTelegramFileUrl('test-file-id');

    expect(result.url).toContain('/file/bot');
    expect(result.size).toBe(25);
    expect(result.expiresAt).toBeTruthy();
  });

  it('throws a clear error when Telegram fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Bad request' }), { status: 400 })));
    await expect(resolveTelegramFileUrl('bad-file-id')).rejects.toThrow('Bad request');
  });
});
