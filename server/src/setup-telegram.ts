import { miniAppUrl, telegramChatId } from './config.js';
import { setMiniAppButton, setMyCommands, sendMessage, setWebhook } from './telegram/api.js';
import { telegramWebhookSecret } from './config.js';

async function main(): Promise<void> {
  await setMyCommands();
  try {
    await setMiniAppButton();
  } catch (error) {
    console.warn(`Mini App menu button unavailable: ${error instanceof Error ? error.message : error}`);
  }
  if (miniAppUrl && telegramWebhookSecret) {
    await setWebhook(`${miniAppUrl.replace(/\/$/, '')}/api/telegram/webhook`, telegramWebhookSecret);
  }
  if (telegramChatId) await sendMessage(telegramChatId, `Movie Mini App is ready.\n\n${miniAppUrl || ''}`);
  console.log('Telegram bot configuration updated.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
