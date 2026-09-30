import { z } from 'zod';
import { MAX_DIMENSION, OUTPUT_FORMATS } from './index.js';

// Kept apart from the main entry so the web bundle does not pull in zod.
export const outputFormatSchema = z.enum(OUTPUT_FORMATS);

export const compressOptionsSchema = z.object({
  width: z.number().int().min(1).max(MAX_DIMENSION),
  height: z.number().int().min(1).max(MAX_DIMENSION),
  quality: z.number().int().min(1).max(100),
  format: outputFormatSchema,
  keepExif: z.boolean(),
});
