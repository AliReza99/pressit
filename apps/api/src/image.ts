import sharp from 'sharp';
import { MAX_DIMENSION, type CompressOptions, type Crop, type OneShotOptions } from '@pressit/shared';

// Refuse decompression bombs: 8000×8000 output max, allow a generous source.
const LIMIT_INPUT_PIXELS = 20_000 * 20_000;

const open = (input: Buffer) =>
  sharp(input, { animated: false, failOn: 'error', limitInputPixels: LIMIT_INPUT_PIXELS });

export type InspectResult = {
  width: number;
  height: number;
  format: string;
  exifBytes: number;
};

export const inspect = async (input: Buffer): Promise<InspectResult> => {
  const meta = await open(input).metadata();
  // `autoOrient` holds the dimensions after EXIF rotation, which is what the
  // browser renders and what the user types into the width/height fields.
  const { width, height } = meta.autoOrient;
  return {
    width,
    height,
    format: meta.format,
    exifBytes: meta.exif?.length ?? 0,
  };
};

export type CompressResult = {
  data: Buffer;
  width: number;
  height: number;
  exifKept: boolean;
};

export const compress = async (
  input: Buffer,
  { width, height, quality, format, keepExif, crop }: CompressOptions,
  sourceHasExif: boolean,
): Promise<CompressResult> => {
  // Pixels are rotated upright, so the kept EXIF must not rotate them again.
  // libvips drops the orientation tag during autoOrient.
  let pipeline = open(input).autoOrient();
  // Called before resize, so the crop is taken from the upright source pixels.
  if (crop) pipeline = pipeline.extract(crop);
  pipeline = pipeline.resize(width, height, { fit: 'fill' });

  switch (format) {
    case 'jpeg':
      pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality, effort: 5 });
      break;
    case 'png':
      // PNG is lossless, quality does not apply.
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 8 });
      break;
  }

  const exifKept = keepExif && sourceHasExif;
  if (exifKept) pipeline = pipeline.keepExif();

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, exifKept };
};

type Size = { width: number; height: number };

export const cropOutside = (crop: Crop | undefined, source: Size) =>
  !!crop && (crop.left + crop.width > source.width || crop.top + crop.height > source.height);

/** Fills a missing side from the aspect ratio of the cropped (or whole) source. */
const resolveSize = ({ width, height }: OneShotOptions, base: Size): Size => {
  if (width && height) return { width, height };
  if (width) return { width, height: Math.max(1, Math.round((base.height * width) / base.width)) };
  if (height) return { width: Math.max(1, Math.round((base.width * height) / base.height)), height };
  // Copy only the size: `base` may be the inspect result, whose `format` would override the requested one.
  return { width: base.width, height: base.height };
};

/** A problem with the caller's image or options, as opposed to a pipeline failure. */
export class InputError extends Error {
  constructor(
    readonly status: 400 | 415,
    message: string,
  ) {
    super(message);
  }
}

/** Inspects and compresses in one go, for callers that do not keep the source around. */
export const compressOneShot = async (input: Buffer, options: OneShotOptions): Promise<CompressResult> => {
  const meta = await inspect(input).catch(() => {
    throw new InputError(415, 'Not a supported image');
  });
  const { crop } = options;
  if (cropOutside(crop, meta)) throw new InputError(400, 'Crop is outside the image');
  const size = resolveSize(options, crop ?? meta);
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    throw new InputError(400, `Output is larger than ${MAX_DIMENSION} px, set a smaller width or height`);
  }
  return compress(input, { ...options, ...size }, meta.exifBytes > 0);
};
