import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Onebeep is served from the root of its domain (e.g.
// https://<slug>.ethiodeploy.com/), so assets use an absolute '/' base.
export default defineConfig({
  base: '/',
  plugins: [react()],
})
