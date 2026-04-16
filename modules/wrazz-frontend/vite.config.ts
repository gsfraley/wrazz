import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When TAURI=1, Vite runs as dev server for Tauri (localhost:1420).
// In production / web mode, the Rust server serves the built dist/ directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      // Forward API calls to the Rust server in web dev mode
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
