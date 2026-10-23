import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

const callTool = async (app: ReturnType<typeof createMcpApp>, args: Record<string, unknown>, name = 'compress_image') => {
  const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
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

  it('lists the compress tools', async () => {
    const res = await rpc(createMcpApp({ isEnabled: () => true }), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const { result } = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(result.tools.map(t => t.name)).toEqual(['compress_image', 'compress_images']);
  });

  it('scales to 70% by default, by percent when asked, and rejects scale with a size', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const sizeOf = async (args: Record<string, unknown>, name: string) => {
      const output = join(dir, name);
      expect((await callTool(app, { inputPath: input, outputPath: output, ...args })).isError).toBeFalsy();
      const meta = await sharp(await readFile(output)).metadata();
      return [meta.width, meta.height];
    };
    expect(await sizeOf({}, 'default.jpg')).toEqual([280, 140]);
    expect(await sizeOf({ scale: 25 }, 'quarter.jpg')).toEqual([100, 50]);
    expect(await sizeOf({ scale: 100 }, 'full.jpg')).toEqual([400, 200]);
    expect(await sizeOf({ height: 50 }, 'height.jpg')).toEqual([100, 50]);
    const both = await callTool(app, { inputPath: input, outputPath: join(dir, 'x.jpg'), scale: 50, width: 10 });
    expect(both.isError).toBe(true);
  });

  it('compresses a folder in one call', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const src = join(dir, 'src');
    await mkdir(src);
    const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#00ff0080' } }).png().toBuffer();
    await writeFile(join(src, 'a.jpg'), await readFile(input));
    await writeFile(join(src, 'b.PNG'), png);
    await writeFile(join(src, 'c.gif'), await sharp(png).gif().toBuffer());
    await writeFile(join(src, 'notes.txt'), 'skip me');
    await mkdir(join(src, 'nested'));

    const out = join(dir, 'out');
    const result = await callTool(app, { inputDir: src, outputDir: out, scale: 50 }, 'compress_images');
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toMatch(/^Compressed 3 of 3 images/);
    expect((await readdir(out)).sort()).toEqual(['a.jpg', 'b.PNG', 'c.png']);
    const meta = await sharp(await readFile(join(out, 'a.jpg'))).metadata();
    expect([meta.format, meta.width]).toEqual(['jpeg', 200]);
    expect((await sharp(await readFile(join(out, 'c.png'))).metadata()).format).toBe('png');
  });

  it('converts a list of files and reports clashes and failures per file', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const twin = join(dir, 'in.png');
    await writeFile(twin, await sharp(await readFile(input)).png().toBuffer());
    const out = join(dir, 'out');
    const args = { inputPaths: [input, twin, join(dir, 'missing.jpg')], outputDir: out, format: 'webp' };
    const result = await callTool(app, args, 'compress_images');
    expect(result.isError).toBeFalsy();
    const report = result.content[0]?.text ?? '';
    expect(report).toMatch(/^Compressed 1 of 3 images/);
    expect(report).toContain('in.png: skipped, another image in this batch already writes in.webp');
    expect(report).toContain('missing.jpg: failed');
    expect(await readdir(out)).toEqual(['in.webp']);
  });

  it('writes next to the images by default and keeps the report short', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    // A tiny PNG grows when re-saved, so the original is copied instead.
    const tiny = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
    await writeFile(join(dir, 'tiny.png'), tiny);

    const short = await callTool(app, { inputDir: dir, scale: 100 }, 'compress_images');
    const lines = (short.content[0]?.text ?? '').split('\n');
    expect(lines[0]).toMatch(new RegExp(`^Compressed 2 of 2 images into ${join(dir, 'compressed')}: .*; 1 already lean, copied as is\\.$`));
    expect(lines.slice(1).filter(Boolean)).toEqual([]);
    expect((await readdir(join(dir, 'compressed'))).sort()).toEqual(['in.jpg', 'tiny.png']);
    expect(await readFile(join(dir, 'compressed', 'tiny.png'))).toEqual(tiny);

    const full = await callTool(app, { inputDir: dir, outputDir: join(dir, 'all'), details: true }, 'compress_images');
    expect(full.content[0]?.text).toContain('in.jpg → in.jpg: 280×140 jpeg');
  });

  it('fits images inside maxWidth without enlarging the small ones', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const small = join(dir, 'small.jpg');
    await writeFile(small, await sharp({ create: { width: 100, height: 50, channels: 3, background: '#123456' } }).jpeg().toBuffer());
    const out = join(dir, 'out');
    const result = await callTool(app, { inputDir: dir, outputDir: out, format: 'webp', maxWidth: 200 }, 'compress_images');
    expect(result.content[0]?.text).toContain('files keep their names with a .webp extension');
    const widthOf = async (name: string) => (await sharp(await readFile(join(out, name))).metadata()).width;
    expect([await widthOf('in.webp'), await widthOf('small.webp')]).toEqual([200, 100]);

    const scaled = await callTool(app, { inputPath: input, outputPath: join(dir, 's.jpg'), scale: 25, maxWidth: 200 });
    expect(scaled.content[0]?.text).toContain('100×50 jpeg');
    const both = await callTool(app, { inputPath: input, outputPath: join(dir, 'x.jpg'), width: 10, maxWidth: 200 });
    expect(both.isError).toBe(true);
  });

  it('walks subfolders when recursive, mirroring them and skipping node_modules', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const src = join(dir, 'site');
    await mkdir(join(src, 'img', 'team'), { recursive: true });
    await mkdir(join(src, 'node_modules', 'pkg'), { recursive: true });
    const jpg = await readFile(input);
    await writeFile(join(src, 'hero.jpg'), jpg);
    await writeFile(join(src, 'img', 'team', 'ana.jpg'), jpg);
    await writeFile(join(src, 'node_modules', 'pkg', 'logo.jpg'), jpg);

    const out = join(src, 'optimized');
    const flat = await callTool(app, { inputDir: src, outputDir: out }, 'compress_images');
    expect(flat.content[0]?.text).toMatch(/^Compressed 1 of 1 images/);
    const deep = await callTool(app, { inputDir: src, outputDir: out, recursive: true, overwrite: true }, 'compress_images');
    expect(deep.content[0]?.text).toMatch(/^Compressed 2 of 2 images into 2 folders/);
    expect((await readdir(out, { recursive: true })).sort()).toEqual(['hero.jpg', 'img', join('img', 'team'), join('img', 'team', 'ana.jpg')]);
  });

  it('rejects unclear batch inputs and writing over the originals', async () => {
    const app = createMcpApp({ isEnabled: () => true });
    const neither = await callTool(app, {}, 'compress_images');
    expect(neither.isError).toBe(true);
    expect(neither.content[0]?.text).toContain('Example: {"inputDir"');
    const both = await callTool(app, { inputDir: dir, inputPaths: [input], outputDir: join(dir, 'o') }, 'compress_images');
    expect(both.isError).toBe(true);
    const inPlace = await callTool(app, { inputDir: dir, outputDir: dir, overwrite: true }, 'compress_images');
    expect(inPlace.isError).toBe(true);
    expect(inPlace.content[0]?.text).toContain('Output would replace the original');
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
