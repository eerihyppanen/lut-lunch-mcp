import type { Env } from '../../src/worker/env.js';

/** The minimal Worker surface the tests drive: `fetch` like Cloudflare calls it. */
interface FetchWorker {
  fetch(request: Request, env: Env): Promise<Response>;
}

export const ORIGIN = 'https://lut-lunch-mcp.example.workers.dev';

/** Sends one JSON-RPC message to /mcp the way an MCP client does over Streamable HTTP. */
export function mcpPost(
  worker: FetchWorker,
  body: unknown,
  headers: Record<string, string> = {},
  env: Env = {},
): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    env,
  );
}

export const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
};

/** A tools/call request for one tool. */
export function toolCall(name: string, args: Record<string, unknown>, id = 3) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}
