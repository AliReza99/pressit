import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { to } from 'await-to-js';
import { extensionFor, MAX_DIMENSION, MAX_UPLOAD_BYTES, type OutputFormat, type SourceInfo } from '@squeeze/shared';
import { compressImage, HttpError, releaseImage, uploadImage, type CompressedImage } from '../lib/api';
import { clamp, formatFromMime } from '../lib/format';

export const SCALE_MIN = 5;
export const SCALE_MAX = 100;
export const QUALITY_MIN = 1;
export const QUALITY_MAX = 100;

const DEBOUNCE_MS = 90;

export type Source = {
  file: File;
  url: string;
  info: SourceInfo;
  /**
   * Server-side id, mutable because it changes if the API restarted and the
   * image had to be uploaded again. Mutating it must not re-run compression.
   */
  remote: { id: string };
};

export type Output = CompressedImage & {
  url: string;
};

export type Dimensions = {
  w: number;
  h: number;
};

const isImage = (file: File) => file.type.startsWith('image/') || file.type === '';

export const useSqueeze = () => {
  const [source, setSource] = useState<Source | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [scale, setScaleValue] = useState(60);
  const [custom, setCustom] = useState<Dimensions | null>(null);
  const [lock, setLock] = useState(true);
  const [quality, setQuality] = useState(70);
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [keepExif, setKeepExif] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadToken = useRef(0);

  const dims = useMemo<Dimensions | null>(() => {
    if (!source) return null;
    if (custom) return custom;
    const { width, height } = source.info;
    return {
      w: Math.max(1, Math.round((width * scale) / 100)),
      h: Math.max(1, Math.round((height * scale) / 100)),
    };
  }, [source, custom, scale]);

  // Free object URLs and the server copy once a source or output is replaced.
  useEffect(() => {
    if (!source) return;
    return () => {
      URL.revokeObjectURL(source.url);
      releaseImage(source.remote.id);
    };
  }, [source]);

  useEffect(() => {
    if (!output) return;
    return () => URL.revokeObjectURL(output.url);
  }, [output]);

  const load = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!isImage(file)) return setError('That file is not an image');
    if (file.size > MAX_UPLOAD_BYTES) return setError('File is larger than 50 MB');

    const token = ++loadToken.current;
    setError(null);
    setUploading(true);
    const [err, info] = await to(uploadImage(file));
    if (token !== loadToken.current) return;
    setUploading(false);
    if (err) return setError(err.message);

    setSource({ file, url: URL.createObjectURL(file), info, remote: { id: info.id } });
    setOutput(null);
    setCustom(null);
    setFormat(formatFromMime(file.type));
  }, []);

  const w = dims?.w;
  const h = dims?.h;
  useEffect(() => {
    if (!source || !w || !h) return;
    const ctrl = new AbortController();
    const options = { width: w, height: h, quality, format, keepExif };

    const run = async () => {
      setWorking(true);
      let [err, result] = await to(compressImage(source.remote.id, options, ctrl.signal));

      if (err instanceof HttpError && err.status === 404) {
        const [uploadErr, info] = await to(uploadImage(source.file, ctrl.signal));
        if (!uploadErr) {
          source.remote.id = info.id;
          [err, result] = await to(compressImage(info.id, options, ctrl.signal));
        } else {
          err = uploadErr;
        }
      }

      if (ctrl.signal.aborted) return;
      setWorking(false);
      if (err || !result) return setError(err?.message ?? 'Compression failed');
      setError(null);
      setOutput({ ...result, url: URL.createObjectURL(result.blob) });
    };

    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [source, w, h, quality, format, keepExif]);

  const setScale = useCallback((value: number) => {
    setScaleValue(clamp(Math.round(value), SCALE_MIN, SCALE_MAX));
    setCustom(null);
  }, []);

  const applyDimension = useCallback(
    (key: keyof Dimensions, raw: number, locked: boolean) => {
      if (!source || !dims) return;
      const v = Math.min(MAX_DIMENSION, Math.round(raw));
      if (!(v >= 1)) return;
      const { width: ow, height: oh } = source.info;
      let { w: nw, h: nh } = dims;
      if (key === 'w') {
        nw = v;
        if (locked) nh = clamp(Math.round((v * oh) / ow), 1, MAX_DIMENSION);
      } else {
        nh = v;
        if (locked) nw = clamp(Math.round((v * ow) / oh), 1, MAX_DIMENSION);
      }
      setCustom({ w: nw, h: nh });
      setScaleValue(clamp(Math.round((nw / ow) * 100), SCALE_MIN, SCALE_MAX));
    },
    [source, dims],
  );

  const setDimension = useCallback((key: keyof Dimensions, raw: number) => applyDimension(key, raw, lock), [applyDimension, lock]);

  const toggleLock = useCallback(() => {
    const next = !lock;
    setLock(next);
    // Re-locking snaps height back to the original ratio for the current width.
    if (next && custom) applyDimension('w', custom.w, true);
  }, [lock, custom, applyDimension]);

  const download = useCallback(() => {
    if (!output || !source) return;
    const a = document.createElement('a');
    a.href = output.url;
    a.download = `${source.file.name.replace(/\.[^.]+$/, '')}-squeezed.${extensionFor(format)}`;
    a.click();
  }, [output, source, format]);

  return {
    source,
    output,
    dims,
    scale,
    isCustomSize: custom !== null,
    lock,
    quality,
    format,
    keepExif,
    uploading,
    working,
    error,
    load,
    setScale,
    setDimension,
    toggleLock,
    setQuality: (v: number) => setQuality(clamp(Math.round(v), QUALITY_MIN, QUALITY_MAX)),
    setFormat,
    setKeepExif,
    download,
  };
};

export type Squeeze = ReturnType<typeof useSqueeze>;
