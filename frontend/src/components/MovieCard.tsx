import type { CatalogMovie } from '../types';
import { favorites } from '../services/storage';

export default function MovieCard({ movie, onOpen }: { movie: CatalogMovie; onOpen: (id: string) => void }) {
  const detailsPath = movie.type === 'series' ? `/series/${movie.movie_id}` : `/movies/${movie.movie_id}`;
  return (
    <article
      className="movie-card"
      role="button"
      tabIndex={0}
      aria-label={`Open ${movie.title}`}
      onClick={() => onOpen(detailsPath)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpen(detailsPath); }}
    >
      <img className="poster" src={poster(movie)} alt={movie.title} loading="lazy" />
      <div className="movie-info">
        <strong>{movie.title}</strong>
        {movie.title_km && <span className="khmer">{movie.title_km}</span>}
        <span className="meta">{[movie.year, movie.genre, movie.rating].filter(Boolean).join(' • ')}</span>
      </div>
      <button className="favorite" aria-label="Toggle favorite" onClick={event => {
        event.stopPropagation();
        favorites.toggle({ id: movie.movie_id, title: movie.title, titleKm: movie.title_km, posterUrl: movie.poster_url, type: movie.type });
      }}>❤️</button>
    </article>
  );
}

function poster(movie: CatalogMovie): string {
  return movie.poster_url || 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#151822"/><text x="50%" y="50%" fill="#5b6478" font-size="22" text-anchor="middle">No Poster</text></svg>');
}
