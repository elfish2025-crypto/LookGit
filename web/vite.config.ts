import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5178,
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 5179}`, changeOrigin: true },
    },
  },
  build: {
    outDir: join(here, 'dist'),
    emptyOutDir: true,
  },
})
