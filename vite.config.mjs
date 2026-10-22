import { defineConfig, loadEnv } from 'vite';

// SharedArrayBuffer, and so the multi-threaded video engine, is only granted to a
// cross-origin-isolated page. Vercel sets these for the deployed site; set them locally too.
const isolation = {
  name: 'cross-origin-isolation',
  configureServer(server) { server.middlewares.use(setIsolation); },
  configurePreviewServer(server) { server.middlewares.use(setIsolation); },
};
function setIsolation(request, response, next) {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}
export default defineConfig(({ mode }) => ({
  base: './', worker: { format: 'es' }, optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  plugins: [isolation, {
    name: 'shipment-ai-api',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '');
      for (const key of ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'SHIPMENT_AI_ACCESS_TOKEN', 'SHIPMENT_AI_MODEL']) {
        if (!process.env[key] && env[key]) process.env[key] = env[key];
      }
      server.middlewares.use('/api/shipment-analyze', async (req, res) => {
        try { const { default: handler } = await import('./api/shipment-analyze.js'); await handler(req, res); }
        catch { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'AI service unavailable.' })); }
      });
    },
  }],
}));
