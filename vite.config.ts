import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { scadDesigns } from './vite/scadDesigns.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), scadDesigns()],
})
