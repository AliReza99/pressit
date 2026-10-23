// Sets the pressit-mcp version everywhere it is written, so a release only
// needs `pnpm mcp:version patch|minor|major|<x.y.z>` before `pnpm mcp:publish`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = file => fileURLToPath(new URL(`../${file}`, import.meta.url));
const read = file => readFileSync(path(file), 'utf8');
const readJson = file => JSON.parse(read(file));
const writeJson = (file, value) => writeFileSync(path(file), `${JSON.stringify(value, null, 2)}\n`);

const current = readJson('apps/mcp/package.json').version;
const [major, minor, patch] = current.split('.').map(Number);
const arg = process.argv[2];
const next =
  arg === 'major' ? `${major + 1}.0.0`
  : arg === 'minor' ? `${major}.${minor + 1}.0`
  : arg === 'patch' ? `${major}.${minor}.${patch + 1}`
  : /^\d+\.\d+\.\d+$/.test(arg ?? '') ? arg
  : undefined;

if (!next) {
  console.error(`Usage: node scripts/version.mjs patch|minor|major|<x.y.z> (now ${current})`);
  process.exit(1);
}

// Check mcp.ts first, so a failure leaves every file as it was.
const mcp = 'apps/api/src/mcp.ts';
const source = read(mcp);
const versioned = source.replace(/(new McpServer\(\{ name: 'pressit', version: ')[^']+(')/, `$1${next}$2`);
if (versioned === source && !source.includes(`version: '${next}'`)) {
  console.error(`Could not find the McpServer version in ${mcp}`);
  process.exit(1);
}

const pkg = readJson('apps/mcp/package.json');
writeJson('apps/mcp/package.json', { ...pkg, version: next });

const server = readJson('apps/mcp/server.json');
writeJson('apps/mcp/server.json', { ...server, version: next, packages: server.packages.map(p => ({ ...p, version: next })) });

const plugin = readJson('plugins/pressit/.claude-plugin/plugin.json');
writeJson('plugins/pressit/.claude-plugin/plugin.json', { ...plugin, version: next });

writeFileSync(path(mcp), versioned);

console.log(`pressit-mcp ${current} → ${next}. Commit, then run \`pnpm mcp:publish\`.`);
