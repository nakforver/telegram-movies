import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Category } from '../types';
import { useNavigate } from '../router';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => { api.categories().then(setCategories).catch(setError); }, []);
  if (error) return <div className="error">{error}</div>;
  return (
    <>
      <h1 className="page-title">Categories</h1>
      {categories.length
        ? <div className="categories-grid">{categories.map(item => <button className="category-card" key={item.name} onClick={() => navigate(`/search?category=${encodeURIComponent(item.name)}`)}><strong>{item.name}</strong><span>{item.count} titles</span></button>)}</div>
        : <div className="empty">No categories yet.</div>}
    </>
  );
}
