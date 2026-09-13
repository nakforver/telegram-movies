import type { CatalogMovie, Category, MoviePage, PlaySource } from '../types';

interface ApiResponse<T> { success: boolean; data?: T; error?: string; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { ...(init?.headers ?? {}) }, credentials: 'same-origin' });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || !body.success || body.data === undefined) throw body.error ?? 'Request failed';
  return body.data;
}

export const api = {
  movies(params: Record<string, string | number | undefined> = {}): Promise<MoviePage> {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') search.set(key, String(value)); });
    return request(`/movies?${search}`);
  },
  movie(id: string): Promise<CatalogMovie & { episodes: CatalogMovie[] }> { return request(`/movies/${encodeURIComponent(id)}`); },
  categories(): Promise<Category[]> { return request('/categories'); },
  search(term: string, params: Record<string, string | undefined> = {}): Promise<MoviePage> {
    const search = new URLSearchParams({ q: term });
    Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value); });
    return request(`/search?${search}`);
  },
  episodes(movieId: string): Promise<CatalogMovie[]> { return request(`/episodes/${encodeURIComponent(movieId)}`); },
  play(id: string): Promise<PlaySource> { return request(`/play/${encodeURIComponent(id)}`); }
};
