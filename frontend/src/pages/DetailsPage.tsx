import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { CatalogMovie } from '../types';
import { favorites } from '../services/storage';
import { useNavigate, useParams } from '../router';
import { backdropUrl, MovieImage, posterUrl } from '../components/MovieCard';

export default function DetailsPage() {
  const params = useParams<{ id: string }>();
  const [movie, setMovie] = useState<(CatalogMovie & { episodes: CatalogMovie[] })>();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => { api.movie(params.id).then(setMovie).catch(setError); }, [params.id]);
  if (error) return <div className="error">{error}</div>;
  if (!movie) return <div className="loading">Loading…</div>;
  const backdrop = backdropUrl(movie);
  const poster = posterUrl(movie);
  return (
    <>
      <div className="details-hero">{backdrop ? <MovieImage className="details-hero-image" src={backdrop} alt="" /> : <div className="hero-placeholder" aria-hidden="true"><span>🎬</span></div>}</div>
      <div className="details-body">
        <MovieImage className="details-poster" src={poster} alt={movie.title} />
        <div><h1>{movie.title}</h1>{movie.title_km && <div className="khmer">{movie.title_km}</div>}<div className="khmer">{movie.original_title}</div></div>
      </div>
      <div className="details-meta">
        <span className="pill">{movie.year}</span><span className="pill">{movie.genre}</span><span className="pill">{movie.category}</span>
        <span className="pill">⭐ {movie.rating ?? 'N/A'}</span><span className="pill">{movie.country}</span><span className="pill">{movie.duration ?? '-'} min</span>
      </div>
      <p className="description">{movie.description || 'No description available.'}</p>
      <button className="primary-button" onClick={() => navigate(movie.type === 'series' ? `/series/${movie.movie_id}` : `/player/${movie.movie_id}`)}>{movie.type === 'series' ? 'View Episodes' : '▶ Play'}</button>
      <button className="secondary-button" onClick={() => favorites.toggle({ id: movie.movie_id, title: movie.title, titleKm: movie.title_km, posterUrl: movie.poster_url, type: movie.type })}>❤️ Add to favorites</button>
    </>
  );
}
