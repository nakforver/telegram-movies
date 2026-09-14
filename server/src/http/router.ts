import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { adminSecret, googleSpreadsheetId, miniAppUrl, port, telegramBotToken, telegramWebhookSecret } from '../config.js';
import { sendMessage } from '../telegram/api.js';
import { CatalogService } from '../storage/catalog-service.js';
import { MemoryStore } from '../storage/memory.js';
import { GoogleSheetsStore } from '../storage/google-sheets.js';
import { telegramUpdateToMovie, type TelegramUpdate } from '../telegram/ingestion.js';
import { transferTelegramMovieToR2, withTelegramThumbnail } from '../telegram/transfer.js';
import { uploadToR2 } from '../storage/r2.js';
import { categories, episodes, findEpisode, normalizeQuery, publicMovie, queryCatalog, searchMovies, toPlaySource } from '../domain/catalog.js';
import { signPlaybackToken } from './playback-tokens.js';
import type { MovieRecord } from '../types.js';
import { readJsonBody } from './body.js';
import { failure, success } from './json.js';
import { applySecurityHeaders, isAdmin } from './security.js';

export async function handleApi(request: IncomingMessage, response: ServerResponse, catalog: CatalogService, pathname: string, searchParams: URLSearchParams): Promise<boolean> {
  if (!pathname.startsWith('/api/')) return false;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  applySecurityHeaders(request, response);
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return true; }
  try {
    if (method !== 'GET' && !pathname.startsWith('/api/admin/') && pathname !== '/api/telegram/webhook') throw new Error('Method not allowed');
    if (request.method === 'POST' && pathname === '/api/telegram/webhook') {
      if (!telegramWebhookSecret || request.headers['x-telegram-bot-api-secret-token'] !== telegramWebhookSecret) {
        throw new HttpError(401, 'Telegram webhook authentication required');
      }
      const update = await readJsonBody(request) as TelegramUpdate;
      const chatId = String(update.message?.chat?.id ?? '');
      const command = update.message?.text?.split(/\s+/)[0] ?? '';
      if (chatId && miniAppUrl) {
        if (command === '/start') await sendMessage(chatId, 'Welcome to the Movie Library. Browse movies, series, favorites, and continue watching.', miniAppUrl);
        else if (command === '/movies') await sendMessage(chatId, 'Browse the latest movies in the Mini App.', miniAppUrl);
        else if (command === '/search') await sendMessage(chatId, 'Open Search to find English, Khmer, original, year, and genre titles.', miniAppUrl);
        else if (command === '/help') await sendMessage(chatId, 'Commands: /start, /movies, /search, /help.', miniAppUrl);
      }
      const ingestedMovie = telegramUpdateToMovie(update);
      if (ingestedMovie) {
        const transfer = await transferTelegramMovieToR2(ingestedMovie);
        await catalog.upsert(transfer.record);
      }
      success(response, { handled: true });
      return true;
    }
    if (pathname === '/api/health') {
      success(response, { status: 'ok', time: new Date().toISOString(), integrations: {
        googleSheets: Boolean(googleSpreadsheetId && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY),
        telegramBot: Boolean(telegramBotToken),
        miniAppUrl: Boolean(miniAppUrl),
        admin: Boolean(adminSecret),
        telegramWebhook: Boolean(telegramWebhookSecret),
        telegramBotApi: process.env.TELEGRAM_API_BASE ? 'self-hosted' : 'public',
        cloudflareR2: Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET)
      }});
      return true;
    }
    const movies = await catalog.list();
    if (method === 'GET' && pathname === '/api/movies') {
      success(response, queryCatalog(movies, normalizeQuery(searchParams)));
      return true;
    }
    const movieMatch = pathname.match(/^\/api\/movies\/([^/]+)$/);
    if (method === 'GET' && movieMatch) {
      const movie = findEpisode(movies, decodeURIComponent(movieMatch[1]));
      if (!movie) throw new HttpError(404, 'Movie not found');
      success(response, { ...publicMovie(movie), episodes: episodes(movies, movie.movie_id) });
      return true;
    }
    if (method === 'GET' && pathname === '/api/categories') { success(response, categories(movies)); return true; }
    if (method === 'GET' && pathname === '/api/search') {
      success(response, searchMovies(movies, searchParams.get('q') ?? '', normalizeQuery(searchParams)));
      return true;
    }
    const episodeMatch = pathname.match(/^\/api\/episodes\/([^/]+)$/);
    if (method === 'GET' && episodeMatch) {
      const parent = findEpisode(movies, decodeURIComponent(episodeMatch[1]));
      if (!parent || parent.type !== 'series') throw new HttpError(404, 'Series not found');
      success(response, episodes(movies, parent.movie_id));
      return true;
    }
    const playMatch = pathname.match(/^\/api\/play\/([^/]+)$/);
    if (method === 'GET' && playMatch) {
      const source = toPlaySource(findEpisode(movies, decodeURIComponent(playMatch[1])));
      if (!source) throw new HttpError(404, 'Movie not found');
      success(response, source.url ? { ...source, url: `${source.url}?token=${signPlaybackToken(source.movieId)}` } : source);
      return true;
    }
    if (pathname.startsWith('/api/admin/')) {
      await handleAdmin(request, response, catalog, pathname);
      return true;
    }
    throw new HttpError(404, 'API route not found');
  } catch (error) {
    if (error instanceof HttpError) failure(response, error.status, error.message);
    else failure(response, 500, error instanceof Error ? error.message : 'Unexpected server error');
  }
  return true;
}

