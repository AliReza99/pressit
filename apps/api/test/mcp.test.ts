import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createMcpApp } from '../src/mcp.js';

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

const rpc = (app: ReturnType<typeof createMcpApp>, body: unknown, headers: Record<string, string> = {}) =>
  app.request('http://127.0.0.1:8787/mcp', {
    method: 'POST',
    headers: {
      host: '127.0.0.1:8787',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });

const callTool = async (app: ReturnType<typeof createMcpApp>, args: Record<string, unknown>) => {
  const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compress_image', arguments: args } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: ToolResult }).result;
};

describe('mcp', () => {
  let dir: string;
  let input: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pressit-mcp-'));
    input = join(dir, 'in.jpg');
    await writeFile(input, await sharp({ create: { width: 400, height: 200, channels: 3, background: '#d9421c' } }).jpeg().toBuffer());
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('lists the compress tool', async () => {
    const res = await rpc(createMcpApp({ isEnabled: () => true }), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const { result } = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(result.tools.map(t => t.name)).toEqual(['compress_image']);
  });

  it('compresses a file to disk, taking the format from the extension', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const output = join(dir, 'nested', 'out.webp');
    const result = await callTool(app, { inputPath: input, outputPath: output, width: 100 });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('100×50 webp');
    const meta = await sharp(await readFile(output)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 100, 50]);
  });

  it('refuses to overwrite unless asked', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const output = join(dir, 'out.png');
    await writeFile(output, 'keep me');
    const refused = await callTool(app, { inputPath: input, outputPath: output });
    expect(refused.isError).toBe(true);
    expect(await readFile(output, 'utf8')).toBe('keep me');
    const replaced = await callTool(app, { inputPath: input, outputPath: output, overwrite: true });
    expect(replaced.isError).toBeFalsy();
    expect((await sharp(await readFile(output)).metadata()).format).toBe('png');
  });

  it('reports bad input as tool errors', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    expect((await callTool(app, { inputPath: input, outputPath: join(dir, 'out.bmp') })).isError).toBe(true);
    expect((await callTool(app, { inputPath: join(dir, 'missing.jpg'), outputPath: join(dir, 'o.jpg') })).isError).toBe(true);
    const notImage = join(dir, 'text.jpg');
    await writeFile(notImage, 'not an image');
    const result = await callTool(app, { inputPath: notImage, outputPath: join(dir, 'o.jpg') });
    expect(result.content[0]?.text).toBe('Not a supported image');
  });

  it('is off when the flag says so', async () => {
    const res = await rpc(createMcpApp({ isEnabled: () => false }), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(404);
  });

  it('rejects requests from other hosts and origins', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await rpc(app, list, { host: 'pressit.example.com' })).status).toBe(403);
    expect((await rpc(app, list, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await rpc(app, list, { origin: 'http://localhost:3104' })).status).toBe(200);
  });
});
