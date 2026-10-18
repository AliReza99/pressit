import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { to } from 'await-to-js';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { cropSchema, outputFormatSchema } from '@pressit/shared/schema';
import {
  extensionFor,
  MAX_DIMENSION,
  MAX_UPLOAD_BYTES,
  type ApiError,
  type Crop,
  type OutputFormat,
} from '@pressit/shared';
import { compressOneShot, InputError } from './image.js';

/**
 * `pnpm mcp:off` creates this file and `pnpm mcp:on` removes it. It is checked
 * on every request, so toggling needs no restart. The path resolves to the repo
 * root from both src/ and the bundled dist/.
 */
export const MCP_DISABLED_FLAG = fileURLToPath(new URL('../../../.pressit-mcp-disabled', import.meta.url));

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const hostnameOf = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
};

/**
 * The tool reads and writes files on this machine, so only local clients may
 * call it. Checking Host blocks DNS rebinding, checking Origin blocks other
 * sites open in the browser.
 */
const isLocalRequest = (req: Request) => {
  const host = req.headers.get('host');
  if (!LOOPBACK.has(hostnameOf(host ? `http://${host}` : req.url) ?? '')) return false;
  const origin = req.headers.get('origin');
  return origin === null || LOOPBACK.has(hostnameOf(origin) ?? '');
};

const FORMAT_BY_EXTENSION: Record<string, OutputFormat> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.png': 'png',
};

/** Inputs a batch picks up from a folder. GIFs keep their first frame. */
const IMAGE_EXTENSIONS = new Set([...Object.keys(FORMAT_BY_EXTENSION), '.gif']);

const MAX_BATCH = 500;

const absolutePath = z.string().refine(isAbsolute, 'Must be an absolute path');

const settingsInput = {
  quality: z.number().int().min(1).max(100).default(75).describe('1-100, ignored for PNG'),
  scale: z
    .number()
    .int()
    .min(5)
    .max(100)
    .optional()
    .describe('Size in percent of the original (or crop), like the SIZE slider in the PressIt app. Use instead of width/height'),
  width: z.number().int().min(1).max(MAX_DIMENSION).optional().describe('Output width in px. Alone, keeps the aspect ratio'),
  height: z.number().int().min(1).max(MAX_DIMENSION).optional().describe('Output height in px. Alone, keeps the aspect ratio'),
  keepExif: z.boolean().default(false).describe('Keep camera, GPS and date metadata'),
  overwrite: z.boolean().default(false).describe('Replace output files that already exist'),
};

const compressInput = {
  inputPath: absolutePath.describe('Absolute path of the image to compress (JPG, PNG, WebP or GIF, up to 50 MB)'),
  outputPath: absolutePath.describe('Absolute path to write the result to. Missing folders are created'),
  format: outputFormatSchema.optional().describe('Output format. Defaults to the extension of outputPath'),
  ...settingsInput,
  crop: cropSchema.optional().describe('Region of the upright image to keep, in source pixels, applied before resizing'),
};

const batchInput = {
  inputDir: absolutePath
    .optional()
    .describe('Absolute path of a folder. Its JPG, PNG, WebP and GIF files are compressed, subfolders are not. Use this or inputPaths'),
  inputPaths: z.array(absolutePath).min(1).max(MAX_BATCH).optional().describe('Absolute paths of the images. Use this or inputDir'),
  outputDir: absolutePath.describe('Absolute path of the folder to write results to, under the same file names. Created if missing'),
  format: outputFormatSchema.optional().describe('Output format for every image. Defaults to each image\'s own format, GIF becomes PNG'),
  ...settingsInput,
};

