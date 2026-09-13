import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transferTelegramMovieToR2, telegramBotApiDownloadLimitBytes } from '../src/telegram/transfer.js';
import * as r2Module from '../src/storage/r2.js';
import * as telegramMediaModule from '../src/telegram/media.js';
import type { MovieRecord } from '../src/types.js';

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'test-bucket';

const baseRecord: MovieRecord = {
  movie_id: 'movie-1', title: 'Movie', type: 'movie', status: 'published', created_at: '2026-01-01T00:00:00Z',
  telegram_chat_id: '-100123', telegram_message_id: '456', telegram_file_id: 'file-1', telegram_file_size: 5
};

describe('Telegram to R2 transfer', () => {
  const uploadMock = vi.spyOn(r2Module, 'uploadToR2');
  const getFileMock = vi.spyOn(telegramMediaModule, 'resolveTelegramFileUrl');
  const realFetch = fetch.bind(globalThis);

  beforeEach(() => {
    uploadMock.mockReset();
    getFileMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams a supported Telegram file into R2 and marks it playable', async () => {
    const stream = new ReadableStream<Uint8Array>({ start: controller => controller.close() });
    getFileMock.mockResolvedValue({ url: 'https://telegram.test/file', size: 5, expiresAt: new Date().toISOString() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers: { 'content-type': 'video/mp4' } })));
    uploadMock.mockResolvedValue({ objectKey: 'movies/movie-1.mp4' });

    const result = await transferTelegramMovieToR2(baseRecord);

    expect(result.transferred).toBe(true);
    expect(result.record).toMatchObject({ media_source: 'r2', media_object_key: 'movies/movie-1.mp4' });
    expect(uploadMock).toHaveBeenCalledWith('movies/movie-1.mp4', expect.any(ReadableStream), 'video/mp4');
  });

  it('marks files above the Bot API limit unavailable without requesting them', async () => {
    getFileMock.mockResolvedValue({ url: 'https://telegram.test/file', size: telegramBotApiDownloadLimitBytes + 1, expiresAt: new Date().toISOString() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start: controller => controller.close() }))));

    const result = await transferTelegramMovieToR2({
      ...baseRecord,
      telegram_file_size: telegramBotApiDownloadLimitBytes + 1
    });
    expect(result.transferred).toBe(false);
    expect(result.record.media_source).toBe('none');
    expect(result.record.media_status_reason).toContain('20 MB public Bot API download limit');
    expect(getFileMock).toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('marks the record unavailable when the transfer fails', async () => {
    getFileMock.mockResolvedValue({ url: 'https://telegram.test/file', size: 5, expiresAt: new Date().toISOString() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unavailable', { status: 500 })));
    const result = await transferTelegramMovieToR2(baseRecord);
    expect(result.transferred).toBe(false);
    expect(result.record.media_source).toBe('none');
    expect(result.record.media_status_reason).toContain('Telegram download failed');
  });

});
