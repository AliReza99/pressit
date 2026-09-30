import sharp from 'sharp';
import type { CompressOptions } from '@squeeze/shared';

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
  { width, height, quality, format, keepExif }: CompressOptions,
  sourceHasExif: boolean,
): Promise<CompressResult> => {
  // Pixels are rotated upright, so the kept EXIF must not rotate them again.
  // libvips drops the orientation tag during autoOrient.
  let pipeline = open(input).autoOrient().resize(width, height, { fit: 'fill' });

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
