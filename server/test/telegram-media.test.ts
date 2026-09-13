import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previousBotToken = process.env.TELEGRAM_BOT_TOKEN;
const previousApiBase = process.env.TELEGRAM_API_BASE;
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_API_BASE = 'https://telegram-bot-api.example.com/';

const { resolveTelegramFileUrl } = await import('../src/telegram/media.js');
const { setWebhook } = await import('../src/telegram/api.js');

afterAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = previousBotToken;
  process.env.TELEGRAM_API_BASE = previousApiBase;
});

describe('Telegram API base', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_API_BASE = 'https://telegram-bot-api.example.com/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = previousBotToken;
    process.env.TELEGRAM_API_BASE = previousApiBase;
  });

  it('uses the configured self-hosted API base for getFile and the download URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { file_id: 'file-1', file_path: 'videos/movie.mp4', file_size: 1234 }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveTelegramFileUrl('file-1');

    expect(fetchMock).toHaveBeenCalledWith('https://telegram-bot-api.example.com/bottest-token/getFile', expect.objectContaining({ method: 'POST' }));
    expect(resolved.url).toBe('https://telegram-bot-api.example.com/file/bottest-token/videos/movie.mp4');
    expect(resolved.size).toBe(1234);
  });

  it('uses the configured self-hosted API base for webhook setup', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await setWebhook('https://telegram-movies.wasmer.app/api/telegram/webhook', 'webhook-secret');

    expect(fetchMock).toHaveBeenCalledWith('https://telegram-bot-api.example.com/bottest-token/setWebhook', expect.objectContaining({ method: 'POST' }));
  });
});