type Settings = {
  quality: number;
  keepExif: boolean;
  overwrite: boolean;
  scale?: number;
  width?: number;
  height?: number;
  crop?: Crop;
};

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const describeChange = (before: number, after: number) => {
  const saved = Math.round((1 - after / before) * 100);
  return saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`;
};

const sizeConflict = ({ scale, width, height }: Pick<Settings, 'scale' | 'width' | 'height'>) =>
  scale && (width || height) ? 'Use scale or width/height, not both' : undefined;

type FileResult = { ok: true; before: number; after: number; text: string } | { ok: false; text: string };

const compressFile = async (
  inputPath: string,
  outputPath: string,
  format: OutputFormat,
  { overwrite, scale, ...options }: Settings,
): Promise<FileResult> => {
  if (resolve(inputPath) === resolve(outputPath)) return { ok: false, text: 'Output would replace the original, pick another path' };

  const [statErr, info] = await to(stat(inputPath));
  if (statErr || !info.isFile()) return { ok: false, text: `Cannot read ${inputPath}` };
  if (info.size > MAX_UPLOAD_BYTES) return { ok: false, text: 'File is larger than 50 MB' };

  const [err, result] = await to(compressOneShot(await readFile(inputPath), { ...options, format }, scale));
  if (err) return { ok: false, text: err instanceof InputError ? err.message : 'Compression failed' };

  await mkdir(dirname(outputPath), { recursive: true });
  const [writeErr] = await to(writeFile(outputPath, result.data, { flag: overwrite ? 'w' : 'wx' }));
  if (writeErr) {
    const exists = (writeErr as NodeJS.ErrnoException).code === 'EEXIST';
    return { ok: false, text: exists ? `${outputPath} already exists, pass overwrite: true to replace it` : `Cannot write ${outputPath}` };
  }

  const before = info.size;
  const after = result.data.length;
  const text = `${result.width}×${result.height} ${format}, ${formatBytes(after)} (was ${formatBytes(before)}, ${describeChange(before, after)})`;
  return { ok: true, before, after, text };
};

const listImages = async (dir: string) => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && IMAGE_EXTENSIONS.has(extname(e.name).toLowerCase()))
    .map(e => join(dir, e.name))
    .sort();
};

/** Keeps the input's extension when it already matches the format, so `photo.jpeg` stays `.jpeg`. */
const outputNameFor = (inputPath: string, format: OutputFormat) => {
  const ext = extname(inputPath);
  const stem = basename(inputPath, ext);
  return FORMAT_BY_EXTENSION[ext.toLowerCase()] === format ? `${stem}${ext}` : `${stem}.${extensionFor(format)}`;
};

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const fail = (value: string) => ({ isError: true, ...text(value) });

const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const createMcpServer = () => {
  const server = new McpServer({ name: 'pressit', version: '0.2.0' });

  server.registerTool(
    'compress_image',
    {
      title: 'Compress image',
      description:
        'Compress, resize, crop or convert one image file on this computer with PressIt, and save the result to outputPath. For several images use compress_images.',
      inputSchema: compressInput,
      annotations,
    },
    async ({ inputPath, outputPath, format: requested, ...settings }) => {
      const format = requested ?? FORMAT_BY_EXTENSION[extname(outputPath).toLowerCase()];
      if (!format) return fail('Set format, or give outputPath a .jpg, .webp or .png extension');
      const conflict = sizeConflict(settings);
      if (conflict) return fail(conflict);

      const result = await compressFile(inputPath, outputPath, format, settings);
      return result.ok ? text(`Saved ${outputPath}: ${result.text}`) : fail(result.text);
    },
  );

  server.registerTool(
    'compress_images',
    {
      title: 'Compress images',
      description:
        'Compress, resize or convert many image files on this computer with PressIt in one call, from a folder or a list of paths, writing each result to outputDir. ' +
        'Re-saving a JPEG at its own size and similar quality rarely saves much; scale or format "webp" usually do.',
      inputSchema: batchInput,
      annotations,
    },
    async ({ inputDir, inputPaths, outputDir, format, ...settings }) => {
      if (!inputDir === !inputPaths) return fail('Give inputDir or inputPaths, not both');
      const conflict = sizeConflict(settings);
      if (conflict) return fail(conflict);

      let inputs = inputPaths ?? [];
      if (inputDir) {
        const [err, found] = await to(listImages(inputDir));
        if (err) return fail(`Cannot read folder ${inputDir}`);
        inputs = found;
      }
      if (inputs.length === 0) return fail('No JPG, PNG, WebP or GIF files found');
      if (inputs.length > MAX_BATCH) return fail(`Found ${inputs.length} images, the limit is ${MAX_BATCH} per call`);

      const lines: string[] = [];
      const taken = new Set<string>();
      let done = 0;
      let before = 0;
      let after = 0;
      // One at a time: sharp already uses every core for each image.
      for (const inputPath of inputs) {
        const fileFormat = format ?? FORMAT_BY_EXTENSION[extname(inputPath).toLowerCase()] ?? 'png';
        const outputPath = join(outputDir, outputNameFor(inputPath, fileFormat));
        const name = basename(inputPath);
        if (taken.has(outputPath)) {
          lines.push(`${name}: skipped, another image in this batch already writes ${basename(outputPath)}`);
          continue;
        }
        taken.add(outputPath);

        const result = await compressFile(inputPath, outputPath, fileFormat, settings);
        if (!result.ok) {
          lines.push(`${name}: failed, ${result.text}`);
          continue;
        }
        done++;
        before += result.before;
        after += result.after;
        lines.push(`${name} → ${basename(outputPath)}: ${result.text}`);
      }

      const failed = inputs.length - done;
      const summary =
        done === 0
          ? `No images were compressed (${failed} failed).`
          : `Compressed ${done} of ${inputs.length} images into ${outputDir}: ${formatBytes(before)} → ${formatBytes(after)} (${describeChange(before, after)})` +
            (failed ? `, ${failed} failed.` : '.');
      const report = [summary, '', ...lines].join('\n');
      return done === 0 ? fail(report) : text(report);
    },
  );

  return server;
};

type CreateMcpAppOptions = {
  isEnabled?: () => boolean;
};

export const createMcpApp = ({ isEnabled = () => !existsSync(MCP_DISABLED_FLAG) }: CreateMcpAppOptions = {}) =>
  new Hono().all('/mcp', async c => {
    if (!isLocalRequest(c.req.raw)) return c.json<ApiError>({ error: 'MCP only accepts local requests' }, 403);
    if (!isEnabled()) return c.json<ApiError>({ error: 'MCP is disabled, run `pnpm mcp:on` in the PressIt folder' }, 404);

    // Stateless: a fresh server per request, nothing kept between calls.
    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });
