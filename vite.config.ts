import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5174,
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
