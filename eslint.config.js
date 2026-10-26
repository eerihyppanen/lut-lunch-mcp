import tseslint from 'typescript-eslint';

// Code that runs on Cloudflare Workers must not touch Node APIs (phase 3 spec §3).
const NODE_MODULES = {
  group: [
    'node:*',
    ...['fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'tls'],
    ...['url', 'util', 'stream', 'buffer', 'events', 'zlib', 'worker_threads'],
  ],
  message: 'Code that runs on Cloudflare Workers must not use Node APIs.',
};
const NODE_GLOBALS = [
  'process',
  'Buffer',
  'require',
  '__dirname',
  '__filename',
  'global',
  'setImmediate',
].map((name) => ({ name, message: 'Code that runs on Cloudflare Workers must not use Node.' }));

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'test/fixtures/',
      '.superpowers/',
      '.wrangler/',
      'eslint.config.js',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // core/ must run anywhere (Node and Cloudflare Workers) and know nothing about MCP.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            NODE_MODULES,
            { group: ['@modelcontextprotocol/*'], message: 'src/core must not depend on MCP.' },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NODE_GLOBALS],
    },
  },
  {
    // The Worker entry and its code run only on Cloudflare Workers.
    files: ['src/worker/**/*.ts', 'src/bin/worker.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NODE_MODULES] }],
      'no-restricted-globals': ['error', ...NODE_GLOBALS],
    },
  },
);
