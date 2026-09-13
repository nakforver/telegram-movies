
const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export function resolveTelegramFileUrl(fileId: string): Promise<{ url: string; size?: number; expiresAt: string }> {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
  return fetch(`${TELEGRAM_API}/bot${telegramBotToken}/getFile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId })
  })
    .then(async response => {
      const result = await response.json().catch(() => null) as { ok?: boolean; result?: TelegramFile; description?: string } | null;
      if (!response.ok || !result?.ok || !result.result?.file_path) {
        throw new Error(result?.description ?? `Telegram getFile request failed (${response.status})`);
      }
      return {
        url: new URL(result.result.file_path, `${TELEGRAM_API}/file/bot${telegramBotToken}/`).href,
        size: result.result.file_size,
        expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString()
      };
    });
}

export function isRangeValid(range: string | undefined, size: number): boolean {
  if (!range || !range.startsWith('bytes=')) return false;
  return range.slice(6).split(',').every(part => {
    const [start, end] = part.split('-');
    if (start === undefined) return false;
    if (start === '') return Number(end) < size;
    const startNumber = Number(start);
    if (!Number.isInteger(startNumber) || startNumber < 0 || startNumber >= size) return false;
    if (end === undefined || end === '') return true;
    const endNumber = Number(end);
    return Number.isInteger(endNumber) && endNumber >= startNumber && endNumber < size;
  });
}
