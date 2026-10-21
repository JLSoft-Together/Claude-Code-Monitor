import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Cliente do Habblaud. Em `npm run dev` o servidor usa este config em middleware mode;
// `npm run dev:client` sobe só o Vite (use ?mock=1 para dados simulados no navegador).
export default defineConfig({
  root: r('./client'),
  // No navegador vai só o dicionário do idioma ativo (client/src/main.ts), não os três: ver shared/locales/all.ts.
  resolve: { alias: [{ find: /^\.\/locales\/all$/, replacement: r('./shared/locales/none.ts') }] },
  publicDir: r('./client/public'),
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    // Arquivos gerados com hash vão para /bundle/ (cache immutable no servidor); /assets/ fica só
    // para client/public (nomes fixos, revalidados a cada acesso). Ver server/http/static.ts.
    assetsDir: 'bundle',
    assetsInlineLimit: 0,
    rollupOptions: { input: { main: r('./client/index.html') } },
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.HABBLAUD_PORT ?? 4747}` },
    },
  },
});
