import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
import { compressOneShot, InputError, inspect } from './image.js';

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

/** Folders a recursive batch never walks into. */
const SKIPPED_DIRS = new Set(['node_modules', 'compressed']);

/** Used when the caller does not say otherwise. Size defaults only when scale, width and height are all missing. */
const DEFAULT_SCALE = 70;
const DEFAULT_QUALITY = 70;
const DEFAULT_OUTPUT_DIR = 'compressed';

const absolutePath = z.string().refine(isAbsolute, 'Must be an absolute path');

const settingsInput = {
  quality: z.number().int().min(1).max(100).default(DEFAULT_QUALITY).describe(`1-100, ignored for PNG. Defaults to ${DEFAULT_QUALITY}`),
  scale: z
    .number()
    .int()
    .min(5)
    .max(100)
    .optional()
    .describe(
      `Size in percent of the original (or crop), like the SIZE slider in the PressIt app. Use instead of width/height. ` +
        `Defaults to ${DEFAULT_SCALE} when width and height are not given; pass 100 to keep the original size`,
    ),
  width: z.number().int().min(1).max(MAX_DIMENSION).optional().describe('Exact output width in px. Alone, keeps the aspect ratio'),
  height: z.number().int().min(1).max(MAX_DIMENSION).optional().describe('Exact output height in px. Alone, keeps the aspect ratio'),
  maxWidth: z
    .number()
    .int()
    .min(1)
    .max(MAX_DIMENSION)
    .optional()
    .describe('Shrink to fit this width in px, never enlarge. Best for web, e.g. 1600. Without scale, smaller images keep their size'),
  maxHeight: z.number().int().min(1).max(MAX_DIMENSION).optional().describe('Shrink to fit this height in px, never enlarge'),
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
    .describe('Absolute path of a folder. Its JPG, PNG, WebP and GIF files are compressed. Use this or inputPaths'),
  recursive: z
    .boolean()
    .default(false)
    .describe('Also compress images in subfolders of inputDir (skipping node_modules and dot folders), keeping the folder structure in outputDir'),
  inputPaths: z.array(absolutePath).min(1).max(MAX_BATCH).optional().describe('Absolute paths of the images. Use this or inputDir'),
  outputDir: absolutePath
    .optional()
    .describe(
      `Absolute path of the folder to write results to, under the same file names. Created if missing. ` +
        `Defaults to a "${DEFAULT_OUTPUT_DIR}" folder next to each image`,
    ),
  format: outputFormatSchema.optional().describe('Output format for every image. Defaults to each image\'s own format, GIF becomes PNG'),
  ...settingsInput,
  details: z.boolean().default(false).describe('List every image with its new size and dimensions, not only the ones that failed'),
};

