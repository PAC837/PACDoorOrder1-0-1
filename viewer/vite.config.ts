import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pacAdminPlugin } from './server/api-plugin.js';

export default defineConfig({
  plugins: [react(), pacAdminPlugin()],
  server: {
    port: 5173,
    open: true,
  },
});
