import { telegramBotToken } from '../config.js';
import { telegramApiBase, telegramGatewayHeaders } from './base.js';

const base = () => telegramApiBase();

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`${base()}/bot${telegramBotToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...telegramGatewayHeaders() },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.description ?? `Telegram request failed (${response.status})`);
  return result.result as T;
}

export function setMiniAppButton(text = '🎬 Open Movie App') {
  return call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url: miniAppUrl() } } });
}

export function setWebhook(url: string, secretToken: string) {
  return call('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message', 'channel_post'] });
}

export function setMyCommands() {
  return call('setMyCommands', { commands: [
    { command: 'start', description: 'Open the movie library' },
    { command: 'movies', description: 'Browse movies' },
    { command: 'search', description: 'Search movies' },
    { command: 'help', description: 'Show help' }
  ] });
}

export function sendMessage(chatId: string, text: string, miniAppUrl?: string) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: miniAppUrl ? {
      inline_keyboard: [[{ text: '🎬 Open Movie App', web_app: { url: miniAppUrl } }]]
    } : undefined
  });
}

export function getFile(fileId: string) {
  return call<{ file_id: string; file_unique_id: string; file_size?: number; file_path?: string }>('getFile', { file_id: fileId });
}

function miniAppUrl(): string {
  const url = process.env.MINI_APP_URL;
  if (!url) throw new Error('MINI_APP_URL is not configured');
  return url;
}