type Settings = {
  quality: number;
  keepExif: boolean;
  overwrite: boolean;
  scale?: number;
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  crop?: Crop;
};

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const describeChange = (before: number, after: number) => {
  const saved = Math.round((1 - after / before) * 100);
  return saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`;
};

const sizeConflict = ({ scale, width, height, maxWidth, maxHeight }: Omit<Settings, 'quality' | 'keepExif' | 'overwrite'>) => {
  if (!width && !height) return undefined;
  if (scale) return 'Use scale or width/height, not both';
  if (maxWidth || maxHeight) return 'Use maxWidth/maxHeight or width/height, not both';
  return undefined;
};

type FileResult =
  | { ok: true; before: number; after: number; kept: boolean; text: string }
  | { ok: false; text: string };

const compressFile = async (
  inputPath: string,
  outputPath: string,
  format: OutputFormat,
  { overwrite, scale, maxWidth, maxHeight, ...options }: Settings,
): Promise<FileResult> => {
  if (resolve(inputPath) === resolve(outputPath)) return { ok: false, text: 'Output would replace the original, pick another path' };

  const [statErr, info] = await to(stat(inputPath));
  if (statErr || !info.isFile()) return { ok: false, text: `Cannot read ${inputPath}` };
  if (info.size > MAX_UPLOAD_BYTES) return { ok: false, text: 'File is larger than 50 MB' };

  const input = await readFile(inputPath);
  const [inspectErr, meta] = await to(inspect(input));
  if (inspectErr) return { ok: false, text: 'Not a supported image' };

  const exact = !!(options.width || options.height);
  let sized = exact ? undefined : (scale ?? (maxWidth || maxHeight ? 100 : DEFAULT_SCALE));
  let capped = false;
  if (sized && (maxWidth || maxHeight)) {
    // Scale first, then shrink further to fit the box. Never enlarges.
    const base = options.crop ?? meta;
    const fit = Math.min((maxWidth ?? Infinity) / base.width, (maxHeight ?? Infinity) / base.height) * 100;
    if (fit < sized) {
      sized = fit;
      capped = true;
    }
  }
  const [err, result] = await to(compressOneShot(input, { ...options, format }, sized));
  if (err) return { ok: false, text: err instanceof InputError ? err.message : 'Compression failed' };

  // Re-encoding an already lean file can make it bigger. Then the original is the better
  // result, as long as it has the right format and size and carries no metadata to strip.
  const before = info.size;
  const kept =
    result.data.length >= before &&
    !exact &&
    !capped &&
    !options.crop &&
    FORMAT_BY_EXTENSION[extname(inputPath).toLowerCase()] === format &&
    (options.keepExif || meta.exifBytes === 0);
  const data = kept ? input : result.data;

  await mkdir(dirname(outputPath), { recursive: true });
  const [writeErr] = await to(writeFile(outputPath, data, { flag: overwrite ? 'w' : 'wx' }));
  if (writeErr) {
    const exists = (writeErr as NodeJS.ErrnoException).code === 'EEXIST';
    return { ok: false, text: exists ? `${outputPath} already exists, pass overwrite: true to replace it` : `Cannot write ${outputPath}` };
  }

  const after = data.length;
  const text = kept
    ? `${meta.width}×${meta.height} ${format}, ${formatBytes(after)}, copied as is, it was already smaller than a re-encode`
    : `${result.width}×${result.height} ${format}, ${formatBytes(after)} (was ${formatBytes(before)}, ${describeChange(before, after)})`;
  return { ok: true, before, after, kept, text };
};

const listImages = async (dir: string, recursive: boolean, outputDir?: string) => {
  const entries = await readdir(dir, { withFileTypes: true, recursive });
  const skipped = (path: string) =>
    relative(dir, path)
      .split(sep)
      .some(part => SKIPPED_DIRS.has(part) || part.startsWith('.')) ||
    (!!outputDir && !relative(outputDir, path).startsWith('..') && resolve(outputDir) !== resolve(dir));
  return entries
    .filter(e => e.isFile() && IMAGE_EXTENSIONS.has(extname(e.name).toLowerCase()))
    .map(e => join(e.parentPath, e.name))
    .filter(path => !skipped(dirname(path)))
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

/** Shown to the agent up front, before it has loaded the tool descriptions. */
const INSTRUCTIONS =
  'PressIt compresses, resizes and converts image files (JPG, PNG, WebP, GIF) on this computer in one call, ' +
  'so there is no need to write an image script or install a library. Use it whenever a task needs images to be smaller, ' +
  'lighter or web-ready: compressing or optimizing images, heavy images slowing a site, preparing photos for a website or app, ' +
  'converting to WebP or resizing to a maximum width. For a folder, call compress_images once with inputDir, ' +
  'without listing or measuring the files first. Originals are never changed.';

const createMcpServer = () => {
  const server = new McpServer({ name: 'pressit', version: '0.3.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'compress_image',
    {
      title: 'Compress image',
      description:
        'Compress, optimize, resize, crop or convert one image file on this computer, and save the result to outputPath. ' +
        `By default it is scaled to ${DEFAULT_SCALE}% at quality ${DEFAULT_QUALITY}. For several images use compress_images.`,
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
        'Compress, optimize, resize or convert many image files on this computer in one call, from a folder or a list of paths. ' +
        `By default images are scaled to ${DEFAULT_SCALE}% at quality ${DEFAULT_QUALITY}, keep their format, and are written to a "${DEFAULT_OUTPUT_DIR}" folder next to them. ` +
        'For a website, format "webp" with maxWidth (like 1600) usually works best: big images shrink to fit, small ones keep their size. ' +
        'Files that would not get smaller are copied as they are. No need to list, measure or check the files first: pass the folder as inputDir. ' +
        'Originals and existing files are never replaced unless overwrite is set. The result gives the total size before and after, and any image that failed.',
      inputSchema: batchInput,
      annotations,
    },
    async ({ inputDir, inputPaths, recursive, outputDir, format, details, ...settings }) => {
      if (inputDir && inputPaths) return fail('Give inputDir or inputPaths, not both');
      // Agents that have not loaded the schema yet often call with no arguments, so spell the usual call out.
      if (!inputDir && !inputPaths) {
        return fail(
          'Pass inputDir, the absolute path of a folder, or inputPaths, a list of absolute image paths. ' +
            'Optional: outputDir, format ("webp", "jpeg", "png"), maxWidth, quality, recursive. ' +
            'Example: {"inputDir": "/abs/path/to/images", "format": "webp", "maxWidth": 1600}',
        );
      }
      const conflict = sizeConflict(settings);
      if (conflict) return fail(conflict);

      let inputs = inputPaths ?? [];
      if (inputDir) {
        const [err, found] = await to(listImages(inputDir, recursive, outputDir));
        if (err) return fail(`Cannot read folder ${inputDir}`);
        inputs = found;
      }
      if (inputs.length === 0) return fail('No JPG, PNG, WebP or GIF files found');
      if (inputs.length > MAX_BATCH) return fail(`Found ${inputs.length} images, the limit is ${MAX_BATCH} per call`);

      const lines: string[] = [];
      const taken = new Set<string>();
      const written = new Set<string>();
      let done = 0;
      let kept = 0;
      let before = 0;
      let after = 0;
      // One at a time: sharp already uses every core for each image.
      for (const inputPath of inputs) {
        const fileFormat = format ?? FORMAT_BY_EXTENSION[extname(inputPath).toLowerCase()] ?? 'png';
        // A recursive batch mirrors the subfolders inside outputDir.
        const folder = outputDir
          ? join(outputDir, inputDir ? relative(inputDir, dirname(inputPath)) : '')
          : join(dirname(inputPath), DEFAULT_OUTPUT_DIR);
        const outputPath = join(folder, outputNameFor(inputPath, fileFormat));
        const name = inputDir ? relative(inputDir, inputPath) : basename(inputPath);
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
        if (result.kept) kept++;
        before += result.before;
        after += result.after;
        written.add(dirname(outputPath));
        // Keep the reply short: by default only list what needs attention.
        if (details || result.after > result.before) lines.push(`${name} → ${basename(outputPath)}: ${result.text}`);
      }

      const failed = inputs.length - done;
      const where = written.size === 1 ? [...written][0] : `${written.size} folders`;
      const notes = [
        kept && `${kept} already lean, copied as is`,
        failed && `${failed} failed`,
        format && `files keep their names with a .${extensionFor(format)} extension`,
      ].filter(Boolean);
      const summary =
        done === 0
          ? `No images were compressed (${failed} failed).`
          : `Compressed ${done} of ${inputs.length} images into ${where}: ${formatBytes(before)} → ${formatBytes(after)} (${describeChange(before, after)})` +
            (notes.length ? `; ${notes.join('; ')}.` : '.');
      const report = lines.length ? [summary, '', ...lines].join('\n') : summary;
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
