import { describe, expect, it } from 'vitest';
import { telegramUpdateToMovie } from '../src/telegram/ingestion';
import { SHEET_FIELDS } from '../src/storage/schema';

const update = {
  channel_post: {
    chat: { id: -1001234 },
    message_id: 4567,
    caption: 'New Popmovies Action Film\nUploaded from Telegram',
    video: { file_id: 'test-file-id', file_name: 'new-popmovies-action-film.mp4', file_size: 1024 },
    date: 1700000000
  }
};

describe('Telegram channel movie ingestion', () => {
  it('maps a channel video post to the catalog schema', () => {
    const movie = telegramUpdateToMovie(update);

    expect(movie).not.toBeNull();
    const keys = Object.keys(movie ?? {});
    expect(SHEET_FIELDS.slice(0, -5).every(field => keys.includes(field))).toBe(true);
    expect(keys).toContain('telegram_thumbnail_file_id');
    expect(keys).toContain('telegram_file_size');
    expect(movie?.telegram_file_size).toBe(1024);
    expect(movie).toMatchObject({
      title: 'New Popmovies Action Film',
      description: 'Uploaded from Telegram',
      telegram_chat_id: '-1001234',
      telegram_message_id: '4567',
      telegram_file_id: 'test-file-id',
      type: 'movie',
      status: 'published'
    });
  });

  it('uses sensible defaults when a caption is absent', () => {
    const movie = telegramUpdateToMovie({
      channel_post: {
        chat: { id: -1001234 },
        message_id: 4568,
        video: { file_id: 'test-file-id-2', file_name: 'movie-file.mp4' },
        date: 1700000001
      }
    });

    expect(movie).toMatchObject({
      title: 'movie-file',
      description: 'Uploaded from the Popmovies Telegram channel.',
      category: 'Movies',
      status: 'published'
    });
  });

  it('converts bot formatted captions into readable titles', () => {
    const movie = telegramUpdateToMovie({
      channel_post: {
        chat: { id: -1001234 },
        message_id: 4570,
        caption: '\u200b*New _Popmovies_ Action Film\\*\nUploaded from Telegram',
        caption_entities: [
          { type: 'bold', offset: 1, length: 4 },
          { type: 'italic', offset: 6, length: 10 },
          { type: 'code', offset: 17, length: 12 }
        ],
        video: { file_id: 'test-file-id-3' },
        date: 1700000003
      }
    });

    expect(movie?.title).toBe('New Popmovies Action Film*');
  });

  it('ignores non-video channel posts', () => {
    expect(telegramUpdateToMovie({ channel_post: { chat: { id: -1001234 }, message_id: 4569, caption: 'Text only', date: 1700000002 } })).toBeNull();
  });

  it('uses a deterministic movie ID so the same message does not create a duplicate', () => {
    const first = telegramUpdateToMovie(update);
    const second = telegramUpdateToMovie(update);
    expect(first?.movie_id).toBe('telegram--1001234-4567');
    expect(second?.movie_id).toBe(first?.movie_id);
  });

  it('captures Telegram video thumbnails for private R2 transfer', () => {
    const movie = telegramUpdateToMovie({
      channel_post: {
        chat: { id: -1001234 },
        message_id: 4571,
        video: {
          file_id: 'video-file',
          file_size: 1024,
          thumbnail: { file_id: 'thumbnail-file', file_size: 64, mime_type: 'image/jpeg' }
        },
        date: 1700000004
      }
    });

    expect(movie?.telegram_thumbnail_file_id).toBe('thumbnail-file');
  });
});
