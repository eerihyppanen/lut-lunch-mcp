import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'test/fixtures/', '.superpowers/', 'eslint.config.js'] },
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
    // core/ must run anywhere (Node now, Cloudflare Workers in phase 3) and know nothing about MCP.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                ...['fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'tls'],
                ...['url', 'util', 'stream', 'buffer', 'events', 'zlib', 'worker_threads'],
              ],
              message: 'src/core must not use Node APIs.',
            },
            { group: ['@modelcontextprotocol/*'], message: 'src/core must not depend on MCP.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'process',
          'Buffer',
          'require',
          '__dirname',
          '__filename',
          'global',
          'setImmediate',
        ].map((name) => ({
          name,
          message: 'src/core must run outside Node (Cloudflare Workers).',
        })),
      ],
    },
  },
);
