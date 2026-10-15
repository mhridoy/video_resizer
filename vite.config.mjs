import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => ({
  base: './', optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  plugins: [{
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
