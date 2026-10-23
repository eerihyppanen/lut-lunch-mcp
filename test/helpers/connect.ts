import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { MenuService } from '../../src/core/types.js';
import { createServer } from '../../src/mcp/server.js';

/** Connects an MCP client to a fresh server over an in-memory transport pair. */
export async function connectClient(service: MenuService): Promise<Client> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer(service).connect(serverSide);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}
