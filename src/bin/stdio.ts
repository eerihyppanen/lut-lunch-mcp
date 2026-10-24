#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_HISTORY_URL } from '../core/history/remote.js';
import { USER_AGENT, createFetchHttpClient } from '../core/http.js';
import { createLiveMenuService } from '../core/menu-service.js';
import { createServer } from '../mcp/server.js';

const service = createLiveMenuService(createFetchHttpClient({ userAgent: USER_AGENT }), {
  // A fork or a test can point the server at another history.json.
  historyUrl: process.env.LUT_LUNCH_HISTORY_URL || DEFAULT_HISTORY_URL,
});
await createServer(service).connect(new StdioServerTransport());
// stdout carries the MCP protocol; logs go to stderr.
console.error('lut-lunch-mcp running on stdio');
