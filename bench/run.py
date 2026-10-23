"""Runs one headless Claude Code session on a fresh copy of the test images and records what it did.

usage: python3 -I bench/run.py --model sonnet --scenario vague --mcp on [--rep 1] [--tag v1]
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / 'images'
BENCH = Path('/tmp/pb')
IMG_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'}

SCENARIOS = {
    'vague': ('folder', "The images in this folder are way too heavy. Can you compress them?"),
    'web': ('folder', "I'm putting these product photos on my website. Optimize them for the web."),
    'task': ('project', "Add a product gallery section to index.html that shows every image in public/products. "
                        "Those images are huge though, so make them web-ready too."),
    'explicit': ('folder', "Compress the images in this folder using pressit."),
}

INDEX_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Northwind Outfitters</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <header><h1>Northwind Outfitters</h1><p>Gear for cold mornings.</p></header>
  <main id="app"></main>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
"""


def build_workspace(kind: str, ws: Path) -> Path:
    ws.mkdir(parents=True)
    if kind == 'folder':
        target = ws
    else:
        (ws / 'src').mkdir()
        (ws / 'index.html').write_text(INDEX_HTML)
        (ws / 'src/main.js').write_text("document.querySelector('#app').textContent = 'Welcome!';\n")
        (ws / 'src/style.css').write_text("body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 2rem; }\n")
        (ws / 'package.json').write_text(json.dumps({
            'name': 'northwind-shop', 'private': True, 'type': 'module',
            'scripts': {'dev': 'vite', 'build': 'vite build'}, 'devDependencies': {'vite': '^7.0.0'},
        }, indent=2) + '\n')
        target = ws / 'public/products'
        target.mkdir(parents=True)
    for f in sorted(IMAGES.iterdir()):
        shutil.copy2(f, target / f.name)
    return target


