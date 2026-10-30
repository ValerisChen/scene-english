import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '逐场英语',
        short_name: '逐场英语',
        description: '按场景逐场攻克一部电影，最终无字幕看懂',
        lang: 'zh-CN',
        theme_color: '#141B26',
        background_color: '#F3F5F8',
        display: 'standalone',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      // 接口数据不走 Service Worker 缓存，学习数据另外存在 IndexedDB
      workbox: { navigateFallbackDenylist: [/^\/api\//] },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: { environment: 'node' },
})
