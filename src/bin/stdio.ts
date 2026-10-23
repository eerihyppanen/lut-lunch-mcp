#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { MenuService } from '../core/types.js';
import { createServer } from '../mcp/server.js';

// Placeholder until the live menu service exists (plan Task 10). No tool calls it yet.
const placeholderService: MenuService = {
  today: () => new Date().toISOString().slice(0, 10),
  getDays: () => Promise.resolve([]),
};

const server = createServer(placeholderService);
await server.connect(new StdioServerTransport());
console.error('lut-lunch-mcp running on stdio');
