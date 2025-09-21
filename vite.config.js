// vite.config.js (repo root)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // index.html stays at repo root
  root: '.',
  plugins: [react()],

  // Your source & public assets still live under client/
  publicDir: resolve(__dirname, 'client/public'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'client/src'),
    },
  },

  build: {
    outDir: 'dist',               // Vercel "Output Directory" => dist
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'), // <-- entry at repo root
    },
  },

  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 5173 },
})
