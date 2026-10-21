import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const collector = `http://127.0.0.1:${process.env.CCM_PORT ?? '4317'}`

export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'webview' } } }), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: collector, ws: true, changeOrigin: true },
      '/health': { target: collector, changeOrigin: true },
      '/api/timeline': { target: collector, changeOrigin: true },
    },
  },
  // Habblaud's shared/i18n.ts statically imports every dictionary through ./locales/all; the browser (and these tests)
  // swap it for an empty one and load only the active dictionary (apps/web/src/office/i18n.ts), as upstream does.
  resolve: {
    alias: [{ find: /^\.\/locales\/all$/, replacement: fileURLToPath(new URL('../../packages/habblaud/shared/locales/none.ts', import.meta.url)) }],
  },
  // ES worker: the highlight worker lazy-loads shiki grammars (code splitting is not possible in an iife worker).
  worker: { format: 'es' },
  test: {
    environment: 'happy-dom',
  },
})
