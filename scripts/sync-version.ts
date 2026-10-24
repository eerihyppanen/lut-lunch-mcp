// Keeps src/version.ts in step with package.json. Runs from npm's "version" lifecycle hook, so
// `npm version patch` bumps both before it commits and tags.

import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
writeFileSync(
  'src/version.ts',
  `/** Package version. A test keeps this in sync with package.json. */\nexport const VERSION = '${version}';\n`,
);
console.error(`src/version.ts → ${version}`);
