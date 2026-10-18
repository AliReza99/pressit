<p align="center">
  <img src="docs/logo.svg" alt="PressIt logo" width="96" height="96">
</p>

<h1 align="center">PressIt</h1>

<p align="center">Make your images smaller. On your own computer, no uploads.<br>
In your browser, or straight from your <a href="#use-it-from-your-ai-agent-mcp">AI agent</a>.</p>

<p align="center">
  <img src="docs/main.jpg" alt="PressIt comparing an original photo with a compressed version that is 66% smaller">
</p>

## What it does

- Drop, browse or paste images. Add as many as you like.
- Make them smaller: change size, quality and format (JPG, WebP, PNG).
- Crop to any shape.
- Drag the slider to compare before and after, and see how much space you saved.
- Remove hidden photo data (camera, GPS location, date) or keep it.
- Download one image or all of them.
- Starts an MCP server, so AI agents can compress the images in your project.

Your images never leave your computer.

## Install and use

1. Install [Node.js](https://nodejs.org) (version 20 or newer).
2. Open a terminal and run:

   ```sh
   git clone https://github.com/AliReza99/pressit.git
   cd pressit
   pnpm install
   pnpm build
   pnpm start
   ```

3. Open <http://127.0.0.1:8787> in your browser.

To stop PressIt, press `Ctrl+C` in the terminal. To start it again later, run `pnpm start` in the `pressit` folder.

## Use it from your AI agent (MCP)

While building a website or app, ask your AI agent to optimize its images, without leaving your editor. PressIt does the work on your computer.

**Set up once,** while PressIt is running:

```sh
claude mcp add --transport http --scope user pressit http://127.0.0.1:8787/mcp
```

**Then just ask,** for example:

- *"Compress the images in `public/images` before I deploy"*
- *"Convert the product photos in `src/assets/products` to WebP, 1200 px wide"*
- *"Resize `hero.jpg` to 50% and save it as `public/hero.webp`"*
- *"Shrink the screenshots in `docs/` and save them to `docs/optimized`"*

By default, images are resized to 70% at quality 70 and saved to a `compressed` folder next to them. Your originals are never changed.

To turn the MCP server off, run `pnpm mcp:off`. `pnpm mcp:on` turns it back on.

## Questions

**Which images work?** JPG, PNG, WebP and GIF, up to 50 MB each. For GIFs, only the first frame is kept.

**Port 8787 is already in use.** Pick another one: `PORT=9000 pnpm start`, then open <http://127.0.0.1:9000>.

## For developers

<details>
<summary>Project layout, commands and API</summary>

### Layout

```
apps/
  web/      React 19 + Vite UI (TypeScript)
  api/      Hono on Node, image processing with sharp (libvips + mozjpeg)
packages/
  shared/   Constants, types and zod schemas shared by both apps
```

### Commands

```sh
pnpm dev        # web on http://localhost:3104 (proxies /api), api on http://127.0.0.1:8787
pnpm test       # api tests, run against the real sharp pipeline
pnpm typecheck
pnpm build      # builds web, then bundles the api
pnpm start      # api serves the built web app on http://127.0.0.1:8787
```

`PORT` and `HOST` override the API's listen address.

`ALLOWED_HOSTS` in `apps/web/.env` adds comma-separated hostnames the Vite dev server accepts (see `apps/web/.env.example`).

### API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/images` | multipart `file` | `201` `SourceInfo` (id, oriented width/height, EXIF size) |
| `POST` | `/api/images/:id/compress` | JSON `CompressOptions` | `200` image bytes, with `x-output-width`, `x-output-height`, `x-exif-kept` headers |
| `DELETE` | `/api/images/:id` | | `204` |
| `POST` | `/api/compress` | multipart `file` + `options` (JSON `CompressOptions`, `width`/`height` optional) | `200` image bytes, same headers as above |
| `GET` | `/api/health` | | `{ ok: true }` |
| `POST` | `/mcp` | MCP over Streamable HTTP (stateless, JSON responses) | Tools `compress_image` and `compress_images`, see `apps/api/src/mcp.ts` |

The original is uploaded once to the local API. Each settings change then sends only a small JSON body. The API keeps at most 16 originals in memory and evicts them after 30 idle minutes. If the API restarts, the web app uploads the image again on its own.

For scripts and batch jobs, `POST /api/compress` does it in one request and stores nothing. A missing `width` or `height` is scaled to keep the aspect ratio, and with both missing the image keeps its size:

```sh
curl -sf http://127.0.0.1:8787/api/compress \
  -F file=@photo.jpg \
  -F 'options={"width":1600,"quality":75,"format":"webp","keepExif":false}' \
  -o photo.webp
```

`/mcp` is served by the same process as the API but sits outside `/api`, so the Vite dev proxy never forwards it. It rejects any request whose `Host` or `Origin` is not loopback, and returns `404` while `.pressit-mcp-disabled` exists in the repo root (that is all `pnpm mcp:off` does).

</details>

## License

[MIT](LICENSE)
