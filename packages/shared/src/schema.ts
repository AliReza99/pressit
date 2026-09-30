import { z } from 'zod';
import { MAX_DIMENSION, OUTPUT_FORMATS } from './index.js';

// Kept apart from the main entry so the web bundle does not pull in zod.
export const outputFormatSchema = z.enum(OUTPUT_FORMATS);

/** Region of the upright (EXIF-rotated) source to keep, in source pixels. */
export const cropSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});

export const compressOptionsSchema = z.object({
  width: z.number().int().min(1).max(MAX_DIMENSION),
  height: z.number().int().min(1).max(MAX_DIMENSION),
  quality: z.number().int().min(1).max(100),
  format: outputFormatSchema,
  keepExif: z.boolean(),
  crop: cropSchema.optional(),
});
