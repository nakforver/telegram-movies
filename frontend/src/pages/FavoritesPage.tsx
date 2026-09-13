import { useEffect, useState } from 'react';
import { favorites, type FavoriteMovie } from '../services/storage';
import { useNavigate } from '../router';

export default function FavoritesPage() {
  const [items, setItems] = useState<FavoriteMovie[]>([]);
  const navigate = useNavigate();
  useEffect(() => setItems(favorites.list()), []);
  return <><h1 className="page-title">Favorites</h1>{items.length ? <div className="grid">{items.map(item => <button className="category-card" key={item.id} onClick={() => navigate(item.type === 'series' ? `/series/${item.id}` : `/movies/${item.id}`)}><strong>{item.title}</strong><span>{item.titleKm ?? 'Favorite'}</span></button>)}</div> : <div className="empty">No favorites yet.</div>}</>;
}
