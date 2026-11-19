import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function serveOcrArchives(): Plugin {
  const headers: Connect.NextHandleFunction = (request, response, next) => {
    const path = request.url?.split('?')[0];
    if (
      path &&
      /\/vendor\/sheetscan\/[^/]+\/runtime\/tesseract\/lang\/[^/]+\.traineddata\.gz$/.test(path)
    ) {
      // These gzip files are SDK inputs with checksums over the compressed bytes.
      response.setHeader('Content-Type', 'application/gzip');
      response.setHeader('Content-Encoding', 'identity');
    }
    next();
  };
  return {
    name: 'serve-ocr-archives',
    configureServer(server) {
      server.middlewares.use(headers);
    },
    configurePreviewServer(server) {
      server.middlewares.use(headers);
    },
  };
}

export default defineConfig({
  plugins: [react(), serveOcrArchives()],
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1800, assetsInlineLimit: 0 },
  server: { port: 5173, strictPort: false },
});
