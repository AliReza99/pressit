import { to } from 'await-to-js';
import { OUTPUT_HEADERS, type ApiError, type CompressOptions, type SourceInfo } from '@pressit/shared';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const readError = async (res: Response): Promise<HttpError> => {
  const [, body] = await to<ApiError>(res.json());
  return new HttpError(res.status, body?.error ?? `Request failed (${res.status})`);
};

const request = async (input: string, init: RequestInit): Promise<Response> => {
  const [err, res] = await to(fetch(input, init));
  if (err) throw err.name === 'AbortError' ? err : new HttpError(0, 'API is not reachable, is it running?');
  if (!res.ok) throw await readError(res);
  return res;
};

export const uploadImage = async (file: File, signal?: AbortSignal): Promise<SourceInfo> => {
  const body = new FormData();
  body.append('file', file);
  const res = await request('/api/images', { method: 'POST', body, signal });
  return res.json() as Promise<SourceInfo>;
};

export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
  exifKept: boolean;
};

export const compressImage = async (id: string, options: CompressOptions, signal?: AbortSignal): Promise<CompressedImage> => {
  const res = await request(`/api/images/${id}/compress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
    signal,
  });
  return {
    blob: await res.blob(),
    width: Number(res.headers.get(OUTPUT_HEADERS.width)),
    height: Number(res.headers.get(OUTPUT_HEADERS.height)),
    exifKept: res.headers.get(OUTPUT_HEADERS.exifKept) === 'true',
  };
};

export const releaseImage = (id: string) => {
  // Best effort cleanup, the server also evicts idle sources on its own.
  void fetch(`/api/images/${id}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
};
