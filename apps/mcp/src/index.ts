#!/usr/bin/env node
// Runs the PressIt MCP server over stdio. The agent starts it when a session
// begins and stops it when the session ends, so nothing keeps running.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '@pressit/api/mcp';

await createMcpServer().connect(new StdioServerTransport());
