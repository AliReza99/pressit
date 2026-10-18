import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { OUTPUT_HEADERS, type CompressOptions, type OneShotOptions, type SourceInfo } from '@pressit/shared';
import { createApp } from '../src/app.js';
import { createSourceStore } from '../src/store.js';

// 400×200 landscape pixels tagged orientation 6, so it displays as 200×400 portrait.
const rotatedJpeg = () =>
  sharp({ create: { width: 400, height: 200, channels: 3, background: '#d9421c' } })
    .jpeg({ quality: 95 })
    .withExif({ IFD0: { Make: 'PressItCam', Model: 'Test' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();

const plainPng = () =>
  sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } })
    .png()
    .toBuffer();

const upload = async (app: ReturnType<typeof createApp>, data: Buffer, name: string, type: string) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(data)], name, { type }));
  return app.request('/api/images', { method: 'POST', body: form });
};

const compressReq = (app: ReturnType<typeof createApp>, id: string, options: CompressOptions) =>
  app.request(`/api/images/${id}/compress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  });

const oneShot = (app: ReturnType<typeof createApp>, data: Buffer, options: OneShotOptions | string) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(data)], 'p.jpg', { type: 'image/jpeg' }));
  form.append('options', typeof options === 'string' ? options : JSON.stringify(options));
  return app.request('/api/compress', { method: 'POST', body: form });
};

describe('api', () => {
  it('reports oriented dimensions and EXIF size on upload', async () => {
    const app = createApp();
    const res = await upload(app, await rotatedJpeg(), 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(201);
    const info = (await res.json()) as SourceInfo;
    expect(info).toMatchObject({ name: 'photo.jpg', width: 200, height: 400, format: 'jpeg' });
    expect(info.exifBytes).toBeGreaterThan(0);
  });

  it('rejects non-images', async () => {
    const app = createApp();
    const res = await upload(app, Buffer.from('not an image'), 'x.jpg', 'image/jpeg');
    expect(res.status).toBe(415);
  });

  it('strips EXIF by default and applies the resize', async () => {
    const app = createApp();
    const info = (await (await upload(app, await rotatedJpeg(), 'p.jpg', 'image/jpeg')).json()) as SourceInfo;
    const res = await compressReq(app, info.id, { width: 100, height: 200, quality: 70, format: 'jpeg', keepExif: false });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get(OUTPUT_HEADERS.exifKept)).toBe('false');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([100, 200]);
    expect(meta.exif).toBeUndefined();
  });

  it.each(['jpeg', 'webp', 'png'] as const)('keeps EXIF without double rotation (%s)', async format => {
    const app = createApp();
    const info = (await (await upload(app, await rotatedJpeg(), 'p.jpg', 'image/jpeg')).json()) as SourceInfo;
    const res = await compressReq(app, info.id, { width: 100, height: 200, quality: 70, format, keepExif: true });
    expect(res.headers.get(OUTPUT_HEADERS.exifKept)).toBe('true');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta.format).toBe(format);
    expect(meta.exif?.length ?? 0).toBeGreaterThan(0);
    expect(meta.orientation ?? 1).toBe(1);
    expect([meta.width, meta.height]).toEqual([100, 200]);
  });

  it('stretches when dimensions ignore the aspect ratio', async () => {
    const app = createApp();
    const info = (await (await upload(app, await plainPng(), 'a.png', 'image/png')).json()) as SourceInfo;
    const res = await compressReq(app, info.id, { width: 300, height: 10, quality: 50, format: 'png', keepExif: true });
    expect(res.headers.get(OUTPUT_HEADERS.exifKept)).toBe('false');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([300, 10, true]);
  });

  it('crops the upright image before resizing', async () => {
    // 400×200 stored red|blue, orientation 6 displays it 200×400 with red on top.
    const halves = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ff0000' } })
      .composite([{ input: { create: { width: 200, height: 200, channels: 3, background: '#0000ff' } }, left: 200, top: 0 }])
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const app = createApp();
    const info = (await (await upload(app, halves, 'h.jpg', 'image/jpeg')).json()) as SourceInfo;
    const res = await compressReq(app, info.id, {
      width: 50,
      height: 100,
      quality: 90,
      format: 'png',
      keepExif: false,
      crop: { left: 50, top: 220, width: 100, height: 180 },
    });
    expect(res.status).toBe(200);
    const { data, info: out } = await sharp(Buffer.from(await res.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    expect([out.width, out.height]).toEqual([50, 100]);
    const [r, , b] = data.subarray(0, 3);
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(50);
  });

  it('rejects a crop outside the image', async () => {
    const app = createApp();
    const info = (await (await upload(app, await plainPng(), 'a.png', 'image/png')).json()) as SourceInfo;
    const res = await compressReq(app, info.id, {
      width: 10,
      height: 10,
      quality: 50,
      format: 'png',
      keepExif: false,
      crop: { left: 40, top: 0, width: 30, height: 10 },
    });
    expect(res.status).toBe(400);
  });

  it('validates options and unknown ids', async () => {
    const app = createApp();
    const info = (await (await upload(app, await plainPng(), 'a.png', 'image/png')).json()) as SourceInfo;
    const bad = await compressReq(app, info.id, { width: 9000, height: 10, quality: 50, format: 'png', keepExif: false });
    expect(bad.status).toBe(400);
    const missing = await compressReq(app, crypto.randomUUID(), { width: 10, height: 10, quality: 50, format: 'png', keepExif: false });
    expect(missing.status).toBe(404);
  });

  it('compresses in one step without storing the source', async () => {
    const store = createSourceStore({ maxEntries: 16, ttlMs: 60_000 });
    const app = createApp({ store });
    const res = await oneShot(app, await rotatedJpeg(), { width: 100, height: 50, quality: 70, format: 'webp', keepExif: false });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 100, 50]);
    expect(store.size).toBe(0);
  });

  it('fills a missing side from the upright aspect ratio', async () => {
    const app = createApp();
    const res = await oneShot(app, await rotatedJpeg(), { width: 100, quality: 70, format: 'jpeg', keepExif: false });
    expect([res.headers.get(OUTPUT_HEADERS.width), res.headers.get(OUTPUT_HEADERS.height)]).toEqual(['100', '200']);

    const kept = await oneShot(app, await rotatedJpeg(), { quality: 70, format: 'jpeg', keepExif: true });
    expect([kept.headers.get(OUTPUT_HEADERS.width), kept.headers.get(OUTPUT_HEADERS.height)]).toEqual(['200', '400']);
    expect(kept.headers.get(OUTPUT_HEADERS.exifKept)).toBe('true');

    const cropped = await oneShot(app, await rotatedJpeg(), {
      height: 50,
      quality: 70,
      format: 'png',
      keepExif: false,
      crop: { left: 0, top: 0, width: 200, height: 100 },
    });
    expect([cropped.headers.get(OUTPUT_HEADERS.width), cropped.headers.get(OUTPUT_HEADERS.height)]).toEqual(['100', '50']);
  });

  it('converts the format when the size is kept', async () => {
    const res = await oneShot(createApp(), await rotatedJpeg(), { quality: 70, format: 'png', keepExif: false });
    expect(res.headers.get('content-type')).toBe('image/png');
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format).toBe('png');
  });

  it('rejects bad one-step requests', async () => {
    const app = createApp();
    expect((await oneShot(app, await plainPng(), '{not json')).status).toBe(400);
    expect((await oneShot(app, await plainPng(), { quality: 500, format: 'png', keepExif: false })).status).toBe(400);
    expect((await oneShot(app, Buffer.from('nope'), { quality: 50, format: 'png', keepExif: false })).status).toBe(415);
    const crop = { left: 40, top: 0, width: 30, height: 10 };
    expect((await oneShot(app, await plainPng(), { quality: 50, format: 'png', keepExif: false, crop })).status).toBe(400);
    const huge = await oneShot(app, await plainPng(), { height: 8000, quality: 50, format: 'png', keepExif: false });
    expect(huge.status).toBe(400);
  });

  it('evicts the least recently used source', () => {
    const store = createSourceStore({ maxEntries: 2, ttlMs: 60_000 });
    const info = (id: string): SourceInfo => ({ id, name: id, size: 1, width: 1, height: 1, format: 'png', exifBytes: 0 });
    store.put(Buffer.alloc(1), info('a'));
    store.put(Buffer.alloc(1), info('b'));
    store.get('a');
    store.put(Buffer.alloc(1), info('c'));
    expect(store.get('b')).toBeUndefined();
    expect(store.get('a')).toBeDefined();
  });
});
