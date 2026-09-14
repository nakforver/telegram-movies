import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Telegram', {
      value: {
        WebApp: {
          initDataUnsafe: {},
          initData: '',
          ready: () => undefined,
          expand: () => undefined,
          version: '8.0',
          platform: 'unknown'
        }
      },
      configurable: true
    });
  });
});

test('mobile navigation changes the active route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Movie Library' })).toBeVisible();

  const routes = [
    { label: 'Search', path: '/search', title: 'Search' },
    { label: 'Categories', path: '/categories', title: 'Categories' },
    { label: 'Favorites', path: '/favorites', title: 'Favorites' },
    { label: 'Profile', path: '/profile', title: 'Profile' },
    { label: 'Home', path: '/', title: 'Movie Library' }
  ];

  for (const route of routes) {
    await page.locator('.bottom-nav').getByRole('button').filter({ hasText: route.label }).first().click();
    await expect(page).toHaveURL(new RegExp(`${route.path.replace('/', '\\/')}(\\?.*)?$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(route.title);
  }
});

test('home section links navigate to filtered search pages', async ({ page }) => {
  const sections = [
    { title: '🔥 Trending', path: '\\?sort=trending' },
    { title: '🆕 Recently Added', path: '\\?sort=recent' },
    { title: '⭐ Featured', path: '\\?sort=featured' },
    { title: '🎬 Movies', path: '\\?type=movie' },
    { title: '📺 Series', path: '\\?type=series' }
  ];

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Movie Library' })).toBeVisible();

  for (const section of sections) {
    await page.getByRole('button', { name: section.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`https?:\\/\\/127\\.0\\.0\\.1:5173\\/search${section.path}$`));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Movie Library' })).toBeVisible();
  }
});

test('home See All links navigate to filtered search pages', async ({ page }) => {
  const links = [
    { title: '🔥 Trending', path: '\\?sort=trending' },
    { title: '🆕 Recently Added', path: '\\?sort=recent' },
    { title: '⭐ Featured', path: '\\?sort=featured' },
    { title: '🎬 Movies', path: '\\?type=movie' },
    { title: '📺 Series', path: '\\?type=series' }
  ];

  for (const link of links) {
    await page.goto('/');
       await page.locator('.section').filter({ has: page.getByRole('button', { name: link.title }) }).getByRole('button', { name: 'See all' }).click();
    await expect(page).toHaveURL(new RegExp(`https?:\\/\\/127\\.0\\.0\\.1:5173\\/search${link.path}$`));
  }
});

test('profile buttons navigate to history and favorites', async ({ page }) => {
  await page.goto('/profile');
  await page.getByRole('button', { name: '🕘 Watch History' }).click();
  await expect(page).toHaveURL(/\/history$/);
  await page.getByRole('button', { name: '❤️ Favorites' }).click();
  await expect(page).toHaveURL(/\/favorites$/);
});

test('empty catalog renders a clear empty state and search results message', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/The catalog is empty/i)).toBeVisible();
  await page.locator('.bottom-nav').getByRole('button').filter({ hasText: 'Search' }).first().click();
  await expect(page).toHaveURL(/\/search(\?.*)?$/);
  await expect(page.getByText('No movies found.')).toBeVisible();
});

test('home cards and heroes use generated R2 posters and readable generic titles', async ({ page }) => {
  const movieId = 'telegram--1004296358811-21';
  await page.route('**/api/posters/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
  }));
  await page.route('**/api/movies*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { items: [{
        movie_id: movieId, title: `Telegram movie ${movieId}`, type: 'movie', status: 'published',
        media_source: 'r2', media_object_key: `movies/${movieId}.mp4`, created_at: '2026-01-01T00:00:00Z'
      }], total: 1, page: 1, pageSize: 8, totalPages: 1 } })
    });
  });

  await page.goto('/');

  await expect(page.locator('.movie-card .poster').first()).toHaveAttribute('src', `/api/posters/${movieId}`);
  await expect(page.locator('.hero-card .hero-image').first()).toHaveAttribute('src', `/api/posters/${movieId}`);
  await expect(page.getByText(`Telegram movie ${movieId}`).first()).toBeVisible();
});

test('home fallback is shown when a poster proxy request fails', async ({ page }) => {
  await page.route('**/api/movies*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { items: [{
        movie_id: 'r2-movie', title: 'R2 movie', type: 'movie', status: 'published',
        media_source: 'r2', created_at: '2026-01-01T00:00:00Z'
      }], total: 1, page: 1, pageSize: 8, totalPages: 1 } })
    });
  });
  await page.route('**/api/posters/**', route => route.fulfill({ status: 404, body: 'Not found' }));

  await page.goto('/');

  const poster = page.locator('.movie-card .poster').first();
  await expect(poster).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(poster).toHaveAttribute('src', /No%20Poster/);
  await expect(poster).not.toContainText('404');
});

test('player renders an HTML5 video for a playable R2 source', async ({ page }) => {
  const movieId = 'r2-movie';
  await page.route('**/api/play/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { movieId, title: 'R2 movie', type: 'movie', season: null, episode: null, source: 'r2', url: `/api/media/${movieId}?token=signed-token`, playable: true } })
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, 'onerror', { value: null, writable: true });
  });
  await page.route('**/api/media/**', async route => {
    expect(route.request().url()).toBe(`http://127.0.0.1:5173/api/media/${movieId}?token=signed-token`);
    const sample = await readFile(fileURLToPath(new URL('fixtures/sample.mp4', import.meta.url)));
    await route.fulfill({ status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(sample.byteLength) }, body: sample });
  });

  await page.goto(`/player/${movieId}`);

  const video = page.locator('video.player');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute('controls');
  await expect(video).toHaveAttribute('playsinline');
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect(video).toHaveAttribute('src', `/api/media/${movieId}?token=signed-token`);
});

test('player shows a clear message instead of a black area when transfer is unavailable', async ({ page }) => {
  const movieId = 'telegram--1004296358811-8';
  await page.route('**/api/play/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { movieId, title: 'Telegram movie', type: 'movie', season: null, episode: null, source: 'none', url: `/api/media/${movieId}?token=signed-token`, playable: true, reason: 'This video is too large for automatic Telegram transfer. The video source must be moved to supported object storage or CDN hosting.' } })
    });
  });
  await page.route('**/api/media/**', async route => {
    expect(route.request().url()).toBe(`http://127.0.0.1:5173/api/media/${movieId}?token=signed-token`);
    await route.fulfill({ status: 409, body: 'Transfer unavailable' });
  });

  await page.goto(`/player/${movieId}`);

  await expect(page.getByText('This video is too large for automatic Telegram transfer. The video source must be moved to supported object storage or CDN hosting.')).toBeVisible();
  await expect(page.locator('video.player')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '▶ Play' })).toHaveCount(0);
});
