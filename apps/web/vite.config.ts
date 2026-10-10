import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Empty prefix loads unprefixed vars too; ALLOWED_HOSTS stays out of the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = env.ALLOWED_HOSTS?.split(',').map(host => host.trim()).filter(Boolean) ?? [];

  return {
    plugins: [react()],
    server: {
      port: 3104,
      allowedHosts,
      proxy: {
        '/api': 'http://127.0.0.1:8787',
      },
    },
  };
});
