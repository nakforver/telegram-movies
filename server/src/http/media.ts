import type { IncomingMessage, ServerResponse } from 'node:http';
import { findEpisode } from '../domain/catalog.js';
import type { CatalogService } from '../storage/catalog-service.js';
import { streamR2Object } from '../storage/r2.js';
import { isRangeValid } from '../telegram/media.js';
import { thumbnailObjectKey } from '../telegram/transfer.js';
import { verifyPlaybackToken } from './playback-tokens.js';
import { HttpError } from './router.js';

export async function handleMedia(request: IncomingMessage, response: ServerResponse, catalog: CatalogService, movieId: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  const movie = findEpisode(await catalog.list(), decodeURIComponent(movieId));
  if (!movie) throw new HttpError(404, 'Movie not found');
  if (movie.media_source !== 'r2' || !movie.media_object_key) {
    throw new HttpError(409, movie.media_status_reason || 'Video processing is unavailable because this title has not been transferred to R2.');
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!verifyPlaybackToken(decodeURIComponent(movieId), url.searchParams.get('token') ?? undefined)) {
    throw new HttpError(401, 'Playback authentication required');
  }

  const rangeHeader = request.headers.range;
  const upstream = await streamR2Object(movie.media_object_key, rangeHeader).catch(() => {
    throw new HttpError(502, 'R2 media request failed');
  });
  if (!upstream.ok || !upstream.body) throw new HttpError(502, 'R2 media request failed');
  const upstreamBody = upstream.body;

  const contentRange = upstream.headers.get('content-range');
  const totalSize = Number(contentRange?.split('/')[1] ?? upstream.headers.get('content-length') ?? 0);
  const responseLength = Number(upstream.headers.get('content-length') ?? totalSize);
  if (rangeHeader && (!totalSize || !isRangeValid(rangeHeader, totalSize))) throw new HttpError(416, 'Requested range not satisfiable');

  response.writeHead(rangeHeader ? 206 : 200, {
    'content-type': upstream.headers.get('content-type') ?? 'video/mp4',
    ...(responseLength ? { 'content-length': String(responseLength) } : {}),
    ...(rangeHeader && contentRange ? { 'content-range': contentRange } : {}),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });

  if (request.method === 'HEAD') {
    await upstreamBody.cancel().catch(() => undefined);
    response.end();
    return;
  }

  await upstreamBody.pipeTo(new WritableStream({
    write(chunk) {
      return new Promise<void>((resolve, reject) => response.write(chunk, error => error ? reject(error) : resolve()));
    },
    close() { response.end(); },
    abort(reason) {
      void upstreamBody.cancel(reason).catch(() => undefined);
      response.destroy(reason instanceof Error ? reason : new Error(String(reason)));
    }
  }));
}

export async function handlePosterMedia(request: IncomingMessage, response: ServerResponse, catalog: CatalogService, movieId: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  const movie = findEpisode(await catalog.list(), decodeURIComponent(movieId));
  if (!movie) throw new HttpError(404, 'Movie not found');
  if (movie.media_source !== 'r2' || !movie.media_object_key) {
    throw new HttpError(409, 'A poster is unavailable because this title has not been transferred to R2.');
  }
  const upstream = await streamR2Object(thumbnailObjectKey(movie.movie_id)).catch(() => {
    throw new HttpError(404, 'Poster is not available yet');
  });
  if (!upstream.ok || !upstream.body) throw new HttpError(502, 'R2 poster request failed');
  const poster = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new HttpError(415, 'Poster object is not an image');
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': String(poster.byteLength),
    'cache-control': 'public,max-age=86400,immutable',
    'x-content-type-options': 'nosniff'
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(poster);
}
