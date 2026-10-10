# PressIt

A local image press. Drop in an image, resize it, pick a quality and an output format, choose whether to keep EXIF, compare before and after, and download. Everything runs on your machine: the API binds to `127.0.0.1` and keeps originals in memory only.

## Layout

```
apps/
  web/      React 19 + Vite UI (TypeScript)
  api/      Hono on Node, image processing with sharp (libvips + mozjpeg)
packages/
  shared/   Constants, types and zod schemas shared by both apps
```

## Requirements

- Node 20+
- pnpm 10+

## Commands

```sh
pnpm install
pnpm dev        # web on http://localhost:3104 (proxies /api), api on http://127.0.0.1:8787
pnpm test       # api tests, run against the real sharp pipeline
pnpm typecheck
pnpm build      # builds web, then bundles the api
pnpm start      # production: api serves the built web app on http://127.0.0.1:8787
```

`PORT` and `HOST` override the API's listen address.

`ALLOWED_HOSTS` in `apps/web/.env` adds comma-separated hostnames the Vite dev server accepts (see `apps/web/.env.example`).

## Features

- **Input:** drag and drop, click to browse, or paste from the clipboard. JPG, PNG, WebP and GIF (first frame only). Other formats sharp can decode, such as AVIF or TIFF, also compress, but the before preview needs the browser to support them. Max 50 MB.
- **Size:** 100/75/50/25% presets, a scale ruler from 5 to 100%, and exact width/height in pixels (up to 8000) with a LOCK/FREE aspect-ratio toggle.
- **Quality:** 1 to 100 for JPG (mozjpeg) and WebP. PNG is lossless, so the slider is disabled.
- **Format:** JPG, WebP or PNG. Transparent areas are flattened onto white for JPG.
- **EXIF:** STRIP (default) or KEEP. KEEP works for all three output formats. Pixels are rotated upright first and the orientation tag is reset, so the output never rotates twice.
- **Compare:** a draggable before/after split (arrow keys work too), plus before/after sizes and the percentage saved.

## API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/images` | multipart `file` | `201` `SourceInfo` (id, oriented width/height, EXIF size) |
| `POST` | `/api/images/:id/compress` | JSON `CompressOptions` | `200` image bytes, with `x-output-width`, `x-output-height`, `x-exif-kept` headers |
| `DELETE` | `/api/images/:id` | | `204` |
| `GET` | `/api/health` | | `{ ok: true }` |

The original is uploaded once. Each settings change then sends only a small JSON body. The API keeps at most 16 originals and evicts them after 30 idle minutes. If the API restarts, the web app uploads the image again on its own.

## License

[MIT](LICENSE)
