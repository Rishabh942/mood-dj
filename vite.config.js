// vite.config.js (at repo root)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',                 // root is the folder with index.html (repo root)
  publicDir: 'client/public',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': '/client/src',
    },
  },
})
