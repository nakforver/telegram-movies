import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CatalogService } from '../src/storage/catalog-service.js';
import { MemoryStore } from '../src/storage/memory.js';
import { handleMedia, handlePosterMedia } from '../src/http/media.js';
import { signPlaybackToken } from '../src/http/playback-tokens.js';

process.env.PLAYBACK_TOKEN_SECRET = 'test-playback-secret';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'test-bucket';
const realFetch = fetch.bind(globalThis);

describe('R2 media endpoint', () => {
  let server: Server;
  const catalog = new CatalogService(new MemoryStore([
    {
      movie_id: 'movie-1', title: 'Action Movie', type: 'movie', status: 'published', created_at: '2026-01-01T00:00:00Z',
      media_source: 'r2', media_object_key: 'movies/movie-1.mp4'
    },
    {
      movie_id: 'processing', title: 'Processing Movie', type: 'movie', status: 'published', created_at: '2026-01-01T00:00:00Z',
      media_source: 'none', media_object_key: '', media_status_reason: 'Video processing is unavailable because this title has not been transferred to R2.'
    }
  ]), 0);

  beforeEach(() => {
    catalog.invalidate();
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const movieId = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      try {
        if (url.pathname.startsWith('/api/posters/')) await handlePosterMedia(request, response, catalog, movieId);
        else await handleMedia(request, response, catalog, movieId);
      }
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
  const mediaPath = (movieId: string) => `/api/media/${movieId}?token=${signPlaybackToken(movieId)}`;
  function stubR2(content = new Uint8Array([1, 2, 3, 4, 5])) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init);
      const range = (init?.headers as Record<string, string> | undefined)?.range;
      if (range === 'bytes=1-3') {
        return new Response(new Uint8Array([2, 3, 4]), {
          status: 206,
          headers: { 'content-type': 'video/mp4', 'content-length': '3', 'content-range': 'bytes 1-3/5', 'accept-ranges': 'bytes' }
        });
      }
      return new Response(content, {
        headers: { 'content-type': 'video/mp4', 'content-length': String(content.byteLength), 'accept-ranges': 'bytes' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('returns 200 and streams R2 media', async () => {
    const fetchMock = stubR2();
    const response = await fetch(`${base()}${mediaPath('movie-1')}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-length')).toBe('5');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    const request = fetchMock.mock.calls.find(([url]) => String(url).includes('/test-bucket/movies/movie-1.mp4?'));
    expect(String(request?.[0])).toContain('X-Amz-Signature=');
  });

  it('forwards a Range request and returns 206 with the requested portion', async () => {
    const fetchMock = stubR2();
    const response = await fetch(`${base()}${mediaPath('movie-1')}`, { headers: { range: 'bytes=1-3' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 1-3/5');
    expect(response.headers.get('content-length')).toBe('3');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]));
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).range).toBe('bytes=1-3');
  });

  it('rejects an unsatisfiable range', async () => {
    stubR2();
    const response = await fetch(`${base()}${mediaPath('movie-1')}`, { headers: { range: 'bytes=10-20' } });
    expect(response.status).toBe(416);
  });

  it('requires a playback token', async () => {
    const response = await fetch(`${base()}/api/media/movie-1`);
    expect(response.status).toBe(401);
  });

  it('returns 409 for a movie not transferred to R2', async () => {
    const response = await fetch(`${base()}${mediaPath('processing')}`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Video processing is unavailable because this title has not been transferred to R2.' });
  });

  it('returns 404 for a missing movie', async () => {
    const response = await fetch(`${base()}${mediaPath('missing')}`);
    expect(response.status).toBe(404);
  });

  it('returns 502 when R2 fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('http://127.0.0.1:')) return realFetch(url, init);
      return new Response('Unavailable', { status: 503 });
    }));
    const response = await fetch(`${base()}${mediaPath('movie-1')}`);
    expect(response.status).toBe(502);
  });

  it('serves a poster through the safe backend proxy without exposing R2', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init);
      expect(String(url)).not.toContain('test-secret-key');
      return new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.byteLength) } });
    }));
    const response = await fetch(`${base()}/api/posters/movie-1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
  });

  it('serves a poster even when the video itself has not transferred to R2', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init);
      return new Response(jpeg, { headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.byteLength) } });
    }));
    const response = await fetch(`${base()}/api/posters/processing`);
    expect(response.status).toBe(200);
  });

  it('returns 404 when no poster object exists yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, init);
      return new Response('Missing', { status: 404 });
    }));
    const response = await fetch(`${base()}/api/posters/movie-1`);
    expect(response.status).toBe(404);
  });

  it('returns 404 for a poster of a missing movie', async () => {
    const response = await fetch(`${base()}/api/posters/missing`);
    expect(response.status).toBe(404);
  });
});