def sha(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()


def image_files(ws: Path):
    for dirpath, dirnames, filenames in os.walk(ws):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', '.venv', 'venv')]
        for n in filenames:
            p = Path(dirpath) / n
            if p.suffix.lower() in IMG_EXT:
                yield p


def ssim(a, b) -> float:
    import numpy as np
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    # 8x8 block SSIM, good enough to rank quality loss.
    h, w = (a.shape[0] // 8) * 8, (a.shape[1] // 8) * 8
    a, b = a[:h, :w].reshape(h // 8, 8, w // 8, 8), b[:h, :w].reshape(h // 8, 8, w // 8, 8)
    ma, mb = a.mean((1, 3)), b.mean((1, 3))
    va, vb = a.var((1, 3)), b.var((1, 3))
    cov = ((a - ma[:, None, :, None]) * (b - mb[:, None, :, None])).mean((1, 3))
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2))
    return float(s.mean())


def evaluate(ws: Path, before: dict, originals: dict):
    from PIL import Image, ImageOps
    after = {p: sha(p) for p in image_files(ws)}
    # Byte-identical copies (a build copying public/, a backup folder) are not outputs, unless they
    # sit next to real outputs: then they are originals the agent kept because they were already lean.
    orig_hashes = set(before.values())
    changed = [p for p in after if before.get(p) != after[p]]
    out_dirs = {p.parent for p in changed if after[p] not in orig_hashes}
    outputs = [p for p in changed if after[p] not in orig_hashes or p.parent in out_dirs]
    deleted = [p for p in before if p not in after]
    overwritten = [p for p in before if p in after and before[p] != after[p]]

    # Each output belongs to the original with the longest stem it starts with, so
    # `photo-800w.webp` maps to `photo.jpg` and not to a shorter look-alike name.
    stems = sorted((n.split('.')[0] for n in originals), key=len, reverse=True)
    by_stem = {}
    for p in outputs:
        owner = next((s for s in stems if p.name.split('.')[0].startswith(s)), None)
        if owner:
            by_stem.setdefault(owner, []).append(p)

    per_image = []
    for name, orig_path in originals.items():
        stem = name.split('.')[0]
        cands = by_stem.get(stem, [])
        src = Image.open(orig_path)
        if not cands:
            per_image.append({'name': name, 'orig': orig_path.stat().st_size, 'out': None})
            continue
        # The primary output is the largest one by pixels, so responsive variants don't hide a bad main image.
        dims = []
        for c in cands:
            try:
                with Image.open(c) as im:
                    dims.append((im.size[0] * im.size[1], c))
            except Exception:
                pass
        if not dims:
            per_image.append({'name': name, 'orig': orig_path.stat().st_size, 'out': None})
            continue
        primary = max(dims, key=lambda d: (d[0], -d[1].stat().st_size))[1]
        out = ImageOps.exif_transpose(Image.open(primary)).convert('L')
        ref = ImageOps.exif_transpose(src).convert('L').resize(out.size, Image.LANCZOS)
        per_image.append({
            'name': name, 'orig': orig_path.stat().st_size, 'out': primary.stat().st_size,
            'out_path': str(primary.relative_to(ws)), 'variants': len(cands),
            'variants_bytes': sum(c.stat().st_size for c in cands),
            'orig_dims': list(src.size), 'out_dims': list(out.size), 'ssim': round(ssim(ref, out), 4),
        })

    done = [i for i in per_image if i['out'] is not None]
    return {
        'outputs': len(outputs), 'deleted_originals': len(deleted), 'overwritten_originals': len(overwritten),
        'images_done': len(done), 'orig_bytes': sum(i['orig'] for i in per_image),
        'out_bytes_done': sum(i['out'] for i in done), 'orig_bytes_done': sum(i['orig'] for i in done),
        'mean_ssim': round(sum(i['ssim'] for i in done) / len(done), 4) if done else None,
        'min_ssim': min((i['ssim'] for i in done), default=None),
        'per_image': per_image,
    }


def parse_stream(lines):
    calls, seen, peak, init = [], set(), 0, None
    result = None
    pending = {}
    for line in lines:
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        t = d.get('type')
        if t == 'system' and d.get('subtype') == 'init':
            init = {'tools': d.get('tools'), 'mcp': d.get('mcp_servers')}
        elif t == 'assistant':
            m = d['message']
            u = m.get('usage') or {}
            ctx = u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
            peak = max(peak, ctx)
            for c in m.get('content', []):
                if c.get('type') == 'tool_use' and c['id'] not in seen:
                    seen.add(c['id'])
                    call = {'name': c['name'], 'input': c['input'], 'subagent': d.get('parent_tool_use_id') is not None}
                    pending[c['id']] = call
                    calls.append(call)
        elif t == 'user':
            for c in (d.get('message') or {}).get('content', []) if isinstance((d.get('message') or {}).get('content'), list) else []:
                if c.get('type') == 'tool_result' and c.get('tool_use_id') in pending:
                    content = c.get('content')
                    if isinstance(content, list):
                        imgs = sum(1 for x in content if x.get('type') == 'image')
                        txt = ''.join(x.get('text', '') for x in content if x.get('type') == 'text')
                    else:
                        imgs, txt = 0, str(content or '')
                    pending[c['tool_use_id']].update({'is_error': bool(c.get('is_error')), 'result_chars': len(txt), 'result_images': imgs,
                                                      'result_head': txt[:400]})
        elif t == 'result':
            result = d
    return calls, peak, init, result


def reevaluate(run_dir: Path):
    """Recomputes the file metrics of a finished run, after a change to evaluate()."""
    m = json.loads((run_dir / 'metrics.json').read_text())
    ws = run_dir / 'ws'
    target = ws if SCENARIOS[m['scenario']][0] == 'folder' else ws / 'public/products'
    originals = {f.name: f for f in (run_dir / 'orig').iterdir()}
    before = {target / n: sha(f) for n, f in originals.items()}
    m.update(evaluate(ws, before, originals))
    (run_dir / 'metrics.json').write_text(json.dumps(m, indent=2, default=str))


def main():
    if sys.argv[1:2] == ['--reeval']:
        for d in sys.argv[2:]:
            reevaluate(Path(d))
        return
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--scenario', required=True, choices=SCENARIOS)
    ap.add_argument('--mcp', required=True, choices=['on', 'off'])
    ap.add_argument('--rep', type=int, default=1)
    ap.add_argument('--tag', default='v1')
    ap.add_argument('--timeout', type=int, default=1200)
    ap.add_argument('--env', default='dev', choices=['dev', 'bare'], help='bare puts a python3 without Pillow first on PATH')
    a = ap.parse_args()

    mcp_label = a.mcp if a.env == 'dev' else f'{a.mcp}_bare'
    run_id = f'{a.tag}-{a.model}-{a.scenario}-{mcp_label}-{a.rep}'
    run_dir = BENCH / 'runs' / run_id
    stop = BENCH / 'STOP'
    if stop.exists():
        print(f'{run_id}: skipped, {stop} exists (usage limit reached)')
        return
    done = run_dir / 'metrics.json'
    if done.exists() and json.loads(done.read_text()).get('turns', 0) > 1 and not json.loads(done.read_text()).get('rate_limited'):
        print(f'{run_id}: skipped, already done')
        return
    if run_dir.exists():
        shutil.rmtree(run_dir)
    ws = run_dir / 'ws'
    kind, prompt = SCENARIOS[a.scenario]
    target = build_workspace(kind, ws)
    originals = {}
    orig_dir = run_dir / 'orig'
    orig_dir.mkdir()
    for f in target.iterdir():
        shutil.copy2(f, orig_dir / f.name)
        originals[f.name] = orig_dir / f.name
    before = {p: sha(p) for p in image_files(ws)}

    cfg = BENCH / f'mcp-{a.mcp}.json'
    cmd = ['claude', '-p', prompt, '--model', a.model, '--setting-sources', 'project',
           '--mcp-config', str(cfg), '--strict-mcp-config', '--output-format', 'stream-json', '--verbose',
           '--dangerously-skip-permissions']
    env = dict(os.environ)
    if a.env == 'bare':
        env['PATH'] = f"{BENCH / 'barepy/bin'}:{env['PATH']}"
    t0 = time.time()
    with open(run_dir / 'stream.jsonl', 'w') as out, open(run_dir / 'stderr.txt', 'w') as err:
        try:
            subprocess.run(cmd, cwd=ws, stdout=out, stderr=err, stdin=subprocess.DEVNULL, timeout=a.timeout, env=env)
            timed_out = False
        except subprocess.TimeoutExpired:
            timed_out = True
    wall = time.time() - t0

    calls, peak, init, result = parse_stream(open(run_dir / 'stream.jsonl'))
    rate_limited = any('"status": "rejected"' in l or '"status":"rejected"' in l for l in open(run_dir / 'stream.jsonl'))
    if rate_limited:
        stop.write_text(run_id)
    ev = evaluate(ws, before, originals)
    mcp_calls = [c for c in calls if c['name'].startswith('mcp__pressit')]
    usage = (result or {}).get('usage', {})
    metrics = {
        'run_id': run_id, 'tag': a.tag, 'model': a.model, 'scenario': a.scenario, 'mcp': mcp_label, 'rep': a.rep,
        'prompt': prompt, 'timed_out': timed_out, 'wall_s': round(wall, 1),
        'duration_s': round((result or {}).get('duration_ms', 0) / 1000, 1),
        'turns': (result or {}).get('num_turns'), 'cost_usd': (result or {}).get('total_cost_usd'),
        'is_error': (result or {}).get('is_error'), 'rate_limited': rate_limited,
        'input_tokens': usage.get('input_tokens', 0), 'cache_read': usage.get('cache_read_input_tokens', 0),
        'cache_write': usage.get('cache_creation_input_tokens', 0), 'output_tokens': usage.get('output_tokens', 0),
        'model_usage': (result or {}).get('modelUsage'),
        'peak_context': peak, 'tool_calls': len(calls),
        'tool_counts': {n: sum(1 for c in calls if c['name'] == n) for n in sorted({c['name'] for c in calls})},
        'mcp_used': bool(mcp_calls), 'mcp_calls': len(mcp_calls),
        'image_reads': sum(c.get('result_images', 0) for c in calls),
        'calls': calls, 'final_text': (result or {}).get('result'), **ev,
    }
    (run_dir / 'metrics.json').write_text(json.dumps(metrics, indent=2, default=str))
    saved = 1 - ev['out_bytes_done'] / ev['orig_bytes_done'] if ev['orig_bytes_done'] else 0
    print(f"{run_id}: mcp={metrics['mcp_calls']} tools={len(calls)} turns={metrics['turns']} "
          f"t={metrics['duration_s']}s ${metrics['cost_usd'] or 0:.3f} peak={peak} done={ev['images_done']}/20 "
          f"saved={saved:.0%} ssim={ev['mean_ssim']} overwrote={ev['overwritten_originals']}")


if __name__ == '__main__':
    main()
