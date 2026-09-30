import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely; keeping them apart lets browsers cache them across app releases.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          data: ['@supabase/supabase-js', '@tanstack/react-query'],
        },
      },
    },
  },
});
