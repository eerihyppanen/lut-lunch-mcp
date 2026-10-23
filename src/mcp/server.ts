import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MenuService } from '../core/types.js';
import { VERSION } from '../version.js';
import { registerFindDishes } from './tools/find-dishes.js';
import { registerGetMenu } from './tools/get-menu.js';
import { registerListRestaurants } from './tools/list-restaurants.js';

/** Builds the MCP server with every tool registered. Shared by the stdio entry and tests. */
export function createServer(service: MenuService): McpServer {
  const server = new McpServer({ name: 'lut-lunch-mcp', version: VERSION });
  registerGetMenu(server, service);
  registerFindDishes(server, service);
  registerListRestaurants(server);
  return server;
}
