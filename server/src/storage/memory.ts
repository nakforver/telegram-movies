import type { CatalogStore } from '../domain/catalog.js';
import type { MovieRecord } from '../types.js';

export class MemoryStore implements CatalogStore {
  constructor(private rows: MovieRecord[] = []) {}
  async list(): Promise<MovieRecord[]> { return structuredClone(this.rows); }
  async upsert(record: MovieRecord): Promise<MovieRecord> {
    const index = this.rows.findIndex(row => row.movie_id === record.movie_id);
    const next = structuredClone(record);
    if (index >= 0) this.rows[index] = next; else this.rows.push(next);
    return structuredClone(next);
  }
  async delete(movieId: string): Promise<void> {
    this.rows = this.rows.filter(row => row.movie_id !== movieId);
  }
}
