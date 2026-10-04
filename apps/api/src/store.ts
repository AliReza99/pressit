import type { SourceInfo } from '@pressit/shared';

type Entry = {
  buffer: Buffer;
  info: SourceInfo;
  touchedAt: number;
};

type SourceStoreOptions = {
  maxEntries: number;
  ttlMs: number;
};

/**
 * Keeps uploaded originals in memory so each settings change only sends a few
 * bytes of JSON instead of re-uploading the image. Least recently used entries
 * are dropped first, and anything idle past the TTL is evicted.
 */
export const createSourceStore = ({ maxEntries, ttlMs }: SourceStoreOptions) => {
  const entries = new Map<string, Entry>();

  const prune = (now: number) => {
    for (const [id, entry] of entries) {
      if (now - entry.touchedAt > ttlMs) entries.delete(id);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    put(buffer: Buffer, info: SourceInfo) {
      const now = Date.now();
      entries.set(info.id, { buffer, info, touchedAt: now });
      prune(now);
    },
    get(id: string): Entry | undefined {
      const now = Date.now();
      prune(now);
      const entry = entries.get(id);
      if (!entry) return undefined;
      // Re-insert so Map order tracks recency.
      entries.delete(id);
      entry.touchedAt = now;
      entries.set(id, entry);
      return entry;
    },
    delete(id: string) {
      return entries.delete(id);
    },
    get size() {
      return entries.size;
    },
  };
};

export type SourceStore = ReturnType<typeof createSourceStore>;
