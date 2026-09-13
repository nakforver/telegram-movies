import type { Movie } from '../../server/src/types';

export type CatalogMovie = Movie;
export interface MoviePage { items: CatalogMovie[]; total: number; page: number; pageSize: number; totalPages: number; }
export interface Category { name: string; count: number; }
export interface PlaySource { movieId: string; title: string; titleKm?: string; type: 'movie' | 'series'; season: number | null; episode: number | null; url?: string; mediaObjectKey?: string; telegramChatId?: string; telegramMessageId?: string; telegramFileId?: string; playable: boolean; reason?: string; }
