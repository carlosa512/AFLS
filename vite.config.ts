import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines everything into one HTML file (dist-single/) so the
// game can be shared as a single page; the default build is a normal web app.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  base: './',
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/vitest.setup.ts'],
    // Engine tests build whole leagues and walk seasons: a draft test takes four seconds on an idle
    // machine and more on a shared CI runner, so vitest's five-second default fails them at random,
    // and its ten-second hook default fails a file's league-building setup the same way.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
}));
