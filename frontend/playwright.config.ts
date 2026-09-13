import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'cd .. && PORT=18080 npm run dev --workspace server',
      url: 'http://127.0.0.1:18080/api/health',
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: 'cd .. && BACKEND_PORT=18080 npm run dev --workspace frontend',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 30_000
    }
  ]
});
