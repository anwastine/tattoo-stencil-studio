import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Serves the Vercel serverless functions in ./api during `vite dev`, so the
 * full sign-in / credits / payment flow works locally too. Maps a request path
 * like /api/auth/google to ./api/auth/google.js.
 */
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (!path.startsWith('/api/')) return next()
        const rel = path.slice(1).replace(/\/+$/, '')
        if (rel.includes('..') || rel.includes('/_')) return next()
        try {
          const mod = await server.ssrLoadModule(`/${rel}.js`)
          req.url = path // handlers only read headers/body
          return mod.default(req, res)
        } catch (e) {
          if (/Failed to load url|ENOENT/.test(String(e?.message))) return next()
          server.config.logger.error(`api ${path}: ${e?.stack || e}`)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: String(e?.message || e) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Make .env / .env.local values visible to the API handlers, which read
  // process.env exactly as they do on Vercel.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return { plugins: [react(), tailwindcss(), localApi()] }
})
