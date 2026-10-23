import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  // Bundle everything so `npx` installs only sharp, whose native binary cannot be bundled.
  noExternal: [/^(?!sharp$)/],
  // Some bundled dependencies are CommonJS and call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
