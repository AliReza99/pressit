import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { to } from 'await-to-js';
import { compressOptionsSchema } from '@pressit/shared/schema';
import {
  MAX_UPLOAD_BYTES,
  OUTPUT_HEADERS,
  type ApiError,
  type SourceInfo,
} from '@pressit/shared';
import { compress, inspect } from './image.js';
import { createSourceStore, type SourceStore } from './store.js';

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
};

const uploadSchema = z.object({ file: z.instanceof(File) });
const idParamSchema = z.object({ id: z.uuid() });

const validationError = (result: { success: boolean }, c: { json: (b: ApiError, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: 'Invalid request' }, 400);

type CreateAppOptions = {
  store?: SourceStore;
};

export const createApp = ({ store = createSourceStore({ maxEntries: 16, ttlMs: 30 * 60_000 }) }: CreateAppOptions = {}) =>
  new Hono()
    .basePath('/api')
    .get('/health', c => c.json({ ok: true }))
    .post(
      '/images',
      bodyLimit({
        maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
        onError: c => c.json<ApiError>({ error: 'File is larger than 50 MB' }, 413),
      }),
      zValidator('form', uploadSchema, validationError),
      async c => {
        const { file } = c.req.valid('form');
        if (file.size > MAX_UPLOAD_BYTES) return c.json<ApiError>({ error: 'File is larger than 50 MB' }, 413);

        const buffer = Buffer.from(await file.arrayBuffer());
        const [err, meta] = await to(inspect(buffer));
        if (err) return c.json<ApiError>({ error: 'Not a supported image' }, 415);

        const info: SourceInfo = { id: randomUUID(), name: file.name, size: file.size, ...meta };
        store.put(buffer, info);
        return c.json(info, 201);
      },
    )
    .post(
      '/images/:id/compress',
      zValidator('param', idParamSchema, validationError),
      zValidator('json', compressOptionsSchema, validationError),
      async c => {
        const { id } = c.req.valid('param');
        const entry = store.get(id);
        if (!entry) return c.json<ApiError>({ error: 'Image expired, upload it again' }, 404);

        const options = c.req.valid('json');
        const { crop } = options;
        if (crop && (crop.left + crop.width > entry.info.width || crop.top + crop.height > entry.info.height)) {
          return c.json<ApiError>({ error: 'Crop is outside the image' }, 400);
        }
        const [err, result] = await to(compress(entry.buffer, options, entry.info.exifBytes > 0));
        if (err) return c.json<ApiError>({ error: 'Compression failed' }, 422);

        return c.body(new Uint8Array(result.data), 200, {
          'content-type': MIME[options.format] ?? 'application/octet-stream',
          'cache-control': 'no-store',
          [OUTPUT_HEADERS.width]: String(result.width),
          [OUTPUT_HEADERS.height]: String(result.height),
          [OUTPUT_HEADERS.exifKept]: String(result.exifKept),
        });
      },
    )
    .delete('/images/:id', zValidator('param', idParamSchema, validationError), c => {
      store.delete(c.req.valid('param').id);
      return c.body(null, 204);
    });

export type AppType = ReturnType<typeof createApp>;
