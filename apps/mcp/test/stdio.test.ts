import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Runs the built bundle the way `npx pressit-mcp` does, so `pnpm test` builds first.
const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe('pressit-mcp over stdio', () => {
  const client = new Client({ name: 'test', version: '0.0.0' });
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pressit-stdio-'));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin] }));
  });

  afterAll(async () => {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lists the tools and compresses an image', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['compress_image', 'compress_images']);

    const inputPath = join(dir, 'in.png');
    const outputPath = join(dir, 'out.webp');
    await writeFile(inputPath, await sharp({ create: { width: 400, height: 200, channels: 3, background: '#d9421c' } }).png().toBuffer());
    const result = await client.callTool({ name: 'compress_image', arguments: { inputPath, outputPath } });
    expect(result.isError).toBeFalsy();
    expect((await sharp(outputPath).metadata()).width).toBe(280);
    expect((await stat(outputPath)).size).toBeGreaterThan(0);
  });
});
