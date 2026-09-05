import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Serves the Vercel serverless functions in ./api during `vite dev`
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/stencil', async (req, res) => {
        const mod = await server.ssrLoadModule('/api/stencil.js')
        return mod.default(req, res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApi()],
  worker: { format: 'es' },
})
