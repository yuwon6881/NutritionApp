import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { NUTRITION_SHORTCUTS } from './src/lib/nutritionShortcuts.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.1.0')
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Nutrition',
        short_name: 'Nutrition',
        description: 'Nutrition diary, adaptive calorie and macro coaching, and body progress tracking.',
        start_url: '/',
        display: 'standalone',
        background_color: '#F4F2FA',
        theme_color: '#F4F2FA',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: NUTRITION_SHORTCUTS.map(shortcut => ({
          name: shortcut.name,
          short_name: shortcut.shortName,
          description: shortcut.description,
          url: shortcut.url,
          icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }]
        }))
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: [
          '**/IncomingPhoto*',
          '**/NativeBarcodeScanner*',
          '**/firstLaunchPermission*',
          '**/ReminderReadiness*',
          '**/esm-*',
          '**/index.esm*',
          '**/web-*'
        ]
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ]
});
