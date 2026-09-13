export interface MovieRecord {
  movie_id: string;
  title: string;
  title_km?: string;
  original_title?: string;
  description?: string;
  poster_url?: string;
  backdrop_url?: string;
  category?: string;
  genre?: string;
  year?: string;
  country?: string;
  duration?: string;
  rating?: string;
  type: 'movie' | 'series';
  season?: string;
  episode?: string;
  telegram_chat_id?: string;
  telegram_message_id?: string;
  telegram_file_id?: string;
  telegram_file_size?: number;
  status: 'published' | 'draft';
  created_at?: string;
  updated_at?: string;
  telegram_file_name?: string;
  media_source?: 'r2' | 'none';
  media_url?: string;
  media_object_key?: string;
  media_status_reason?: string;
}


export interface Movie extends MovieRecord {
  seasonNumber: number | null;
  episodeNumber: number | null;
  durationMinutes: number | null;
  ratingValue: number | null;
  yearValue: number | null;
  hasTelegramReference: boolean;
}

export interface MoviePage {
  items: Movie[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Category {
  name: string;
  count: number;
}

export interface PlaySource {
  movieId: string;
  title: string;
  titleKm?: string;
  type: 'movie' | 'series';
  season: number | null;
  episode: number | null;
  telegramChatId?: string;
  telegramMessageId?: string;
  telegramFileId?: string;
  mediaObjectKey?: string;
  source: 'r2' | 'none';
  url?: string;
  expiresAt?: string;
  playable: boolean;
  reason?: string;
}
