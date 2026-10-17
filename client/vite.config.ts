import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const api = { '/api': process.env.API_TARGET ?? 'http://localhost:3002' };
const port = Number(process.env.PORT_WEB ?? 5174);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'GateGuard V2',
        short_name: 'GateGuard',
        description: 'Event registration, signed QR tickets and fast gate check-in.',
        theme_color: '#f2f1ed',
        background_color: '#f2f1ed',
        display: 'standalone',
        start_url: '/app',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + scanner wasm are precached; API responses are never cached by the service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        globIgnores: ['screens/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { port, strictPort: true, proxy: api },
  preview: { port, strictPort: true, proxy: api },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
