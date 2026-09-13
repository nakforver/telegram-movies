const defaultTelegramApi = 'https://api.telegram.org';

export function telegramApiBase(): string {
  const configured = (process.env.TELEGRAM_API_BASE ?? '').trim() || defaultTelegramApi;
  const url = new URL(configured);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('TELEGRAM_API_BASE must use HTTP or HTTPS');
  }
  return configured.replace(/\/+$/, '');
}
