import { defineConfig, devices } from '@playwright/test';

// Pruebas de interfaz sobre la versión compilada (npm run build) servida con vite preview.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { screenshot: 'only-on-failure', baseURL: 'http://localhost:4180', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', serviceWorkers: 'allow' },
  webServer: { command: 'npx vite preview --port 4180 --strictPort', url: 'http://localhost:4180', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'computadora', use: { viewport: { width: 1280, height: 820 }, browserName: 'chromium' } },
  ],
});
