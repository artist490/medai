import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Временная изолированная конфигурация для визуального аудита.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: { usePolling: true, interval: 300 },
    host: '127.0.0.1',
    port: 5174,
    proxy: { '/api': { target: 'http://127.0.0.1:8001', changeOrigin: true } },
  },
})
