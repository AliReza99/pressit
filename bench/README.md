# MCP benchmark

Runs headless Claude Code on a fresh copy of `images/` and records what the agent did: tool calls, time, tokens, cost, bytes saved, quality (SSIM) and whether it rewrote the originals. Your `~/.claude` settings and CLAUDE.md are skipped (`--setting-sources project`). The only MCP server is PressIt, or none at all.

```sh
mkdir -p /tmp/pb
echo '{"mcpServers":{"pressit":{"type":"http","url":"http://127.0.0.1:8787/mcp"}}}' > /tmp/pb/mcp-on.json
echo '{"mcpServers":{}}' > /tmp/pb/mcp-off.json

bench/matrix.sh v2 3 4                     # every model x prompt, with and without MCP, 3 runs each
python3 -I bench/analyze.py v2 --calls     # per-run table with every tool call
python3 -I bench/summary.py v2             # the numbers in docs/mcp-benchmark.jpg
```

`visual.html` is the source of `docs/mcp-benchmark.jpg`. Runs stop by themselves if the Claude usage limit is hit.
