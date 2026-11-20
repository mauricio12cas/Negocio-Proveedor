import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tres páginas: pantalla del cliente (index), panel (admin) y remisión imprimible.
// base './' para que funcione dentro de https://<usuario>.github.io/<repo>/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: { index: 'index.html', admin: 'admin.html', remision: 'remision.html' },
    },
    chunkSizeWarningLimit: 1500,
  },
});
