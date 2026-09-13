import { history } from '../services/storage';
import { useNavigate } from '../router';

export default function HistoryPage() {
  const items = history.list();
  const navigate = useNavigate();
  return <><h1 className="page-title">🕘 Watch History</h1>{items.length ? <div className="grid">{items.map(item => <button className="category-card" key={item.id} onClick={() => navigate(`/player/${item.id}`)}><strong>{item.title}</strong><span>{Math.round(item.progress)}% watched</span></button>)}</div> : <div className="empty">No watch history yet.</div>}</>;
}
