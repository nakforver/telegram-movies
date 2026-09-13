import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { CatalogMovie, MoviePage } from '../types';
import MovieCard from '../components/MovieCard';
import Section from '../components/Section';
import Skeleton from '../components/Skeleton';
import { useNavigate } from '../router';

interface HomeData { trending: MoviePage; recent: MoviePage; featured: MoviePage; movies: MoviePage; series: MoviePage; }

export default function HomePage() {
  const [data, setData] = useState<HomeData>();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    Promise.all([
      api.movies({ sort: 'trending', pageSize: 8 }), api.movies({ sort: 'recent', pageSize: 8 }),
      api.movies({ sort: 'featured', pageSize: 4 }), api.movies({ type: 'movie', pageSize: 8 }), api.movies({ type: 'series', pageSize: 8 })
    ]).then(([trending, recent, featured, movies, series]) => setData({ trending, recent, featured, movies, series })).catch(setError);
  }, []);
  if (error) return <div className="error">{error}</div>;
  if (!data) return <><Skeleton height={300} /><div style={{height:16}} /><Skeleton height={180} /></>;
  const catalogIsEmpty = [data.trending, data.recent, data.featured, data.movies, data.series].every(section => section.total === 0);
  return (
    <>
      <h1 className="page-title">Movie Library</h1>
      {catalogIsEmpty && <div className="status">The catalog is empty. Add movies in Google Sheets, or use the section links below to browse.</div>}
      <Section title="🔥 Trending" onTitleClick={() => navigate('/search?sort=trending')} action={seeAll('/search?sort=trending')}>
        <div className="hero-grid">{data.trending.items.map(movie => hero(movie))}</div>
      </Section>
      <Section title="🆕 Recently Added" onTitleClick={() => navigate('/search?sort=recent')} action={seeAll('/search?sort=recent')}>
        <div className="grid">{data.recent.items.map(movie => <MovieCard key={movie.movie_id} movie={movie} onOpen={navigate} />)}</div>
      </Section>
      <Section title="⭐ Featured" onTitleClick={() => navigate('/search?sort=featured')} action={seeAll('/search?sort=featured')}>
        <div className="hero-grid">{data.featured.items.map(movie => hero(movie))}</div>
      </Section>
      <Section title="🎬 Movies" onTitleClick={() => navigate('/search?type=movie')} action={seeAll('/search?type=movie')}>
        <div className="grid">{data.movies.items.map(movie => <MovieCard key={movie.movie_id} movie={movie} onOpen={navigate} />)}</div>
      </Section>
      <Section title="📺 Series" onTitleClick={() => navigate('/search?type=series')} action={seeAll('/search?type=series')}>
        <div className="grid">{data.series.items.map(movie => <MovieCard key={movie.movie_id} movie={movie} onOpen={navigate} />)}</div>
      </Section>
    </>
  );

  function seeAll(path: string) {
    return <button onClick={() => navigate(path)}>See all</button>;
  }

  function hero(movie: CatalogMovie) {
    return (
      <article
        key={movie.movie_id}
        className="hero-card"
        role="button"
        tabIndex={0}
        aria-label={`Open ${movie.title}`}
        onClick={() => navigate(movie.type === 'series' ? `/series/${movie.movie_id}` : `/movies/${movie.movie_id}`)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') navigate(movie.type === 'series' ? `/series/${movie.movie_id}` : `/movies/${movie.movie_id}`);
        }}
      >
        <img src={movie.backdrop_url || movie.poster_url || ''} alt="" loading="lazy" />
        <div className="hero-content"><span className="pill">{movie.type === 'series' ? 'Series' : 'Movie'}</span><strong>{movie.title}</strong>{movie.title_km && <div className="khmer">{movie.title_km}</div>}</div>
      </article>
    );
  }
}
