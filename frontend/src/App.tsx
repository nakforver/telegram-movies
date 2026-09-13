import { useEffect, useState } from 'react';
import { init, mountBackButton, restoreInitData, viewport } from '@telegram-apps/sdk-react';
import { Route, useLocation, useNavigate } from './router';
import BottomNavigation from './components/BottomNavigation';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import CategoriesPage from './pages/CategoriesPage';
import FavoritesPage from './pages/FavoritesPage';
import ProfilePage from './pages/ProfilePage';
import DetailsPage from './pages/DetailsPage';
import SeriesPage from './pages/SeriesPage';
import EpisodesPage from './pages/EpisodesPage';
import PlayerPage from './pages/PlayerPage';
import HistoryPage from './pages/HistoryPage';

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const telegram = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
    if (telegram?.initData) {
      try {
        init();
        restoreInitData();
        viewport.mount();
        mountBackButton();
      } catch (error) {
        console.warn('Telegram Mini App initialization failed', error);
      }
    }
    setReady(true);
  }, []);
  return (
    <main className="app-shell">
      {!ready ? <div className="loading">Loading…</div> : (
        <>
          <Route path="/"><HomePage /></Route>
          <Route path="/search"><SearchPage /></Route>
          <Route path="/categories"><CategoriesPage /></Route>
          <Route path="/favorites"><FavoritesPage /></Route>
          <Route path="/profile"><ProfilePage /></Route>
          <Route path="/history"><HistoryPage /></Route>
          <Route path="/movies/:id"><DetailsPage /></Route>
          <Route path="/series/:id"><SeriesPage /></Route>
          <Route path="/series/:id/episodes"><EpisodesPage /></Route>
          <Route path="/player/:id"><PlayerPage /></Route>
        </>
      )}
      <BottomNavigation />
    </main>
  );
}
