import { expect, test } from '@playwright/test';

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

test('player shows a clear message instead of a black area when media is too large', async ({ page }) => {
  const movieId = 'telegram--1004296358811-8';
  await page.route('**/api/play/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { movieId, title: 'Telegram movie', type: 'movie', season: null, episode: null, source: 'telegram', url: `/api/media/${movieId}?token=signed-token`, playable: true } })
    });
  });
  await page.route('**/api/media/**', async route => {
    expect(route.request().url()).toBe(`http://127.0.0.1:5173/api/media/${movieId}?token=signed-token`);
    await route.fulfill({ status: 413, body: 'Too large' });
  });

  await page.goto(`/player/${movieId}`);

  await expect(page.getByText('This video is too large for the current Telegram playback gateway. The video source must be moved to supported object storage or CDN hosting before it can be played.')).toBeVisible();
  await expect(page.locator('video.player')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '▶ Play' })).toHaveCount(0);
});
