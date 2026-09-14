import { execFile } from 'node:child_process';
import { transferTelegramMovieToR2 } from '../telegram/transfer.js';
import { signedR2Url, uploadToR2 } from '../storage/r2.js';
import type { MovieRecord } from '../types.js';

function appUrl(): string {
  return (process.env.TELEGRAM_MOVIES_URL ?? '').replace(/\/+$/, '');
}

function adminSecret(): string {
  return process.env.ADMIN_SECRET ?? '';
}

function pollIntervalMs(): number {
  return Number(process.env.TELEGRAM_R2_POLL_MS ?? 15_000);
}

export async function pendingMovies(): Promise<MovieRecord[]> {
  const pending: MovieRecord[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(`${appUrl()}/api/movies?page=${page}&pageSize=100`);
    const body = await response.json().catch(() => null) as { success?: boolean; data?: { items?: MovieRecord[]; totalPages?: number }; error?: string } | null;
    if (!response.ok || !body?.success || !body.data?.items) {
      throw new Error(body?.error ?? `Unable to load catalog (${response.status})`);
    }
    pending.push(...body.data.items.filter(movie =>
      movie.status === 'published' &&
      movie.telegram_file_id &&
      (movie.media_source !== 'r2' || !movie.poster_url)
    ));
    totalPages = Math.max(1, body.data.totalPages ?? 1);
    page += 1;
  } while (page <= totalPages);
  return pending;
}

export async function processPendingMovies(): Promise<number> {
  const movies = await pendingMovies();
  let transferred = 0;
  for (const movie of movies) {
    const result = await transferTelegramMovieToR2(movie);
    let record = result.record;
    if (record.media_source === 'r2' && !record.poster_url) {
      try {
        const posterKey = await generatePoster(record);
        const posterUrl = `/api/posters/${encodeURIComponent(record.movie_id)}`;
        record = { ...record, poster_url: posterUrl, backdrop_url: posterUrl };
        console.log(`Generated poster ${posterKey}`);
      } catch (error) {
        console.warn(`Unable to generate poster for ${movie.movie_id}: ${error instanceof Error ? error.message : error}`);
      }
    }
    const response = await fetch(`${appUrl()}/api/admin/movies/${encodeURIComponent(movie.movie_id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-secret': adminSecret() },
      body: JSON.stringify(record)
    });
    const body = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
    if (!response.ok || !body?.success) throw new Error(body?.error ?? `Unable to save ${movie.movie_id} (${response.status})`);
    if (result.transferred) {
      transferred += 1;
      console.log(`Transferred ${movie.movie_id} to ${record.media_object_key}`);
    }
  }
  return transferred;
}

async function generatePoster(record: MovieRecord): Promise<string> {
  const sourceKey = record.media_object_key;
  if (!sourceKey) throw new Error('R2 media object key is missing');
  const sourceUrl = signedR2Url(sourceKey);
  if (!sourceUrl) throw new Error('Cloudflare R2 is not configured');
  const objectKey = `posters/${encodeURIComponent(record.movie_id)}.jpg`;
  const poster = await new Promise<Buffer>((resolve, reject) => {
    execFile('ffmpeg', [
      '-v', 'error',
      '-i', sourceUrl,
      '-frames:v', '1',
      '-vf', 'scale=480:-2',
      '-f', 'image2pipe',
      '-c:v', 'mjpeg',
      '-q:v', '4',
      'pipe:1'
    ], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  if (!poster.byteLength) throw new Error('ffmpeg did not produce a poster');
  const body = new Response(new Uint8Array(poster)).body;
  if (!body) throw new Error('Unable to create poster upload stream');
  await uploadToR2(objectKey, body, 'image/jpeg', poster.byteLength);
  return objectKey;
}

async function runWorker(): Promise<void> {
  if (!appUrl() || !adminSecret()) throw new Error('TELEGRAM_MOVIES_URL and ADMIN_SECRET are required');
  for (;;) {
    try {
      await processPendingMovies();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs()));
  }
}

if (process.env.VITEST === undefined) {
  void runWorker();
}
