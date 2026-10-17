import { defineConfig, devices } from '@playwright/test';

// E2E runs against the *production build* (service worker included) on its own ports and database,
// so it never touches the dev database.
const API_PORT = 3012;
const WEB_PORT = 5184;
const DB = `mongodb://127.0.0.1:27017/gateguard_v2_e2e`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE ?? `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE
    ? undefined
    : [
        {
          command: `cd ../server && SEED_RESET=true MONGODB_URI=${DB} npx tsx src/seed.ts && MONGODB_URI=${DB} PORT=${API_PORT} npx tsx src/index.ts`,
          url: `http://localhost:${API_PORT}/api/health`,
          timeout: 60_000,
          reuseExistingServer: false,
        },
        {
          command: `npx vite build && API_TARGET=http://localhost:${API_PORT} PORT_WEB=${WEB_PORT} npx vite preview`,
          url: `http://localhost:${WEB_PORT}`,
          timeout: 120_000,
          reuseExistingServer: false,
        },
      ],
});
