// Publishes apps/mcp/server.json to the official MCP registry. Run it after
// `pnpm mcp:publish`: the registry checks that the npm version exists.
// Logs in with GitHub only when the saved login is missing or expired.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../apps/mcp', import.meta.url));
const run = (args, capture = false) =>
  spawnSync('mcp-publisher', args, { cwd, encoding: 'utf8', stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit' });

const publish = () => {
  const result = run(['publish'], true);
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return result;
};

// The npm package named mcp-publisher is someone else's tool, so never fall back to npx.
if (run(['--help'], true).error) {
  console.error(
    'mcp-publisher is not installed. Install it with `brew install mcp-publisher`, or download it from\n' +
      'https://github.com/modelcontextprotocol/registry/releases/latest and put it on your PATH.',
  );
  process.exit(1);
}

let result = publish();
if (result.status !== 0 && /token|auth|login|unauthori[sz]ed|401/i.test(`${result.stdout}${result.stderr}`)) {
  console.log('\nLogging in to the MCP registry with GitHub, then publishing again.\n');
  if (run(['login', 'github']).status !== 0) process.exit(1);
  result = publish();
}
process.exit(result.status ?? 1);
