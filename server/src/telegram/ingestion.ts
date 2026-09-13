import type { MovieRecord } from '../types.js';

interface TelegramFile {
  file_id?: string;
  file_name?: string;
  mime_type?: string;
}

export interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
  channel_post?: {
    chat?: { id?: number };
    message_id?: number;
    caption?: string;
    video?: TelegramFile;
    document?: TelegramFile;
    date?: number;
  };
}

export function telegramUpdateToMovie(update: TelegramUpdate): MovieRecord | null {
  const post = update.channel_post;
  if (!post?.chat?.id || !post.message_id) return null;

  const media = getVideo(post);
  if (!media?.file_id) return null;

  const telegramChatId = String(post.chat.id ?? '');
  const telegramMessageId = String(post.message_id ?? '');
  const caption = post.caption?.trim() ?? '';
  const filename = media.file_name?.replace(/\.[^.]+$/, '').trim() ?? '';
  const [captionTitle = '', ...descriptionLines] = caption.split('\n');
  const title = (captionTitle || filename || `Telegram movie ${telegramChatId}-${telegramMessageId}`).slice(0, 200);

  return {
    movie_id: `telegram-${telegramChatId}-${telegramMessageId}`,
    title,
    title_km: '',
    original_title: title,
    description: descriptionLines.join('\n').trim() || 'Uploaded from the Popmovies Telegram channel.',
    poster_url: '',
    backdrop_url: '',
    category: 'Movies',
    genre: '',
    year: '',
    country: '',
    duration: '',
    rating: '',
    type: 'movie',
    season: '',
    episode: '',
    telegram_chat_id: telegramChatId,
    telegram_message_id: telegramMessageId,
    telegram_file_id: media.file_id,
    status: 'published',
    created_at: new Date(post.date ? post.date * 1000 : Date.now()).toISOString(),
    updated_at: new Date().toISOString()
  };
}

function getVideo(post: NonNullable<TelegramUpdate['channel_post']>): TelegramFile | null {
  if (post.video?.file_id) return post.video;
  if (post.document?.file_id && post.document.mime_type?.startsWith('video/')) return post.document;
  return null;
}
