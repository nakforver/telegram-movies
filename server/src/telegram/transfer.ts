import type { MovieRecord } from '../types.js';
import { uploadToR2 } from '../storage/r2.js';
import { telegramGatewayHeaders } from './base.js';
import { resolveTelegramFileUrl, TooLargeTelegramFileError } from './media.js';

export const telegramBotApiDownloadLimitBytes = 20 * 1024 * 1024;

export type TransferResult = {
  record: MovieRecord;
  transferred: boolean;
  reason?: string;
};

export async function transferTelegramMovieToR2(record: MovieRecord): Promise<TransferResult> {
  if (record.media_source === 'r2' && record.media_object_key) {
    return { record, transferred: true };
  }
  if (!record.telegram_file_id) {
    const next = unavailable(record, 'Telegram file reference is missing');
    return { record: next, transferred: false, reason: next.media_status_reason };
  }
  try {
    const resolved = await resolveTelegramFileUrl(record.telegram_file_id).catch(error => {
      throw withStage(error, 'Telegram getFile');
    });
    const selfHostedApi = Boolean((process.env.TELEGRAM_API_BASE ?? '').trim());
    if (!selfHostedApi && (resolved.size ?? 0) > telegramBotApiDownloadLimitBytes) {
      throw new TooLargeTelegramFileError('The Telegram video exceeds the 20 MB public Bot API download limit');
    }
    const upstream = await fetch(resolved.url, { headers: telegramGatewayHeaders() })
      .catch(error => { throw withStage(error, 'Telegram download'); });
    if (!upstream.ok || !upstream.body) throw new Error(`Telegram download failed (${upstream.status})`);
    const objectKey = `movies/${record.movie_id}.mp4`;
    const contentLength = resolved.size ?? Number(upstream.headers.get('content-length') ?? Number.NaN);
    await uploadToR2(objectKey, upstream.body, upstream.headers.get('content-type') ?? 'video/mp4', contentLength)
      .catch(error => { throw withStage(error, 'R2 upload'); });
    let next: MovieRecord = {
      ...record,
      media_source: 'r2',
      media_url: `r2://${process.env.R2_BUCKET ?? ''}/${objectKey}`,
      media_object_key: objectKey,
      media_status_reason: '',
      updated_at: new Date().toISOString()
    };
    next = await withTelegramThumbnail(next);
    return { record: next, transferred: true };
  } catch (error) {
    const reason = error instanceof TooLargeTelegramFileError
      ? 'The Telegram video exceeds the 20 MB public Bot API download limit'
      : error instanceof Error ? error.message : 'Telegram to R2 transfer failed';
    let next = unavailable(record, reason);
    next = await withTelegramThumbnail(next);
    return { record: next, transferred: false, reason };
  }
}

export async function withTelegramThumbnail(record: MovieRecord, options: { force?: boolean } = {}): Promise<MovieRecord> {
  if ((record.poster_url && !options.force) || !record.telegram_thumbnail_file_id) return record;
  const thumbnail = await transferTelegramThumbnailToR2(record).catch(() => null);
  if (!thumbnail) return record;
  const posterUrl = posterProxyUrl(record.movie_id);
  return {
    ...record,
    poster_url: posterUrl,
    backdrop_url: posterUrl,
    updated_at: new Date().toISOString()
  };
}

const maxThumbnailBytes = 8 * 1024 * 1024;

async function transferTelegramThumbnailToR2(record: MovieRecord): Promise<{ objectKey: string }> {
  const thumbnailId = requiredThumbnailId(record);
  const resolved = await resolveTelegramFileUrl(thumbnailId)
    .catch(error => { throw withStage(error, 'Telegram thumbnail getFile'); });
  const upstream = await fetch(resolved.url, { headers: telegramGatewayHeaders() })
    .catch(error => { throw withStage(error, 'Telegram thumbnail download'); });
  if (!upstream.ok || !upstream.body) throw new Error(`Telegram thumbnail download failed (${upstream.status})`);
  // Buffer the thumbnail (small: Telegram thumbs are typically < 200 KB) so the
  // R2 upload always has a known content length even when Telegram serves the
  // bytes with chunked encoding and no content-length header.
  const bytes = await readBounded(upstream.body, maxThumbnailBytes);
  await upstream.body.cancel().catch(() => undefined);
  const contentType = sniffImageContentType(bytes) ?? upstream.headers.get('content-type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error('Telegram thumbnail is not an image');
  const objectKey = thumbnailObjectKey(record.movie_id);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  await uploadToR2(objectKey, body, contentType, bytes.byteLength)
    .catch(error => { throw withStage(error, 'R2 thumbnail upload'); });
  return { objectKey };
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        total += value.byteLength;
        if (total > limit) throw new Error('Telegram thumbnail exceeds the size limit');
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sniffImageContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  return null;
}

function requiredThumbnailId(record: MovieRecord): string {
  const thumbnailId = record.telegram_thumbnail_file_id?.trim();
  if (!thumbnailId) throw new Error('Telegram thumbnail reference is missing');
  return thumbnailId;
}

export function thumbnailObjectKey(movieId: string): string {
  return `posters/${encodeURIComponent(movieId)}.jpg`;
}

export function posterProxyUrl(movieId: string): string {
  return `/api/posters/${encodeURIComponent(movieId)}`;
}

function withStage(error: unknown, stage: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return new Error(`${stage}: ${message}${cause}`);
}

function unavailable(record: MovieRecord, reason: string): MovieRecord {
  return {
    ...record,
    media_source: 'none',
    media_url: '',
    media_object_key: '',
    media_status_reason: reason,
    updated_at: new Date().toISOString()
  };
}
