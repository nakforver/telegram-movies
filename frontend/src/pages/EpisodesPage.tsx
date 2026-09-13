import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { CatalogMovie } from '../types';
import { useNavigate, useParams } from '../router';

export default function EpisodesPage() {
  const params = useParams<{ id: string }>();
  const [episodes, setEpisodes] = useState<CatalogMovie[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => { api.episodes(params.id).then(setEpisodes).catch(setError); }, [params.id]);
  if (error) return <div className="error">{error}</div>;
  return <><h1 className="page-title">Episodes</h1>{episodes.length ? <div className="grid">{episodes.map(episode => <button className="category-card" key={episode.movie_id} onClick={() => navigate(`/player/${episode.movie_id}`)}><strong>E{String(episode.episodeNumber).padStart(2, '0')} {episode.title}</strong><span>Season {episode.seasonNumber}</span></button>)}</div> : <div className="empty">No episodes found.</div>}</>;
}
