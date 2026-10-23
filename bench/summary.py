"""Aggregates a tag's runs into the numbers the visual shows. usage: python3 -I bench/summary.py TAG > summary.json

The "bare" runs count as plain no-MCP runs: Claude Code's shell reloads PATH from the
user's profile, so the venv without Pillow never took effect.
"""
import json, sys
from pathlib import Path
from statistics import median, mean

tag = sys.argv[1]
runs = [json.loads(p.read_text()) for p in sorted(Path('/tmp/pb/runs').glob(f'{tag}-*/metrics.json'))]
runs = [m for m in runs if (m.get('turns') or 0) > 1 and not m.get('rate_limited')]
for m in runs:
    m['arm'] = 'with' if m['mcp'] == 'on' else 'without'

SCENARIOS = ('vague', 'web', 'task')
MODELS = ('haiku', 'sonnet', 'opus')


def stats(g):
    if not g:
        return None
    done = [m for m in g if m['images_done']]
    return {
        'n': len(g),
        'sec_median': round(median(m['duration_s'] for m in g), 1),
        'sec_mean': round(mean(m['duration_s'] for m in g), 1),
        'tools_median': median(m['tool_calls'] for m in g),
        'tools_mean': round(mean(m['tool_calls'] for m in g), 1),
        'out_tokens_median': median(m['output_tokens'] for m in g),
        'out_tokens_mean': round(mean(m['output_tokens'] for m in g)),
        'cost_mean': round(mean(m['cost_usd'] or 0 for m in g), 4),
        'peak_ctx_median': median(m['peak_context'] for m in g),
        'overwrote_runs': sum(1 for m in g if m['overwritten_originals'] or m['deleted_originals']),
        'overwrote_files': sum(m['overwritten_originals'] + m['deleted_originals'] for m in g),
        'mcp_used': sum(1 for m in g if m['mcp_used']),
        'no_output_runs': sum(1 for m in g if not m['images_done']),
        'saved_mean': round(mean(1 - m['out_bytes_done'] / m['orig_bytes_done'] for m in done), 3) if done else None,
        'ssim_mean': round(mean(m['mean_ssim'] for m in done), 3) if done else None,
    }


out = {'tag': tag, 'runs': len(runs), 'by': {}}
for arm in ('with', 'without'):
    g = [m for m in runs if m['arm'] == arm and m['scenario'] in SCENARIOS]
    out['by'][arm] = {'all': stats(g)}
    for sc in SCENARIOS:
        out['by'][arm][sc] = stats([m for m in g if m['scenario'] == sc])
    for model in MODELS:
        out['by'][arm][model] = stats([m for m in g if m['model'] == model])
        for sc in SCENARIOS:
            out['by'][arm][f'{model}/{sc}'] = stats([m for m in g if m['model'] == model and m['scenario'] == sc])
out['by']['explicit'] = stats([m for m in runs if m['scenario'] == 'explicit'])
print(json.dumps(out, indent=2))
