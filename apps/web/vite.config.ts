import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const collector = `http://127.0.0.1:${process.env.CCM_PORT ?? '4317'}`

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/ws': { target: collector, ws: true, changeOrigin: true },
      '/health': { target: collector, changeOrigin: true },
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
