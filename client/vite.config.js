import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    allowedHosts: 'all',
    proxy: {
      '/api': 'http://localhost:3001',
      '/library': 'http://localhost:3001'
    }
  }
})
