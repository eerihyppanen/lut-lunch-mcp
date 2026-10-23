import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/** Every tool only reads public menus; repeated calls are safe. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
