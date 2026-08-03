import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Word Sprint',
        short_name: 'Word Sprint',
        description: '词汇 / 表达学习与复习',
        start_url: '/',
        display: 'standalone',
        // Matches the light `--background` in `src/theme.css`; the install
        // splash and the shell's first paint line up instead of flashing pure
        // white. Keep in step with the <meta name="theme-color"> tags.
        background_color: '#f0f1f3',
        theme_color: '#f0f1f3',
        lang: 'zh-CN',
        icons: [
          {
            src: '/pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // 整个应用还是一个 chunk，主 bundle 已经越过 workbox 默认的 2 MiB 上限，
        // 超限的文件会被**静默跳过**预缓存 —— 那样 PWA 离线就只剩个空壳。抬到
        // 3 MiB 先保证行为正确；真正的解法是按路由做代码分割，那是另一件事。
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/word-sprint-server\.zhuyandijp\.workers\.dev\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 5 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
