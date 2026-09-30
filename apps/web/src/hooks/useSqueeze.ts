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

export type Output = CompressedImage & {
  url: string;
};

export type Dimensions = {
  w: number;
  h: number;
};

export type Settings = {
  scale: number;
  /** Explicit size that overrides `scale`, null while following the scale. */
  custom: Dimensions | null;
  quality: number;
  format: OutputFormat;
  keepExif: boolean;
};

export type Item = {
  key: string;
  file: File;
  /** Editable download name, without extension. */
  name: string;
  url: string;
  info: SourceInfo;
  /**
   * Server-side id, mutable because it changes if the API restarted and the
   * image had to be uploaded again. Mutating it must not re-run compression.
   */
  remote: { id: string };
  settings: Settings;
  output: Output | null;
  working: boolean;
  error: string | null;
};

const isImage = (file: File) => file.type.startsWith('image/') || file.type === '';

const dimsOf = ({ info, settings }: Item): Dimensions =>
  settings.custom ?? {
    w: Math.max(1, Math.round((info.width * settings.scale) / 100)),
    h: Math.max(1, Math.round((info.height * settings.scale) / 100)),
  };

const defaultName = (file: File) => `${file.name.replace(/\.[^.]+$/, '')}-squeezed`;

const downloadName = ({ name, settings }: Item) => `${name}.${extensionFor(settings.format)}`;

const save = (item: Item) => {
  if (!item.output) return;
  const a = document.createElement('a');
  a.href = item.output.url;
  a.download = downloadName(item);
  a.click();
};

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Settings used before any image exists, and the starting point for new images. */
type Defaults = Omit<Settings, 'custom' | 'format'> & { format: OutputFormat | null };

const DEFAULTS: Defaults = { scale: 60, quality: 70, format: null, keepExif: false };
const STORAGE_KEY = 'squeeze:settings';
const FORMATS: readonly OutputFormat[] = ['jpeg', 'webp', 'png'];

const readDefaults = (): Defaults => {
  try {
    const raw: Partial<Defaults> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      scale: typeof raw.scale === 'number' ? clamp(Math.round(raw.scale), SCALE_MIN, SCALE_MAX) : DEFAULTS.scale,
      quality: typeof raw.quality === 'number' ? clamp(Math.round(raw.quality), QUALITY_MIN, QUALITY_MAX) : DEFAULTS.quality,
      format: FORMATS.find(f => f === raw.format) ?? null,
      keepExif: typeof raw.keepExif === 'boolean' ? raw.keepExif : DEFAULTS.keepExif,
    };
  } catch {
    return DEFAULTS;
  }
};

