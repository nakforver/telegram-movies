export interface FavoriteMovie { id: string; title: string; titleKm?: string; posterUrl?: string; type: 'movie' | 'series'; }
export interface HistoryMovie extends FavoriteMovie { progress: number; updatedAt: string; }

const favoritesKey = 'telegram-movies:favorites';
const historyKey = 'telegram-movies:history';
const maxItems = 100;

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T ?? fallback; } catch { return fallback; }
}
function write<T>(key: string, value: T): void { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function unique<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map(item => [key(item), item])).entries()].map(([, item]) => item);
}

export const favorites = {
  list: () => read<FavoriteMovie[]>(favoritesKey, []),
  has: (id: string) => favorites.list().some(movie => movie.id === id),
  toggle: (movie: FavoriteMovie) => {
    const next = favorites.has(movie.id) ? favorites.list().filter(item => item.id !== movie.id) : [movie, ...favorites.list()];
    write(favoritesKey, unique(next, item => item.id).slice(0, maxItems));
    return favorites.has(movie.id);
  }
};

export const history = {
  list: () => read<HistoryMovie[]>(historyKey, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  save: (movie: FavoriteMovie, progress: number) => {
    const next = [{ ...movie, progress, updatedAt: new Date().toISOString() }, ...history.list()];
    write(historyKey, unique(next, item => item.id).slice(0, maxItems));
  },
  continueWatching: () => history.list().filter(item => item.progress > 0 && item.progress < 98).slice(0, 12)
};
