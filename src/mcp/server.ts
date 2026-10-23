import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MenuService } from '../core/types.js';
import { VERSION } from '../version.js';
import { registerListRestaurants } from './tools/list-restaurants.js';

/** Builds the MCP server with every tool registered. Shared by the stdio entry and tests. */
// The menu tools (plan Tasks 10–11) will use the service; list_restaurants only needs the registry.
export function createServer(_service: MenuService): McpServer {
  const server = new McpServer({ name: 'lut-lunch-mcp', version: VERSION });
  registerListRestaurants(server);
  return server;
}
