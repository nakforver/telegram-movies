import type { Movie, MovieRecord } from '../types.js';

const required = (value: unknown): string => String(value ?? '').trim();
const asType = (value: unknown): 'movie' | 'series' => required(value).toLowerCase() === 'series' ? 'series' : 'movie';
const asStatus = (value: unknown): 'published' | 'draft' => required(value).toLowerCase() === 'draft' ? 'draft' : 'published';

function numberOrNull(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMovie(row: MovieRecord): Movie | null {
  const recordSource = row as unknown as Record<string, unknown>;
  const record = {
    movie_id: required(row.movie_id),
    title: required(row.title),
    title_km: required(row.title_km),
    original_title: required(row.original_title),
    description: required(row.description),
    poster_url: required(row.poster_url),
    backdrop_url: required(row.backdrop_url),
    category: required(row.category),
    genre: required(row.genre),
    year: required(row.year),
    country: required(row.country),
    duration: required(row.duration),
    rating: required(row.rating),
    type: asType(row.type),
    season: required(row.season),
    episode: required(row.episode),
    telegram_chat_id: required(row.telegram_chat_id),
    telegram_message_id: required(row.telegram_message_id),
    telegram_file_id: required(row.telegram_file_id),
    telegram_file_size: row.telegram_file_size === undefined || row.telegram_file_size === null
      ? undefined
      : Number(row.telegram_file_size),
    status: asStatus(row.status),
    created_at: required(row.created_at),
    updated_at: required(row.updated_at),
    telegram_file_name: required(row.telegram_file_name),
    media_source: required(row.media_source) === 'r2' ? 'r2' as const : 'none' as const,
    media_url: required(row.media_url),
    media_object_key: required(row.media_object_key),
    media_status_reason: required(row.media_status_reason),
    telegram_thumbnail_file_id: required(row.telegram_thumbnail_file_id)
  };

  if (!record.movie_id || !record.title) return null;
  return {
    ...record,
    seasonNumber: numberOrNull(record.season),
    episodeNumber: numberOrNull(record.episode),
    durationMinutes: numberOrNull(record.duration),
    ratingValue: numberOrNull(record.rating),
    yearValue: numberOrNull(record.year),
    hasTelegramReference: Boolean(record.telegram_chat_id && record.telegram_message_id)
  };
}
