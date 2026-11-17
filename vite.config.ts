import { defineConfig, type Plugin } from 'vite';
import { handleFileApi } from './server/files';

/** In the dev server the page gets the same way to the saves and scenarios folders as it has on the host (see server/files.ts). */
const folders = (): Plugin => ({
  name: 'warriors-folders',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!handleFileApi(req, res)) next();
    });
  },
});

export default defineConfig({
  // two pages: the game, and the test page of the 3D board
  // (the 3D part is one large piece, fetched only when the 3D view is switched on: no need to be warned of its size)
  build: { rollupOptions: { input: ['index.html', '3d.html'] }, chunkSizeWarningLimit: 900 },
  server: { port: 5173, strictPort: true },
  plugins: [folders()],
});