export const useSqueeze = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [defaults, setDefaults] = useState(readDefaults);
  const [lock, setLock] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const nextKey = useRef(0);
  const jobs = useRef(new Map<string, { sig: string; cancel: () => void }>());

  const active = useMemo(() => items.find(i => i.key === activeKey) ?? null, [items, activeKey]);
  const dims = useMemo(() => (active ? dimsOf(active) : null), [active]);

  const patch = useCallback((key: string, change: Partial<Item> | ((item: Item) => Partial<Item>)) => {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, ...(typeof change === 'function' ? change(i) : change) } : i)));
  }, []);

  const patchSettings = useCallback(
    (key: string, change: Partial<Settings>) => patch(key, i => ({ settings: { ...i.settings, ...change } })),
    [patch],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    } catch {
      // Storage unavailable (private mode, quota): settings just won't persist.
    }
  }, [defaults]);

  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  // Free object URLs, server copies and pending requests on unmount.
  useEffect(() => {
    const running = jobs.current;
    return () => {
      for (const job of running.values()) job.cancel();
      running.clear();
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.url);
        if (item.output) URL.revokeObjectURL(item.output.url);
        releaseImage(item.remote.id);
      }
    };
  }, []);

  const load = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return;
    const images = files.filter(isImage);
    const valid = images.filter(f => f.size <= MAX_UPLOAD_BYTES);
    if (valid.length === 0) {
      const plural = files.length > 1;
      return setError(images.length === 0 ? `${plural ? 'Those files are' : 'That file is'} not an image` : `${plural ? 'Files are' : 'File is'} larger than 50 MB`);
    }

    const skipped = files.length - valid.length;
    setError(null);
    setNotice(skipped ? `${skipped} file${skipped > 1 ? 's' : ''} skipped, not an image or over 50 MB` : null);
    setPending(n => n + valid.length);

    let first = true;
    let failure: string | null = null;
    // One at a time so the API is not flooded and thumbnails appear in order.
    for (const file of valid) {
      const [err, info] = await to(uploadImage(file));
      setPending(n => n - 1);
      if (err) {
        failure = err.message;
        continue;
      }
      const current = itemsRef.current.find(i => i.key === activeKeyRef.current)?.settings;
      const base = defaultsRef.current;
      const inherited = current ?? { scale: base.scale, quality: base.quality, keepExif: base.keepExif, format: base.format };
      const item: Item = {
        key: String(++nextKey.current),
        file,
        name: defaultName(file),
        url: URL.createObjectURL(file),
        info,
        remote: { id: info.id },
        settings: { ...inherited, custom: null, format: inherited.format ?? formatFromMime(file.type) },
        output: null,
        working: false,
        error: null,
      };
      setItems(prev => [...prev, item]);
      if (first) setActiveKey(item.key);
      first = false;
    }
    if (failure) setError(failure);
  }, []);

  const schedule = useCallback(
    (item: Item, { w, h }: Dimensions) => {
      const ctrl = new AbortController();
      const { quality, format, keepExif } = item.settings;
      const options = { width: w, height: h, quality, format, keepExif };

      const run = async () => {
        patch(item.key, { working: true });
        let [err, result] = await to(compressImage(item.remote.id, options, ctrl.signal));

        if (err instanceof HttpError && err.status === 404) {
          const [uploadErr, info] = await to(uploadImage(item.file, ctrl.signal));
          if (!uploadErr) {
            item.remote.id = info.id;
            [err, result] = await to(compressImage(info.id, options, ctrl.signal));
          } else {
            err = uploadErr;
          }
        }

        if (ctrl.signal.aborted) return;
        if (err || !result) return patch(item.key, { working: false, error: err?.message ?? 'Compression failed' });
        const previous = itemsRef.current.find(i => i.key === item.key)?.output;
        if (previous) URL.revokeObjectURL(previous.url);
        patch(item.key, { working: false, error: null, output: { ...result, url: URL.createObjectURL(result.blob) } });
      };

      const timer = setTimeout(run, DEBOUNCE_MS);
      return () => {
        clearTimeout(timer);
        ctrl.abort();
      };
    },
    [patch],
  );

  // Every image is compressed in the background, not just the visible one, so
  // "download all" is ready. A job restarts only when its inputs change.
  useEffect(() => {
    const running = jobs.current;
    const live = new Set<string>();
    for (const item of items) {
      live.add(item.key);
      const d = dimsOf(item);
      const { quality, format, keepExif } = item.settings;
      const sig = [d.w, d.h, quality, format, keepExif].join('|');
      const job = running.get(item.key);
      if (job?.sig === sig) continue;
      job?.cancel();
      running.set(item.key, { sig, cancel: schedule(item, d) });
    }
    for (const [key, job] of running) {
      if (live.has(key)) continue;
      job.cancel();
      running.delete(key);
    }
  }, [items, schedule]);

  const rename = useCallback(
    (key: string, name: string) => {
      // Path separators and control characters are not valid in download names.
      const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
      const item = itemsRef.current.find(i => i.key === key);
      if (item) patch(key, { name: clean || defaultName(item.file) });
    },
    [patch],
  );

  const select = useCallback((key: string) => setActiveKey(key), []);

  const remove = useCallback((key: string) => {
    const list = itemsRef.current;
    const index = list.findIndex(i => i.key === key);
    const item = list[index];
    if (!item) return;
    URL.revokeObjectURL(item.url);
    if (item.output) URL.revokeObjectURL(item.output.url);
    releaseImage(item.remote.id);
    setItems(prev => prev.filter(i => i.key !== key));
    if (activeKeyRef.current === key) setActiveKey((list[index + 1] ?? list[index - 1])?.key ?? null);
    setError(null);
  }, []);

  const clear = useCallback(() => {
    for (const item of itemsRef.current) {
      URL.revokeObjectURL(item.url);
      if (item.output) URL.revokeObjectURL(item.output.url);
      releaseImage(item.remote.id);
    }
    setItems([]);
    setActiveKey(null);
    setError(null);
    setNotice(null);
  }, []);

  /** Updates the visible image, and remembers the value for new images and the next visit. */
  const change = useCallback(
    (next: Partial<Omit<Settings, 'custom'>>, item: Partial<Settings> = next) => {
      setDefaults(d => ({ ...d, ...next }));
      if (activeKey) patchSettings(activeKey, item);
    },
    [activeKey, patchSettings],
  );

  const setScale = useCallback(
    (value: number) => {
      const scale = clamp(Math.round(value), SCALE_MIN, SCALE_MAX);
      change({ scale }, { scale, custom: null });
    },
    [change],
  );

  const applyDimension = useCallback(
    (key: keyof Dimensions, raw: number, locked: boolean) => {
      if (!active || !dims) return;
      const v = Math.min(MAX_DIMENSION, Math.round(raw));
      if (!(v >= 1)) return;
      const { width: ow, height: oh } = active.info;
      let { w: nw, h: nh } = dims;
      if (key === 'w') {
        nw = v;
        if (locked) nh = clamp(Math.round((v * oh) / ow), 1, MAX_DIMENSION);
      } else {
        nh = v;
        if (locked) nw = clamp(Math.round((v * ow) / oh), 1, MAX_DIMENSION);
      }
      change({ scale: clamp(Math.round((nw / ow) * 100), SCALE_MIN, SCALE_MAX) }, { custom: { w: nw, h: nh }, scale: clamp(Math.round((nw / ow) * 100), SCALE_MIN, SCALE_MAX) });
    },
    [active, dims, change],
  );

  const setDimension = useCallback((key: keyof Dimensions, raw: number) => applyDimension(key, raw, lock), [applyDimension, lock]);

  const toggleLock = useCallback(() => {
    const next = !lock;
    setLock(next);
    // Re-locking snaps height back to the original ratio for the current width.
    if (next && active?.settings.custom) applyDimension('w', active.settings.custom.w, true);
  }, [lock, active, applyDimension]);

  const setQuality = useCallback((v: number) => change({ quality: clamp(Math.round(v), QUALITY_MIN, QUALITY_MAX) }), [change]);
  const setFormat = useCallback((format: OutputFormat) => change({ format }), [change]);
  const setKeepExif = useCallback((keepExif: boolean) => change({ keepExif }), [change]);

  /** Copies the visible image's quality, format and scale to every image. */
  const applyToAll = useCallback(() => {
    if (!active) return;
    const { scale, quality, format, keepExif } = active.settings;
    setItems(prev => prev.map(i => ({ ...i, settings: { scale, quality, format, keepExif, custom: null } })));
  }, [active]);

  const download = useCallback(() => active && save(active), [active]);

  const downloadAll = useCallback(async () => {
    for (const item of itemsRef.current) {
      save(item);
      // Browsers drop downloads fired in the same tick.
      await pause(150);
    }
  }, []);

  const settings = active?.settings;

  return {
    items,
    activeKey,
    source: active,
    output: active?.output ?? null,
    dims,
    scale: settings?.scale ?? defaults.scale,
    isCustomSize: settings?.custom != null,
    lock,
    quality: settings?.quality ?? defaults.quality,
    format: settings?.format ?? defaults.format ?? 'jpeg',
    keepExif: settings?.keepExif ?? defaults.keepExif,
    uploading: pending > 0,
    working: items.some(i => i.working),
    readyCount: items.filter(i => i.output && !i.working).length,
    error: error ?? active?.error ?? null,
    notice,
    load,
    select,
    rename,
    remove,
    clear,
    setScale,
    setDimension,
    toggleLock,
    setQuality,
    setFormat,
    setKeepExif,
    applyToAll,
    download,
    downloadAll,
  };
};

export type Squeeze = ReturnType<typeof useSqueeze>;
