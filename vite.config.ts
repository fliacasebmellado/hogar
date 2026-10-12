/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base relativa: funciona en GitHub Pages (https://usuario.github.io/repo/) y en cualquier subcarpeta.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,json,mjs}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        id: './',
        name: 'Hogar — organización familiar',
        short_name: 'Hogar',
        description: 'Agenda, tareas, compras, economía, casa y documentos de la familia.',
        lang: 'es-AR',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fafaf9',
        theme_color: '#292524',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Web Share Target (Android/Chrome): recibe texto, imágenes, PDF y audios compartidos desde otras apps.
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: ['image/*', 'application/pdf', 'audio/*', 'text/plain', '.ogg', '.opus', '.m4a'] }],
          },
        },
        shortcuts: [
          { name: 'Capturar', short_name: 'Capturar', url: './#/asistente', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Compras', short_name: 'Compras', url: './#/compras', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
      } as any,
      devOptions: { enabled: false },
    }),
  ],
  resolve: { preserveSymlinks: true },
  worker: { format: 'es' },
  build: { target: 'es2021', sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
  },
});
