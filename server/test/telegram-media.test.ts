import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previousBotToken = process.env.TELEGRAM_BOT_TOKEN;
const previousApiBase = process.env.TELEGRAM_API_BASE;
const previousGatewayKey = process.env.TELEGRAM_API_GATEWAY_KEY;
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_API_BASE = 'https://telegram-bot-api.example.com/';

const { resolveTelegramFileUrl } = await import('../src/telegram/media.js');
const { setWebhook } = await import('../src/telegram/api.js');

afterAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = previousBotToken;
  process.env.TELEGRAM_API_BASE = previousApiBase;
  process.env.TELEGRAM_API_GATEWAY_KEY = previousGatewayKey;
});

describe('Telegram API base', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_API_BASE = 'https://telegram-bot-api.example.com/';
    delete process.env.TELEGRAM_API_GATEWAY_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TELEGRAM_BOT_TOKEN = previousBotToken;
    process.env.TELEGRAM_API_BASE = previousApiBase;
    process.env.TELEGRAM_API_GATEWAY_KEY = previousGatewayKey;
    if (process.env.TELEGRAM_API_GATEWAY_KEY === undefined) delete process.env.TELEGRAM_API_GATEWAY_KEY;
  });

  it('uses the configured self-hosted API base for getFile and the download URL', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { file_id: 'file-1', file_path: 'videos/movie.mp4', file_size: 1234 }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveTelegramFileUrl('file-1');

    expect(fetchMock).toHaveBeenCalledWith('https://telegram-bot-api.example.com/bottest-token/getFile', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { 'content-type': 'application/json' } }));
    expect(resolved.url).toBe('https://telegram-bot-api.example.com/file/bottest-token/videos/movie.mp4');
    expect(resolved.size).toBe(1234);
  });

  it('strips only the self-hosted storage root from local file paths', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { file_id: 'file-1', file_path: '/var/lib/telegram-bot-api/8739290687:secret/videos/movie.mp4', file_size: 1234 }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveTelegramFileUrl('file-1');

    expect(resolved.url).toBe('https://telegram-bot-api.example.com/file/bottest-token/videos/movie.mp4');
  });

  it('uses the configured self-hosted API base for webhook setup', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await setWebhook('https://telegram-movies.wasmer.app/api/telegram/webhook', 'webhook-secret');

    expect(fetchMock).toHaveBeenCalledWith('https://telegram-bot-api.example.com/bottest-token/setWebhook', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { 'content-type': 'application/json' } }));
  });

  it('sends the gateway key on API and file download requests', async () => {
    process.env.TELEGRAM_API_GATEWAY_KEY = 'test-gateway-key';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      result: { file_id: 'file-1', file_path: 'videos/movie.mp4', file_size: 1234 }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveTelegramFileUrl('file-1');
    await fetch(resolved.url, { headers: { 'x-gateway-key': 'test-gateway-key' } });

    expect(fetchMock).toHaveBeenCalledWith('https://telegram-bot-api.example.com/bottest-token/getFile', expect.objectContaining({
      headers: { 'content-type': 'application/json', 'x-gateway-key': 'test-gateway-key' }
    }));
    expect(fetchMock).toHaveBeenLastCalledWith('https://telegram-bot-api.example.com/file/bottest-token/videos/movie.mp4', {
      headers: { 'x-gateway-key': 'test-gateway-key' }
    });
  });
});
