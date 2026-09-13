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
    const resolved = await resolveTelegramFileUrl(record.telegram_file_id);
    if ((resolved.size ?? 0) > telegramBotApiDownloadLimitBytes) {
      throw new TooLargeTelegramFileError('The Telegram video exceeds the 20 MB public Bot API download limit');
    }
    const upstream = await fetch(resolved.url, { headers: telegramGatewayHeaders() });
    if (!upstream.ok || !upstream.body) throw new Error(`Telegram download failed (${upstream.status})`);
    const objectKey = `movies/${record.movie_id}.mp4`;
    const contentLength = resolved.size ?? Number(upstream.headers.get('content-length') ?? Number.NaN);
    await uploadToR2(objectKey, upstream.body, upstream.headers.get('content-type') ?? 'video/mp4', contentLength);
    const next: MovieRecord = {
      ...record,
      media_source: 'r2',
      media_url: `r2://${process.env.R2_BUCKET ?? ''}/${objectKey}`,
      media_object_key: objectKey,
      media_status_reason: '',
      updated_at: new Date().toISOString()
    };
    return { record: next, transferred: true };
  } catch (error) {
    const reason = error instanceof TooLargeTelegramFileError
      ? 'The Telegram video exceeds the 20 MB public Bot API download limit'
      : error instanceof Error ? error.message : 'Telegram to R2 transfer failed';
    const next = unavailable(record, reason);
    return { record: next, transferred: false, reason };
  }
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
