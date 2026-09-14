import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as r2Module from '../src/storage/r2.js';
import * as telegramMediaModule from '../src/telegram/media.js';
import { transferTelegramMovieToR2, withTelegramThumbnail } from '../src/telegram/transfer.js';
import type { MovieRecord } from '../src/types.js';

process.env.TELEGRAM_API_BASE = 'https://telegram-bot-api.example.com';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'test-bucket';

const baseRecord: MovieRecord = {
  movie_id: 'movie-1',
  title: 'Movie',
  type: 'movie',
  status: 'published',
  telegram_file_id: 'video-file',
  telegram_thumbnail_file_id: 'thumbnail-file',
  created_at: '2026-01-01T00:00:00Z'
};

describe('Telegram thumbnail transfer', () => {
  const uploadMock = vi.spyOn(r2Module, 'uploadToR2');
  const getFileMock = vi.spyOn(telegramMediaModule, 'resolveTelegramFileUrl');

  beforeEach(() => {
    uploadMock.mockReset();
    getFileMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a Telegram thumbnail to private R2 and stores a safe proxy URL', async () => {
    getFileMock.mockImplementation(async fileId => ({
      url: `https://telegram-bot-api.example.com/file/${fileId}`,
      size: fileId === 'video-file' ? 1024 : 64,
      expiresAt: new Date().toISOString()
    }));
    uploadMock.mockResolvedValue({ objectKey: 'movies/movie-1.mp4' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('thumbnail') ? 'thumbnail' : 'video', {
      headers: { 'content-type': url.includes('thumbnail') ? 'image/jpeg' : 'video/mp4' }
    })));

    const result = await transferTelegramMovieToR2(baseRecord);

    expect(result.transferred).toBe(true);
    expect(result.record.media_object_key).toBe('movies/movie-1.mp4');
    expect(result.record.poster_url).toBe('/api/posters/movie-1');
    expect(result.record.backdrop_url).toBe('/api/posters/movie-1');
    expect(uploadMock).toHaveBeenNthCalledWith(1, 'movies/movie-1.mp4', expect.any(ReadableStream), 'video/mp4', 1024);
    expect(uploadMock).toHaveBeenNthCalledWith(2, 'posters/movie-1.jpg', expect.any(ReadableStream), 'image/jpeg', 'thumbnail'.length);
  });

  it('does not upload the same thumbnail twice', async () => {
    const record = {
      ...baseRecord,
      media_source: 'r2' as const,
      media_object_key: 'movies/movie-1.mp4',
      poster_url: '/api/posters/movie-1'
    };

    const result = await transferTelegramMovieToR2(record);

    expect(result).toEqual({ record, transferred: true });
    expect(getFileMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('still stores a thumbnail when the video transfer fails', async () => {
    getFileMock.mockImplementation(async fileId => ({
      url: `https://telegram-bot-api.example.com/file/${fileId}`,
      size: fileId === 'video-file' ? 1024 : 64,
      expiresAt: new Date().toISOString()
    }));
    uploadMock.mockImplementation(async objectKey => {
      if (objectKey.startsWith('movies/')) throw new Error('R2 video upload failed');
      return { objectKey };
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('thumbnail') ? 'thumbnail' : 'video', {
      headers: { 'content-type': url.includes('thumbnail') ? 'image/jpeg' : 'video/mp4' }
    })));

    const result = await transferTelegramMovieToR2(baseRecord);

    expect(result.transferred).toBe(false);
    expect(result.record.media_source).toBe('none');
    expect(result.record.poster_url).toBe('/api/posters/movie-1');
  });

  it('leaves a record unchanged when Telegram has no thumbnail', async () => {
    getFileMock.mockResolvedValue({ url: 'https://telegram-bot-api.example.com/file/video-file', size: 1024, expiresAt: new Date().toISOString() });
    uploadMock.mockResolvedValue({ objectKey: 'movies/movie-1.mp4' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('video', { headers: { 'content-type': 'video/mp4' } })));

    const result = await transferTelegramMovieToR2({ ...baseRecord, telegram_thumbnail_file_id: undefined });

    expect(result.transferred).toBe(true);
    expect(result.record.poster_url).toBeUndefined();
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it('detects a jpeg thumbnail even when Telegram serves it as octet-stream without a length', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    getFileMock.mockImplementation(async fileId => ({
      url: `https://telegram-bot-api.example.com/file/${fileId}`,
      // No size reported and no content-length header: chunked encoding.
      size: undefined,
      expiresAt: new Date().toISOString()
    }));
    uploadMock.mockResolvedValue({ objectKey: 'posters/movie-1.jpg' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jpeg, { headers: { 'content-type': 'application/octet-stream' } })));

    const result = await withTelegramThumbnail({ ...baseRecord });

    expect(result.poster_url).toBe('/api/posters/movie-1');
    expect(uploadMock).toHaveBeenCalledWith('posters/movie-1.jpg', expect.any(ReadableStream), 'image/jpeg', jpeg.byteLength);
  });

  it('leaves a record unchanged when the thumbnail bytes are not an image', async () => {
    getFileMock.mockResolvedValue({ url: 'https://telegram-bot-api.example.com/file/thumbnail-file', size: 4, expiresAt: new Date().toISOString() });
    uploadMock.mockResolvedValue({ objectKey: 'posters/movie-1.jpg' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'content-type': 'text/plain' } })));

    const result = await withTelegramThumbnail({ ...baseRecord });

    expect(result.poster_url).toBeUndefined();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('re-uploads the thumbnail when forced, otherwise keeps the existing poster', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    getFileMock.mockResolvedValue({ url: 'https://telegram-bot-api.example.com/file/thumbnail-file', size: jpeg.byteLength, expiresAt: new Date().toISOString() });
    uploadMock.mockResolvedValue({ objectKey: 'posters/movie-1.jpg' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })));
    const withPoster = { ...baseRecord, poster_url: '/api/posters/movie-1', backdrop_url: '/api/posters/movie-1' };

    expect(await withTelegramThumbnail(withPoster)).toEqual(withPoster);
    expect(uploadMock).not.toHaveBeenCalled();

    const forced = await withTelegramThumbnail(withPoster, { force: true });
    expect(forced.poster_url).toBe('/api/posters/movie-1');
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });
});
