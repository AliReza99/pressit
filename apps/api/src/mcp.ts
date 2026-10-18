import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { to } from 'await-to-js';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { cropSchema, outputFormatSchema } from '@pressit/shared/schema';
import { MAX_DIMENSION, MAX_UPLOAD_BYTES, type ApiError, type OutputFormat } from '@pressit/shared';
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

const absolutePath = z.string().refine(isAbsolute, 'Must be an absolute path');

const compressInput = {
  inputPath: absolutePath.describe('Absolute path of the image to compress (JPG, PNG, WebP or GIF, up to 50 MB)'),
  outputPath: absolutePath.describe('Absolute path to write the result to. Missing folders are created'),
  format: outputFormatSchema.optional().describe('Output format. Defaults to the extension of outputPath'),
  quality: z.number().int().min(1).max(100).default(75).describe('1-100, ignored for PNG'),
  width: z.number().int().min(1).max(MAX_DIMENSION).optional().describe('Output width in px. Alone, keeps the aspect ratio'),
  height: z.number().int().min(1).max(MAX_DIMENSION).optional().describe('Output height in px. Alone, keeps the aspect ratio'),
  keepExif: z.boolean().default(false).describe('Keep camera, GPS and date metadata'),
  crop: cropSchema.optional().describe('Region of the upright image to keep, in source pixels, applied before resizing'),
  overwrite: z.boolean().default(false).describe('Replace outputPath if it already exists'),
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

const fail = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });

const createMcpServer = () => {
  const server = new McpServer({ name: 'pressit', version: '0.1.0' });

  server.registerTool(
    'compress_image',
    {
      title: 'Compress image',
      description:
        'Compress, resize, crop or convert an image file on this computer with PressIt, and save the result to outputPath.',
      inputSchema: compressInput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ inputPath, outputPath, overwrite, ...options }) => {
      const format = options.format ?? FORMAT_BY_EXTENSION[extname(outputPath).toLowerCase()];
      if (!format) return fail('Set format, or give outputPath a .jpg, .webp or .png extension');

      const [statErr, info] = await to(stat(inputPath));
      if (statErr || !info.isFile()) return fail(`Cannot read ${inputPath}`);
      if (info.size > MAX_UPLOAD_BYTES) return fail('File is larger than 50 MB');

      const [err, result] = await to(compressOneShot(await readFile(inputPath), { ...options, format }));
      if (err) return fail(err instanceof InputError ? err.message : 'Compression failed');

      await mkdir(dirname(outputPath), { recursive: true });
      const [writeErr] = await to(writeFile(outputPath, result.data, { flag: overwrite ? 'w' : 'wx' }));
      if (writeErr) {
        const exists = (writeErr as NodeJS.ErrnoException).code === 'EEXIST';
        return fail(exists ? `${outputPath} already exists, pass overwrite: true to replace it` : `Cannot write ${outputPath}`);
      }

      const saved = Math.round((1 - result.data.length / info.size) * 100);
      const change = saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`;
      return {
        content: [
          {
            type: 'text' as const,
            text: `Saved ${outputPath}: ${result.width}×${result.height} ${format}, ${kb(result.data.length)} (was ${kb(info.size)}, ${change})`,
          },
        ],
      };
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
