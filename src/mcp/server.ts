import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation';
import type { MenuService } from '../core/types.js';
import { VERSION } from '../version.js';
import { registerFindDishes } from './tools/find-dishes.js';
import { registerGetMenu } from './tools/get-menu.js';
import { registerListRestaurants } from './tools/list-restaurants.js';
import { registerMenuStats } from './tools/menu-stats.js';

export interface ServerOptions {
  /** The Worker passes a validator without code generation, which Workers forbid. */
  jsonSchemaValidator?: jsonSchemaValidator;
}

/** Builds the MCP server with every tool registered. Shared by the stdio and Worker entries. */
export function createServer(service: MenuService, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'lut-lunch-mcp', version: VERSION }, options);
  registerGetMenu(server, service);
  registerFindDishes(server, service);
  registerMenuStats(server, service);
  registerListRestaurants(server);
  return server;
}
