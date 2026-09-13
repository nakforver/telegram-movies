import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { CatalogService } from '../src/storage/catalog-service';
import { MemoryStore } from '../src/storage/memory';

process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';

const { handleApi } = await import('../src/http/router');

describe('Telegram channel movie webhook', () => {
  let server: Server;
  const catalog = new CatalogService(new MemoryStore([]), 0);

  beforeEach(() => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      void handleApi(request, response, catalog, url.pathname, url.searchParams);
    });
    server.listen(0);
  });

  afterEach(async () => { await new Promise(resolve => server.close(resolve)); });

  it('ingests a channel video once and exposes it through /api/movies', async () => {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const update = {
      channel_post: {
        chat: { id: -1001234 },
        message_id: 4567,
        caption: 'New Popmovies Action Film\nUploaded from Telegram',
        video: { file_id: 'test-file-id', file_name: 'new-popmovies-action-film.mp4' },
        date: 1700000000
      }
    };
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${base}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-secret' },
        body: JSON.stringify(update)
      });
      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject({ success: true, data: { handled: true } });
    }

    const response = await fetch(`${base}/api/movies`);
    const body = await response.json();
    expect(response.ok).toBe(true);
    expect(body).toMatchObject({
      success: true,
      data: {
        total: 1,
        items: [{
          movie_id: 'telegram--1001234-4567',
          title: 'New Popmovies Action Film',
          telegram_chat_id: '-1001234',
          telegram_message_id: '4567',
          telegram_file_id: 'test-file-id',
          status: 'published'
        }]
      }
    });
  });
});
