import { useLocation, useNavigate } from '../router';

const items = [
  { path: '/', label: 'Home', icon: '🏠' },
  { path: '/search', label: 'Search', icon: '🔍' },
  { path: '/categories', label: 'Categories', icon: '📚' },
  { path: '/favorites', label: 'Favorites', icon: '❤️' },
  { path: '/profile', label: 'Profile', icon: '👤' }
];

export default function BottomNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <nav className="bottom-nav">
      {items.map(item => (
        <button key={item.path} className={location === item.path ? 'active' : ''} onClick={() => navigate(item.path)}>
          <span>{item.icon}</span><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
