import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { MenuService } from '../core/types.js';
import { createServer } from '../mcp/server.js';
import type { Env } from './env.js';
import { dispatchCollect } from './dispatch.js';
import { RATE_WINDOW_MS, createRateLimiter } from './rate-limit.js';

// The remote server (phase 3 spec §3): stateless Streamable HTTP MCP at /mcp, a short text page
// at /, and the scheduled collection trigger. One service, and so one cache, per Worker instance.

export interface WorkerDeps {
  service: MenuService;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** One line per MCP request (spec §5.4). */
  log?: (line: string) => void;
}

export interface LunchWorker {
  fetch(request: Request, env: Env): Promise<Response>;
  scheduled(controller: { cron: string }, env: Env): Promise<void>;
}

const README = 'https://github.com/eerihyppanen/lut-lunch-mcp#readme';

function aboutPage(origin: string): Response {
  const text = [
    "lut-lunch-mcp: lunch menus for LUT University's Skinnarila campus (Lappeenranta) as an MCP server.",
    `Connector URL: ${origin}/mcp`,
    `Documentation: ${README}`,
  ].join('\n');
  return new Response(`${text}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

const internalError = () =>
  Response.json(
    { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
    { status: 500 },
  );

const methodNotAllowed = () =>
  Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
    { status: 405, headers: { Allow: 'POST' } },
  );

const rateLimited = () =>
  Response.json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': String(RATE_WINDOW_MS / 1000) } },
  );

/** Method and tool name for the log line; never the arguments. */
function describe(body: unknown): { method?: string; tool?: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  const { method, params } = body as { method?: unknown; params?: { name?: unknown } };
  return {
    method: typeof method === 'string' ? method : undefined,
    tool: method === 'tools/call' && typeof params?.name === 'string' ? params.name : undefined,
  };
}

export function createWorker(deps: WorkerDeps): LunchWorker {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? Date.now;
  const jsonSchemaValidator = new CfWorkerJsonSchemaValidator();
  const limiter = createRateLimiter(now);
  const fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));

  /** A POST to /mcp. */
  async function mcp(request: Request): Promise<Response> {
    const started = now();
    // Parsed once: the log line needs the method, and the transport accepts the parsed body.
    // Invalid JSON is left to the transport, which answers with a JSON-RPC parse error.
    const body: unknown = await request
      .clone()
      .json()
      .catch(() => undefined);
    try {
      const server = createServer(deps.service, { jsonSchemaValidator });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: any instance can answer any request
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const response = await transport.handleRequest(
        request,
        body === undefined ? undefined : { parsedBody: body },
      );
      log(JSON.stringify({ ...describe(body), ms: now() - started, status: response.status }));
      return response;
    } catch (error) {
      console.error(
        `lut-lunch-mcp: request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return internalError();
    }
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/mcp') {
        // Stateless: no server-sent event stream (GET) and no sessions to end (DELETE). The
        // transport would answer GET with a stream that stays open, so only POST reaches it.
        if (request.method !== 'POST') return methodNotAllowed();
        // Checked before the body is read, so a denied request costs almost nothing.
        const client = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        if (!(await limiter.allow(client, env))) {
          log(JSON.stringify({ status: 429 }));
          return rateLimited();
        }
        return mcp(request);
      }
      if (url.pathname === '/' && request.method === 'GET') return aboutPage(url.origin);
      return new Response('Not found\n', { status: 404 });
    },
    async scheduled(controller, env) {
      try {
        await dispatchCollect(controller.cron, env.GITHUB_DISPATCH_TOKEN, fetchFn);
        log(JSON.stringify({ scheduled: controller.cron, dispatched: true }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`collect dispatch failed (${controller.cron}): ${reason}`);
        throw error; // shows the run as failed in the Cloudflare dashboard
      }
    },
  };
}
