import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev only: proxy API, uploads and websockets to the Express server so the browser
// sees a single origin (same as production behind Nginx) and cookies just work.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
