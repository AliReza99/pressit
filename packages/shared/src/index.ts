import type { z } from 'zod';
import type { compressOptionsSchema, oneShotOptionsSchema } from './schema.js';

export const MAX_DIMENSION = 8000;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const OUTPUT_FORMATS = ['jpeg', 'webp', 'png'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type CompressOptions = z.infer<typeof compressOptionsSchema>;
export type Crop = NonNullable<CompressOptions['crop']>;
export type OneShotOptions = z.infer<typeof oneShotOptionsSchema>;

/** Returned by `POST /api/images` after the source is stored. */
export type SourceInfo = {
  id: string;
  name: string;
  size: number;
  /** Dimensions after EXIF orientation is applied, matching what the browser shows. */
  width: number;
  height: number;
  format: string;
  /** Byte length of the EXIF block, 0 when none. */
  exifBytes: number;
};

export type ApiError = {
  error: string;
};

/** Response headers set by `POST /api/images/:id/compress` and `POST /api/compress`. */
export const OUTPUT_HEADERS = {
  width: 'x-output-width',
  height: 'x-output-height',
  exifKept: 'x-exif-kept',
} as const;

export const extensionFor = (format: OutputFormat): string => (format === 'jpeg' ? 'jpg' : format);
