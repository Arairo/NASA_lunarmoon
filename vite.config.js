import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

// BASE_PATH lets the GitHub Pages build serve the app from /<repository-name>/.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [cesium()],
  server: { port: 5174, host: true },
  preview: { port: 4174 },
  build: { chunkSizeWarningLimit: 6000 },
});
