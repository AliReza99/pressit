import type { Crop } from '@pressit/shared';
import { clamp } from './format';

/** Crop rectangle in source pixels, fractional while it is being dragged. */
export type Rect = { left: number; top: number; width: number; height: number };

/** Which edges a handle moves: -1 the left/top edge, 1 the right/bottom edge, 0 neither. */
export type Handle = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export const fullRect = (width: number, height: number): Rect => ({ left: 0, top: 0, width, height });

/** Largest rect with the given width/height ratio that fits inside `bounds`, centered on it. */
export const fitAspect = (bounds: Rect, ratio: number): Rect => {
  const width = Math.min(bounds.width, bounds.height * ratio);
  const height = width / ratio;
  return { left: bounds.left + (bounds.width - width) / 2, top: bounds.top + (bounds.height - height) / 2, width, height };
};

/** Moves `rect` so its center sits at (cx, cy), kept inside the image. */
export const centerAt = (rect: Rect, cx: number, cy: number, imageW: number, imageH: number): Rect => ({
  ...rect,
  left: clamp(cx - rect.width / 2, 0, imageW - rect.width),
  top: clamp(cy - rect.height / 2, 0, imageH - rect.height),
});

/**
 * Reshapes `rect` to a new ratio keeping its area and center, shrunk to fit
 * the image. Keeping the area makes a portrait/landscape swap reversible.
 */
export const withAspect = (rect: Rect, ratio: number, imageW: number, imageH: number): Rect => {
  const area = rect.width * rect.height;
  const k = Math.min(1, imageW / Math.sqrt(area * ratio), imageH / Math.sqrt(area / ratio));
  const width = Math.sqrt(area * ratio) * k;
  const height = width / ratio;
  return centerAt({ left: 0, top: 0, width, height }, rect.left + rect.width / 2, rect.top + rect.height / 2, imageW, imageH);
};

export const moveRect =(start: Rect, dx: number, dy: number, imageW: number, imageH: number): Rect => ({
  ...start,
  left: clamp(start.left + dx, 0, imageW - start.width),
  top: clamp(start.top + dy, 0, imageH - start.height),
});

/**
 * Drags one handle by (dx, dy) source pixels. With a ratio, the corner opposite
 * the handle stays put (an edge handle keeps the rect centered on the other
 * axis) and the rect is kept inside the image at that ratio.
 */
export const resizeRect = (start: Rect, handle: Handle, dx: number, dy: number, imageW: number, imageH: number, min: number, ratio: number | null): Rect => {
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  const cx = start.left + start.width / 2;
  const cy = start.top + start.height / 2;
  // Room available on each axis while the anchor stays fixed.
  const roomX = handle.x === 1 ? imageW - start.left : handle.x === -1 ? right : 2 * Math.min(cx, imageW - cx);
  const roomY = handle.y === 1 ? imageH - start.top : handle.y === -1 ? bottom : 2 * Math.min(cy, imageH - cy);

  if (ratio === null) {
    const width = handle.x ? clamp(start.width + handle.x * dx, Math.min(min, roomX), roomX) : start.width;
    const height = handle.y ? clamp(start.height + handle.y * dy, Math.min(min, roomY), roomY) : start.height;
    return {
      left: handle.x === -1 ? right - width : start.left,
      top: handle.y === -1 ? bottom - height : start.top,
      width,
      height,
    };
  }

  const fromX = start.width + handle.x * dx;
  const fromY = (start.height + handle.y * dy) * ratio;
  const wanted = handle.x && handle.y ? Math.max(fromX, fromY) : handle.x ? fromX : fromY;
  const maxW = Math.min(roomX, roomY * ratio);
  const width = clamp(wanted, Math.min(Math.max(min, min * ratio), maxW), maxW);
  const height = width / ratio;
  return {
    left: handle.x === 1 ? start.left : handle.x === -1 ? right - width : cx - width / 2,
    top: handle.y === 1 ? start.top : handle.y === -1 ? bottom - height : cy - height / 2,
    width,
    height,
  };
};

/** Whole-pixel crop for the API, null when it keeps the entire image. */
export const toCrop = (rect: Rect, imageW: number, imageH: number): Crop | null => {
  const left = clamp(Math.round(rect.left), 0, imageW - 1);
  const top = clamp(Math.round(rect.top), 0, imageH - 1);
  const width = clamp(Math.round(rect.width), 1, imageW - left);
  const height = clamp(Math.round(rect.height), 1, imageH - top);
  return left === 0 && top === 0 && width === imageW && height === imageH ? null : { left, top, width, height };
};

export const sameCrop = (a: Crop | null | undefined, b: Crop | null | undefined) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/**
 * Positions the full source image so only `crop` fills a frame of any size.
 * Percentages are per axis, so a stretched output frame stretches it the same way.
 */
export const cropImageStyle = (crop: Crop | null, imageW: number, imageH: number) =>
  crop && {
    position: 'absolute' as const,
    maxWidth: 'none',
    width: `${(imageW / crop.width) * 100}%`,
    height: `${(imageH / crop.height) * 100}%`,
    left: `${(-crop.left / crop.width) * 100}%`,
    top: `${(-crop.top / crop.height) * 100}%`,
  };
