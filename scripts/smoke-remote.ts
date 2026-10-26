// Live check of a deployed (or `wrangler dev`) remote server, run by .github/workflows/deploy.yml
// after every deploy. Connects like an MCP client and checks the four tools and one real menu.
//
// Run: npm run smoke:remote -- https://<worker>.workers.dev/mcp

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VERSION } from '../src/version.js';

const TOOLS = ['find_dishes', 'get_menu', 'list_restaurants', 'menu_stats'];

async function smoke(url: string): Promise<string[]> {
  const problems: string[] = [];
  const client = new Client({ name: 'lut-lunch-mcp-smoke', version: VERSION });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    const server = client.getServerVersion();
    console.error(`connected to ${server?.name} ${server?.version}`);
    if (server?.name !== 'lut-lunch-mcp') problems.push(`unexpected server ${server?.name}`);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    if (names.join() !== TOOLS.join()) problems.push(`tools are ${names.join(', ')}`);

    const menu = await client.callTool({ name: 'get_menu', arguments: { date: 'today' } });
    const [first] = menu.content as { type: string; text?: string }[];
    console.error(first?.text ?? '(no text)');
    if (menu.isError) problems.push(`get_menu failed: ${first?.text ?? ''}`);
  } finally {
    await client.close();
  }
  return problems;
}

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
