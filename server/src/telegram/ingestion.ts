import type { MovieRecord } from '../types.js';

interface TelegramFile {
  file_id?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  thumbnail?: TelegramThumbnail;
}

interface TelegramThumbnail {
  file_id?: string;
  file_size?: number;
  mime_type?: string;
}

interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
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
    caption_entities?: TelegramEntity[];
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
  const caption = cleanTelegramText(post.caption ?? '', post.caption_entities ?? []);
  const filename = media.file_name?.replace(/\.[^.]+$/, '').trim() ?? '';
  const [captionTitle = '', ...descriptionLines] = caption.split('\n');
  const title = cleanTitle(captionTitle || filename || `Telegram movie ${telegramChatId}-${telegramMessageId}`).slice(0, 200);

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
    telegram_file_size: media.file_size,
    telegram_thumbnail_file_id: getThumbnail(post)?.file_id ?? '',
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

function getThumbnail(post: NonNullable<TelegramUpdate['channel_post']>): TelegramThumbnail | null {
  return post.video?.thumbnail ?? post.document?.thumbnail ?? null;
}

export function cleanTelegramText(text: string, entities: TelegramEntity[]): string {
  const hasFormatting = entities.some(entity =>
    entity.offset >= 0 &&
    entity.length >= 0 &&
    ['bold', 'italic', 'underline', 'strikethrough', 'spoiler', 'code', 'pre'].includes(entity.type)
  );
  if (hasFormatting) {
    const escaped = new Map<string, string>();
    let escapedIndex = 0;
    text = text
      .replace(/\\([\\_*~`|])/gu, (_, character: string) => {
        const placeholder = `\uE000${escapedIndex++}`;
        escaped.set(placeholder, character);
        return placeholder;
      })
      .replace(/(__)(.*?)\1/gu, '$2')
      .replace(/(\*\*\*|\*\*|\*)(.*?)\1/gu, '$2')
      .replace(/(__)(.*?)\1/gu, '$2')
      .replace(/(_)(.*?)\1/gu, '$2')
      .replace(/(~)(.*?)\1/gu, '$2')
      .replace(/(\|\|)(.*?)\1/gu, '$2')
      .replace(/(```)(.*?)\1/gu, '$2')
      .replace(/(`)(.*?)\1/gu, '$2');
    escaped.forEach((character, placeholder) => {
      text = text.replace(placeholder, character);
    });
  }
  return text
    .replace(/\\([\\_*[\]()~`>#+\-=|{}.!])/gu, '$1')
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '')
    .trim();
}

export function cleanTitle(title: string): string {
  let result = title.replace(/\s+/g, ' ').trim();
  while (/^[\p{P}\p{S}\p{C}]/u.test(result)) result = result.slice(1);
  while (/[\p{P}\p{S}\p{C}]$/u.test(result) && !result.endsWith('*')) result = result.slice(0, -1);
  return result;
}
