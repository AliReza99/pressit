"""Summarizes bench runs. usage: python3 -I bench/analyze.py TAG [--calls]"""
import json, sys
from pathlib import Path
from statistics import mean

tag = sys.argv[1]
show_calls = '--calls' in sys.argv
runs = [json.loads(p.read_text()) for p in sorted(Path('/tmp/pb/runs').glob(f'{tag}-*/metrics.json'))]


def short(c):
    i = c['input']
    if c['name'] == 'Bash':
        return 'Bash: ' + i.get('command', '').replace('\n', ' ⏎ ')[:140]
    if c['name'].startswith('mcp__'):
        return c['name'].split('__')[-1] + ' ' + json.dumps({k: (v if k != 'inputPaths' else f'[{len(v)} paths]') for k, v in i.items()})[:200]
    return c['name'] + ' ' + json.dumps(i)[:120]


hdr = f"{'run':38} {'mcp#':>4} {'tools':>5} {'turns':>5} {'sec':>6} {'$':>6} {'peakctx':>7} {'outtok':>6} {'imgRd':>5} {'done':>4} {'saved':>5} {'ssim':>5} {'ow':>3}"
print(hdr)
for m in runs:
    saved = 1 - m['out_bytes_done'] / m['orig_bytes_done'] if m['orig_bytes_done'] else 0
    print(f"{m['run_id']:38} {m['mcp_calls']:>4} {m['tool_calls']:>5} {m['turns'] or 0:>5} {m['duration_s']:>6} {m['cost_usd'] or 0:>6.3f} "
          f"{m['peak_context']:>7} {m['output_tokens']:>6} {m['image_reads']:>5} {m['images_done']:>4} {saved:>5.0%} {m['mean_ssim'] or 0:>5.3f} {m['overwritten_originals']:>3}")
    if show_calls:
        for c in m['calls']:
            print('      ', short(c))

print('\nby mcp x model (mean):')
for mcp in ('on', 'off', 'off_bare'):
    for model in ('haiku', 'sonnet', 'opus'):
        g = [m for m in runs if m['mcp'] == mcp and m['model'] == model]
        if g:
            print(f"  {mcp:3} {model:6} n={len(g)} sec={mean(m['duration_s'] for m in g):6.1f} $={mean(m['cost_usd'] or 0 for m in g):.3f} "
                  f"tools={mean(m['tool_calls'] for m in g):5.1f} outtok={mean(m['output_tokens'] for m in g):7.0f} "
                  f"mcpUsed={sum(m['mcp_used'] for m in g)}/{len(g)}")
