// Turns the MCP endpoint on or off by adding or removing a flag file the API
// checks on every request, so the running server needs no restart.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const flag = fileURLToPath(new URL('../.pressit-mcp-disabled', import.meta.url));
const url = 'http://127.0.0.1:8787/mcp';

switch (process.argv[2]) {
  case 'on':
    rmSync(flag, { force: true });
    console.log(`PressIt MCP is on at ${url}`);
    break;
  case 'off':
    writeFileSync(flag, 'Created by `pnpm mcp:off`. Delete it or run `pnpm mcp:on` to turn MCP back on.\n');
    console.log('PressIt MCP is off. Run `pnpm mcp:on` to turn it back on.');
    break;
  case 'status':
    console.log(existsSync(flag) ? 'PressIt MCP is off' : `PressIt MCP is on at ${url}`);
    break;
  default:
    console.error('Usage: node scripts/mcp.mjs on|off|status');
    process.exit(1);
}
