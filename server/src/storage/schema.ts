export const SHEET_FIELDS = [
  'movie_id', 'title', 'title_km', 'original_title', 'description', 'poster_url', 'backdrop_url',
  'category', 'genre', 'year', 'country', 'duration', 'rating', 'type', 'season', 'episode',
  'telegram_chat_id', 'telegram_message_id', 'telegram_file_id', 'telegram_file_size', 'status', 'created_at', 'updated_at',
  'media_source', 'media_url', 'media_object_key', 'media_status_reason',
  'telegram_thumbnail_file_id'
] as const;

export const LEGACY_SHEET_FIELD_SETS = [
  SHEET_FIELDS.slice(0, 22),
  SHEET_FIELDS.slice(0, 27),
  [
    'movie_id', 'title', 'title_km', 'original_title', 'description', 'poster_url', 'backdrop_url',
    'category', 'genre', 'year', 'country', 'duration', 'rating', 'type', 'season', 'episode',
    'telegram_chat_id', 'telegram_message_id', 'telegram_file_id', 'status', 'created_at', 'updated_at'
  ]
] as const;
