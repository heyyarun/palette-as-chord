import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { submissionsPlugin } from './submissions-plugin.ts'

// PHONE=1 serves the dev server over HTTPS on the LAN (self-signed) for phone testing.
export default defineConfig({
  plugins: [submissionsPlugin(), ...(process.env.PHONE ? [basicSsl()] : [])],
  server: process.env.PHONE ? { host: true } : {},
})
