import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The Vercel project already provides API_URL. Expose only the non-secret
  // API origin alongside the normal VITE_ variables; never expose credentials.
  envPrefix: ['VITE_', 'API_'],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    rollupOptions: {
      // @tauri-apps/* modules are provided by the Tauri runtime at desktop app build time.
      // They do NOT exist in a normal web/browser build, so we externalize them.
      external: (id) => id.startsWith('@tauri-apps/'),
      output: {
        manualChunks(id) {
          const normalizedId = id.split(String.fromCharCode(92)).join('/');
          if (normalizedId.includes('/node_modules/')) return 'vendor';

          const pagePath = normalizedId.split('/src/pages/')[1];
          if (pagePath?.endsWith('.tsx')) {
            const pageName = pagePath.slice(0, -4).replace(/Page$/, '').toLowerCase();
            return `page-${pageName}`;
          }

          if (normalizedId.includes('/src/components/')) return 'components';
          return undefined;
        },
      },
    },
  },
});
