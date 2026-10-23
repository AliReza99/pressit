# pressit-mcp

MCP server that compresses, resizes and converts images (JPG, PNG, WebP, GIF) on your computer. No API key, no uploads. Originals are never changed.

```sh
claude mcp add --scope user pressit -- npx -y pressit-mcp@latest
```

Other agents:

```json
{
  "mcpServers": {
    "pressit": {
      "command": "npx",
      "args": ["-y", "pressit-mcp@latest"]
    }
  }
}
```

Tools: `compress_image` (one file) and `compress_images` (a folder or a list of files). More, and the PressIt web app, at [github.com/AliReza99/pressit](https://github.com/AliReza99/pressit).
