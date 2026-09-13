import type { Category, Movie, MoviePage, MovieRecord, PlaySource } from '../types.js';

export interface CatalogQuery {
  page?: number;
  pageSize?: number;
  type?: 'movie' | 'series';
  category?: string;
  genre?: string;
  year?: string;
  sort?: 'recent' | 'trending' | 'featured' | 'title';
  includeDrafts?: boolean;
}

export interface CatalogStore {
  list(): Promise<MovieRecord[]>;
  upsert(record: MovieRecord): Promise<MovieRecord>;
  delete(movieId: string): Promise<void>;
}

const published = (movie: Movie) => movie.status === 'published';
const byRecent = (a: Movie, b: Movie) => date(b.created_at) - date(a.created_at);
const byTitle = (a: Movie, b: Movie) => a.title.localeCompare(b.title);
const byTrending = (a: Movie, b: Movie) => {
  const trendingValue = (movie: Movie) => (movie.ratingValue ?? 0) + date(movie.created_at) / 86_400_000_000;
  return trendingValue(b) - trendingValue(a);
};
function date(value: string | undefined): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}
function pagination(page: number, pageSize: number) {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  return { skip: (safePage - 1) * safePageSize, safePage, safePageSize };
}

export function normalizeQuery(searchParams: URLSearchParams): CatalogQuery {
  const type = searchParams.get('type');
  const sort = searchParams.get('sort');
  return {
    page: Number(searchParams.get('page') ?? 1),
    pageSize: Number(searchParams.get('pageSize') ?? 24),
    type: type === 'movie' || type === 'series' ? type : undefined,
    category: searchParams.get('category')?.trim() || undefined,
    genre: searchParams.get('genre')?.trim() || undefined,
    year: searchParams.get('year')?.trim() || undefined,
    sort: sort === 'trending' || sort === 'featured' || sort === 'title' ? sort : 'recent',
    includeDrafts: searchParams.get('includeDrafts') === 'true'
  };
}

export function queryCatalog(items: Movie[], query: CatalogQuery): MoviePage {
  const filtered = items.filter(movie => {
    if (!query.includeDrafts && !published(movie)) return false;
    if (movie.type === 'series' && movie.episodeNumber !== null) return false;
    if (query.type && movie.type !== query.type) return false;
    if (query.category && movie.category?.toLowerCase() !== query.category.toLowerCase()) return false;
    if (query.genre && !movie.genre?.toLowerCase().includes(query.genre.toLowerCase())) return false;
    if (query.year && movie.year !== query.year) return false;
    return true;
  }).sort(query.sort === 'title' ? byTitle : query.sort === 'featured' || query.sort === 'trending' ? byTrending : byRecent);
  const { skip, safePage, safePageSize } = pagination(query.page ?? 1, query.pageSize ?? 24);
  return {
    items: filtered.slice(skip, skip + safePageSize),
    total: filtered.length,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.ceil(filtered.length / safePageSize) || 1
  };
}

export function publicMovie(movie: Movie): Movie {
  return movie;
}

export function searchMovies(items: Movie[], term: string, query: CatalogQuery = {}): MoviePage {
  const needle = term.trim().toLowerCase();
  const matches = needle
    ? items.filter(movie => published(movie) && [movie.title, movie.title_km, movie.original_title, movie.genre, movie.year]
        .some(value => (value ?? '').toLowerCase().includes(needle)))
    : items.filter(published);
  return queryCatalog(matches, { ...query, sort: query.sort ?? 'recent' });
}

export function categories(items: Movie[]): Category[] {
  const map = new Map<string, number>();
  for (const movie of items.filter(published)) {
    const name = movie.category?.trim();
    if (name) map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export function episodes(items: Movie[], movieId: string): Movie[] {
  const parent = items.find(movie => movie.movie_id === movieId && movie.type === 'series');
  if (!parent) return [];
  const season = parent.seasonNumber;
  return items
    .filter(movie => movie.type === 'series' && movie.title === parent.title && (!season || movie.seasonNumber === season) && movie.episodeNumber !== null && movie.movie_id !== parent.movie_id)
    .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0));
}

export function findEpisode(items: Movie[], movieId: string): Movie | undefined {
  return items.find(movie => movie.movie_id === movieId && movie.status === 'published');
}

export function toPlaySource(movie: Movie | undefined): PlaySource | null {
  if (!movie) return null;
  if (movie.status !== 'published') {
    return { ...base(movie), source: 'none', playable: false, reason: 'Movie is not published' };
  }
  if (!movie.telegram_chat_id || !movie.telegram_message_id) {
    return { ...base(movie), source: 'none', playable: false, reason: 'Telegram chat/message reference is missing' };
  }
  return {
    ...base(movie),
    telegramChatId: movie.telegram_chat_id,
    telegramMessageId: movie.telegram_message_id,
    telegramFileId: movie.telegram_file_id || undefined,
    source: 'none',
    playable: false,
    reason: 'Playback requires a configured media origin; Telegram metadata alone cannot be played by the browser'
  };
}

function base(movie: Movie) {
  return {
    movieId: movie.movie_id,
    title: movie.title,
    titleKm: movie.title_km,
    type: movie.type,
    season: movie.seasonNumber,
    episode: movie.episodeNumber
  };
}
