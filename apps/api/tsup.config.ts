import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // The shared package ships TypeScript source, so bundle it in.
  noExternal: ['@squeeze/shared'],
});
