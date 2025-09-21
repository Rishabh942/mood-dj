
// vite.config.js (at repo root)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const CLIENT_ROOT = resolve(__dirname, 'client')

export default defineConfig({
  root: CLIENT_ROOT,                                 // tell Vite the app lives in /client
  plugins: [react()],
  publicDir: resolve(CLIENT_ROOT, 'public'),
  build: {
    outDir: resolve(CLIENT_ROOT, 'dist'),            // output stays inside /client/dist
    emptyOutDir: true
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 5173 }
})
