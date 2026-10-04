import type { OutputFormat } from '@pressit/shared';

export const formatBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;

export const formatFromMime = (mime: string): OutputFormat =>
  mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpeg';

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
