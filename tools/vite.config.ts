import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** The model render tool (dev only): the page posts PNGs here and they are written to Models/renders. */
const OUT = resolve(__dirname, '../Models/renders');

export default defineConfig({
  root: resolve(__dirname, '..'),
  server: { port: 5199, strictPort: true },
  plugins: [
    {
      name: 'save-render',
      configureServer(server) {
        server.middlewares.use('/__save', (req, res) => {
          const name = basename(new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'render.png');
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            mkdirSync(OUT, { recursive: true });
            writeFileSync(join(OUT, name), Buffer.concat(chunks));
            res.end('ok');
          });
        });
      },
    },
  ],
});
