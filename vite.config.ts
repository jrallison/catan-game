import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['hive.tail7957ee.ts.net', 'localhost', '127.0.0.1', '100.77.108.94']
  }
})
