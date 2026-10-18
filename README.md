<p align="center">
  <img src="docs/logo.svg" alt="PressIt logo" width="96" height="96">
</p>

<h1 align="center">PressIt</h1>

<p align="center">Make your images smaller. On your own computer, no uploads.</p>

<p align="center">
  <img src="docs/main.png" alt="PressIt comparing an original photo with a compressed version that is 72% smaller">
</p>

## What it does

- Drop, browse or paste images. Add as many as you like.
- Make them smaller: change size, quality and format (JPG, WebP, PNG).
- Crop to any shape.
- Drag the slider to compare before and after, and see how much space you saved.
- Remove hidden photo data (camera, GPS location, date) or keep it.
- Download one image or all of them.
- Let AI assistants like Claude Code compress images for you, through the built-in [MCP server](#use-with-ai-assistants-mcp).

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

<p align="center">
  <img src="docs/crop.png" alt="Cropping a photo in PressIt">
</p>

## Update

```sh
git pull
pnpm install
pnpm build
```

## Use with AI assistants (MCP)

PressIt includes an [MCP](https://modelcontextprotocol.io) server, so AI assistants can compress image files on your computer for you. Ask something like *"compress the images in ~/Downloads/photos"* and it is done in one step, with the same quality as the app.

| Tool | What it does |
| --- | --- |
| `compress_image` | Compresses, resizes, crops or converts one image |
| `compress_images` | Does a whole folder, or a list of images, in one go |

Unless you ask for something else, images are shrunk to 70% size at quality 70 and keep their format. `compress_images` saves them into a `compressed` folder next to the originals. You can ask for any size, quality or format, for example *"convert them to WebP at 50% size"*.

### Set it up

1. **Start PressIt** as described in [Install and use](#install-and-use). The MCP server runs inside PressIt at `http://127.0.0.1:8787/mcp`, so it works only while PressIt is running. It is on by default.

2. **Connect your AI assistant.**

   With [Claude Code](https://claude.com/claude-code), run this once to use PressIt from any folder:

   ```sh
   claude mcp add --transport http --scope user pressit http://127.0.0.1:8787/mcp
   ```

   Inside the `pressit` folder you can skip this: Claude Code finds the server in `.mcp.json` and asks once before using it.

   Other apps that support MCP over HTTP need the same address, `http://127.0.0.1:8787/mcp`. Where to enter it depends on the app.

3. **Check it works.** Start a new Claude Code session and run `/mcp`. `pressit` should be listed as connected. Then ask *"which pressit tools do you have?"*.

If you started PressIt on another port with `PORT=...`, use that port in the address.

### Turn it off or on

Run one of these in the `pressit` folder. It takes effect right away, no restart needed:

```sh
pnpm mcp:off      # turn it off
pnpm mcp:on       # turn it back on
pnpm mcp:status   # check whether it is on
```

### Safety

- It only answers requests from your own computer.
- It never changes your original images, and never replaces an existing file unless you ask it to.

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
