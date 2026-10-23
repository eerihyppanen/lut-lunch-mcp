import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect } from 'vitest';
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

/** Calls a tool that must succeed and returns its structured content. */
export async function call<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
  return res.structuredContent as T;
}

/** Calls a tool and returns the text of its first content item. */
export async function callText(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  const [first] = res.content as { type: string; text?: string }[];
  return first?.text ?? '';
}
