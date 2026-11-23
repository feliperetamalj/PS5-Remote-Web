import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwind()],
  build: { outDir: '../dist', emptyOutDir: true },
  // En desarrollo Vite sirve la página y pasa /api al servidor Node (config.public_origin = http://localhost:5173).
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8080' } },
})
