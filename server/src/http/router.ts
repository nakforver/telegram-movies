import type { IncomingMessage, ServerResponse } from 'node:http';
import { adminSecret, googleSpreadsheetId, miniAppUrl, port, telegramBotToken, telegramWebhookSecret } from '../config.js';
import { sendMessage } from '../telegram/api.js';
import { CatalogService } from '../storage/catalog-service.js';
import { MemoryStore } from '../storage/memory.js';
import { GoogleSheetsStore } from '../storage/google-sheets.js';
import { telegramUpdateToMovie, type TelegramUpdate } from '../telegram/ingestion.js';
import { categories, episodes, findEpisode, normalizeQuery, publicMovie, queryCatalog, searchMovies, toPlaySource } from '../domain/catalog.js';
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
      if (ingestedMovie) await catalog.upsert(ingestedMovie);
      success(response, { handled: true });
      return true;
    }
    if (pathname === '/api/health') {
      success(response, { status: 'ok', time: new Date().toISOString(), integrations: {
        googleSheets: Boolean(googleSpreadsheetId && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY),
        telegramBot: Boolean(telegramBotToken),
        miniAppUrl: Boolean(miniAppUrl),
        admin: Boolean(adminSecret),
        telegramWebhook: Boolean(telegramWebhookSecret)
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
      success(response, source);
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
