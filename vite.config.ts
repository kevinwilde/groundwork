/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // Relative base so the build works at a domain root or a sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [
    react(),
    mode !== 'test' &&
      VitePWA({
        // Ask before switching to a new version, so a half-filled form is never reloaded away.
        registerType: 'prompt',
        // Registered from React (src/components/PwaPrompt.tsx).
        injectRegister: false,
        // Icons are generated from public/logo.svg using pwa-assets.config.ts.
        pwaAssets: { config: true, overrideManifestIcons: true, injectThemeColor: false },
        manifest: {
          name: 'Groundwork',
          short_name: 'Groundwork',
          description: 'Track lifts, runs, movement snacks and how your body feels. Works offline; your data stays on this device.',
          start_url: './',
          scope: './',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#edf0f4',
          theme_color: '#edf0f4',
          categories: ['health', 'fitness', 'lifestyle'],
        },
        workbox: {
          // Precache the whole app shell, including the bundled fonts and icons.
          // (The web manifest is added by the plugin itself.)
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
  ],
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
