import type { IncomingMessage, ServerResponse } from 'node:http';
import { findEpisode } from '../domain/catalog.js';
import type { CatalogService } from '../storage/catalog-service.js';
import { resolveTelegramFileUrl, isRangeValid, TooLargeTelegramFileError } from '../telegram/media.js';
import { verifyPlaybackToken } from './playback-tokens.js';
import { HttpError } from './router.js';

export async function handleMedia(request: IncomingMessage, response: ServerResponse, catalog: CatalogService, movieId: string): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  const movie = findEpisode(await catalog.list(), decodeURIComponent(movieId));
  if (!movie) throw new HttpError(404, 'Movie not found');
  if (!movie.telegram_file_id) throw new HttpError(404, 'Movie does not have a Telegram file');
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!verifyPlaybackToken(decodeURIComponent(movieId), url.searchParams.get('token') ?? undefined)) {
    throw new HttpError(401, 'Playback authentication required');
  }

  let resolved: Awaited<ReturnType<typeof resolveTelegramFileUrl>>;
  try {
    resolved = await resolveTelegramFileUrl(movie.telegram_file_id);
  } catch (error) {
    if (error instanceof TooLargeTelegramFileError) throw new HttpError(413, error.message);
    throw new HttpError(502, error instanceof Error ? error.message : 'Telegram media request failed');
  }
  const rangeHeader = request.headers.range;
  const upstream = await fetch(resolved.url, {
    headers: rangeHeader ? { range: rangeHeader } : undefined
  });
  const upstreamBody = upstream.body;
  if (!upstream.ok || !upstreamBody) throw new HttpError(502, 'Telegram media request failed');

  const contentRange = upstream.headers.get('content-range');
  const totalSize = contentRange?.split('/')[1];
  const size = Number(totalSize ?? upstream.headers.get('content-length') ?? resolved.size ?? 0);
  const responseLength = Number(upstream.headers.get('content-length') ?? size);
  if (rangeHeader && (!size || !isRangeValid(rangeHeader, size))) {
    throw new HttpError(416, 'Requested range not satisfiable');
  }

  response.writeHead(rangeHeader ? 206 : 200, {
    'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    ...(responseLength ? { 'content-length': String(responseLength) } : {}),
    ...(rangeHeader ? { 'content-range': `bytes ${rangeHeader.slice(6)}/${size}` } : {}),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });

  if (request.method === 'HEAD') {
    await upstreamBody.cancel();
    response.end();
    return;
  }

  await upstreamBody.pipeTo(
    new WritableStream({
      write(chunk) {
        return new Promise<void>((resolve, reject) => {
          response.write(chunk, error => error ? reject(error) : resolve());
        });
      },
      close() { response.end(); },
      abort(reason) {
        void upstreamBody.cancel(reason).catch(() => undefined);
        response.destroy(errorFrom(reason));
      }
    })
  );
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
