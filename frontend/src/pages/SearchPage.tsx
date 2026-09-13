import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Category, MoviePage } from '../types';
import MovieCard from '../components/MovieCard';
import { useDebouncedValue } from '../hooks';
import { useNavigate, useSearchParams } from '../router';

export default function SearchPage() {
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('');
  const searchParams = useSearchParams();
  const [result, setResult] = useState<MoviePage>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const debounced = useDebouncedValue(term);
  const navigate = useNavigate();
  useEffect(() => {
    const categoryParam = searchParams.get('category');
    const typeParam = searchParams.get('type');
    const sortParam = searchParams.get('sort');
    if (categoryParam) setCategory(categoryParam);
    if (typeParam) setType(typeParam);
    if (sortParam) setSort(sortParam);
    api.categories().then(setCategories).catch(() => setCategories([]));
  }, [searchParams]);
  useEffect(() => {
    const query = { category, type, sort };
    api.search(debounced, query).then(setResult).catch(setError);
  }, [debounced, category, type]);
  return (
    <>
      <h1 className="page-title">Search</h1>
      <div className="search-form">
        <input value={term} onChange={event => setTerm(event.target.value)} placeholder="Search title, Khmer title, original title, year, genre" />
        <div className="filter-row">
          <select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select>
          <select value={type} onChange={event => setType(event.target.value)}><option value="">All types</option><option value="movie">Movies</option><option value="series">Series</option></select>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (result.items.length ? <div className="grid">{result.items.map(movie => <MovieCard key={movie.movie_id} movie={movie} onOpen={navigate} />)}</div> : <div className="empty">No movies found.</div>)}
    </>
  );
}
