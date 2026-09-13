const env = process.env;

export const isProduction = env.NODE_ENV === 'production';
export const port = Number(env.PORT ?? 8080);
export const adminSecret = env.ADMIN_SECRET ?? '';
export const frontendUrl = env.FRONTEND_URL ?? '';
export const telegramBotToken = env.TELEGRAM_BOT_TOKEN ?? '';
export const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET ?? '';
export const telegramChatId = env.TELEGRAM_CHAT_ID ?? '';
export const miniAppUrl = env.MINI_APP_URL ?? '';
export const googleSpreadsheetId = env.GOOGLE_SPREADSHEET_ID ?? '';
export const googleServiceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '';
export const googlePrivateKey = env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? '';
export const cacheTtlMs = Number(env.CACHE_TTL_MS ?? 300_000);
