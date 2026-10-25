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
      ignored: ["**/src-tauri/**"]
    }
  },
  build: {
    rollupOptions: {
      // @tauri-apps/* modules are provided by the Tauri runtime at desktop app build time.
      // They do NOT exist in a normal web/browser build, so we externalize them.
      // The dynamic import in OnboardingFlow.tsx is already wrapped in try/catch for browser fallback.
      external: [/^@tauri-apps\//]
    }
  }
});

