import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { CatalogMovie } from '../types';
import { useNavigate, useParams } from '../router';

export default function SeriesPage() {
  const params = useParams<{ id: string }>();
  const [series, setSeries] = useState<CatalogMovie & { episodes: CatalogMovie[] }>();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => { api.movie(params.id).then(setSeries).catch(setError); }, [params.id]);
  if (error) return <div className="error">{error}</div>;
  if (!series) return <div className="loading">Loading…</div>;
  const seasons = [...new Set(series.episodes.map(episode => episode.seasonNumber).filter(Boolean))] as number[];
  return <><h1 className="page-title">{series.title}</h1>{seasons.map(season => <section className="section" key={season}><h2>Season {season}</h2><div className="grid">{series.episodes.filter(episode => episode.seasonNumber === season).map(episode => <button className="category-card" key={episode.movie_id} onClick={() => navigate(`/player/${episode.movie_id}`)}><strong>Episode {episode.episodeNumber}</strong><span>{episode.title}</span></button>)}</div></section>)}{!seasons.length && <div className="empty">No episodes registered yet.</div>}</>;
}