async function handleAdmin(request: IncomingMessage, response: ServerResponse, catalog: CatalogService, pathname: string): Promise<boolean> {
  if (!isAdmin(request)) throw new HttpError(401, 'Admin authentication required');
  if (pathname === '/api/admin/schema-diagnostics' && request.method === 'GET') {
    const store = catalog.backingStore;
    if (!(store instanceof GoogleSheetsStore)) throw new HttpError(409, 'Schema diagnostics require the Google Sheets catalog');
    success(response, await store.schemaDiagnostics());
    return true;
  }
  const transferMatch = pathname.match(/^\/api\/admin\/movies\/([^/]+)\/transfer$/);
  if (transferMatch && request.method === 'POST') {
    const movieId = decodeURIComponent(transferMatch[1]);
    const movies = await catalog.list(true);
    const movie = movies.find(item => item.movie_id === movieId);
    if (!movie) throw new HttpError(404, 'Movie not found');
    if (!movie.telegram_file_id) throw new HttpError(409, 'Telegram file reference is missing');
    const transfer = await transferTelegramMovieToR2(movie);
    const saved = await catalog.upsert(transfer.record);
    success(response, {
      movieId,
      transferred: transfer.transferred,
      reason: transfer.reason,
      mediaSource: saved.media_source,
      mediaObjectKey: saved.media_object_key
    });
    return true;
  }
  const posterMatch = pathname.match(/^\/api\/admin\/movies\/([^/]+)\/poster$/);
  if (posterMatch && request.method === 'POST') {
    const movieId = decodeURIComponent(posterMatch[1]);
    const movies = await catalog.list(true);
    const movie = movies.find(item => item.movie_id === movieId);
    if (!movie) throw new HttpError(404, 'Movie not found');
    if (!movie.telegram_thumbnail_file_id?.trim()) {
      throw new HttpError(409, 'This title has no Telegram thumbnail to backfill (the original post had no thumbnail, or it was ingested before thumbnails were captured)');
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const force = url.searchParams.get('force') === 'true';
    if (movie.poster_url && !force) {
      success(response, { movieId, uploaded: false, posterUrl: movie.poster_url, reason: 'Poster already exists (use ?force=true to re-upload)' });
      return true;
    }
    const next = await withTelegramThumbnail(movie, { force: true });
    if (!next.poster_url) throw new HttpError(502, 'Telegram thumbnail fetch or R2 upload failed');
    const saved = await catalog.upsert(next);
    success(response, { movieId, uploaded: true, posterUrl: saved.poster_url, backdropUrl: saved.backdrop_url });
    return true;
  }
  const uploadMatch = pathname.match(/^\/api\/admin\/movies\/([^/]+)\/upload$/);
  if (uploadMatch && request.method === 'PUT') {
    const movieId = decodeURIComponent(uploadMatch[1]);
    const movies = await catalog.list(true);
    const movie = movies.find(item => item.movie_id === movieId);
    if (!movie) throw new HttpError(404, 'Movie not found');
    const contentLength = Number(request.headers['content-length'] ?? Number.NaN);
    if (!Number.isInteger(contentLength) || contentLength <= 0) {
      throw new HttpError(400, 'A video request body with content-length is required');
    }
    const objectKey = `movies/${movie.movie_id}.mp4`;
    await uploadToR2(objectKey, Readable.toWeb(request) as ReadableStream<Uint8Array>, request.headers['content-type'] ?? 'video/mp4', contentLength);
    const next: MovieRecord = {
      ...movie,
      media_source: 'r2',
      media_url: `r2://${process.env.R2_BUCKET ?? ''}/${objectKey}`,
      media_object_key: objectKey,
      media_status_reason: '',
      updated_at: new Date().toISOString()
    };
    const saved = await catalog.upsert(next);
    success(response, {
      movieId,
      transferred: true,
      mediaSource: saved.media_source,
      mediaObjectKey: saved.media_object_key
    });
    return true;
  }
  const movieMatch = pathname.match(/^\/api\/admin\/movies\/([^/]+)$/);
  if (movieMatch && request.method === 'PUT') {
    const record = await readJsonBody(request) as unknown as MovieRecord;
    record.movie_id = decodeURIComponent(movieMatch[1]);
    const saved = await catalog.upsert(normalizeRecord(record));
    success(response, saved);
    return true;
  }
  if (movieMatch && request.method === 'DELETE') {
    await catalog.delete(decodeURIComponent(movieMatch[1]));
    success(response, { deleted: true });
    return true;
  }
  if (pathname === '/api/admin/movies' && request.method === 'POST') {
    const record = await readJsonBody(request) as unknown as MovieRecord;
    if (!record.movie_id || !record.title) throw new HttpError(400, 'movie_id and title are required');
    const saved = await catalog.upsert(normalizeRecord(record));
    success(response, saved, 201);
    return true;
  }
  if (pathname === '/api/admin/import-telegram' && request.method === 'POST') {
    const payload = await readJsonBody(request) as Record<string, unknown>;
    const chatId = String(payload.telegram_chat_id ?? '');
    const messageId = String(payload.telegram_message_id ?? '');
    const fileId = String(payload.telegram_file_id ?? '');
    if (!chatId || !messageId) throw new HttpError(400, 'telegram_chat_id and telegram_message_id are required');
    const record = normalizeRecord({
      ...payload,
      movie_id: String(payload.movie_id ?? `telegram-${chatId}-${messageId}`),
      title: String(payload.title ?? 'Unpublished Telegram import'),
      type: (payload.type ?? 'movie') === 'series' ? 'series' : 'movie',
      status: (payload.status ?? 'draft') === 'published' ? 'published' : 'draft',
      created_at: new Date().toISOString()
    });
    const saved = await catalog.upsert(record);
    success(response, saved, 201);
    return true;
  }
  throw new HttpError(404, 'Admin API route not found');
}

function normalizeRecord(record: MovieRecord): MovieRecord {
  return { ...record, status: record.status === 'published' ? 'published' : 'draft', type: record.type === 'series' ? 'series' : 'movie' };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function createCatalog(): CatalogService {
  const configured = Boolean(googleSpreadsheetId && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  return new CatalogService(configured ? new GoogleSheetsStore(googleSpreadsheetId) : new MemoryStore([]));
}
export const serverPort = port;
