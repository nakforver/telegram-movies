import type { CatalogStore } from '../domain/catalog.js';
import { normalizeMovie } from '../domain/normalize.js';
import type { Movie, MovieRecord } from '../types.js';
import { Cache } from './cache.js';

export class CatalogService {
  private readonly cache: Cache<Movie[]>;
  constructor(private store: CatalogStore, cacheTtlMs = 300_000) {
    this.cache = new Cache<Movie[]>(cacheTtlMs);
  }
  async list(force = false): Promise<Movie[]> {
    if (!force) {
      const cached = this.cache.get();
      if (cached) return cached;
    }
    const rows = await this.store.list();
    const movies = rows.map(normalizeMovie).filter((movie): movie is Movie => Boolean(movie));
    this.cache.set(movies);
    return movies;
  }
  async invalidate(): Promise<void> { this.cache.clear(); }
  async upsert(record: MovieRecord): Promise<MovieRecord> {
    const result = await this.store.upsert(record);
    await this.invalidate();
    return result;
  }
  async delete(movieId: string): Promise<void> {
    await this.store.delete(movieId);
    await this.invalidate();
  }
}
