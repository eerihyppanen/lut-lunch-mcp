// Live check of a deployed (or `wrangler dev`) remote server, run by .github/workflows/deploy.yml
// after every deploy. Connects like an MCP client and checks the server version, the four tools
// and one real menu. The version check makes the deploy's retries wait for the new deployment
// instead of passing on the previous one.
//
// Run: npm run smoke:remote -- https://<worker>.workers.dev/mcp

import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VERSION } from '../src/version.js';

const TOOLS = ['find_dishes', 'get_menu', 'list_restaurants', 'menu_stats'];

export interface SmokeFindings {
  server?: { name: string; version: string };
  /** Tool names the server lists. */
  tools: string[];
  /** The text of a failed get_menu call, or null when it succeeded. */
  menuError: string | null;
}

/** What is wrong with a server that should run `expectedVersion`; empty when nothing is. */
export function smokeProblems(found: SmokeFindings, expectedVersion: string): string[] {
  const problems: string[] = [];
  const { server } = found;
  if (server?.name !== 'lut-lunch-mcp') problems.push(`unexpected server ${server?.name}`);
  else if (server.version !== expectedVersion) {
    problems.push(`server runs ${server.version}, expected ${expectedVersion}`);
  }
  const names = [...found.tools].sort();
  if (names.join() !== TOOLS.join()) problems.push(`tools are ${names.join(', ')}`);
  if (found.menuError !== null) problems.push(`get_menu failed: ${found.menuError}`);
  return problems;
}

async function smoke(url: string): Promise<string[]> {
  const client = new Client({ name: 'lut-lunch-mcp-smoke', version: VERSION });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    const server = client.getServerVersion();
    console.error(`connected to ${server?.name} ${server?.version}`);
    const { tools } = await client.listTools();
    const menu = await client.callTool({ name: 'get_menu', arguments: { date: 'today' } });
    const [first] = menu.content as { type: string; text?: string }[];
    console.error(first?.text ?? '(no text)');
    return smokeProblems(
      {
        server,
        tools: tools.map((t) => t.name),
        menuError: menu.isError ? (first?.text ?? '') : null,
      },
      VERSION,
    );
  } finally {
    await client.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npm run smoke:remote -- <url of /mcp>');
    process.exit(2);
  }
  try {
    const problems = await smoke(url);
    for (const p of problems) console.error(`FAIL: ${p}`);
    process.exit(problems.length ? 1 : 0);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
