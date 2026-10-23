import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { InvalidDateError } from '../core/calendar/dates.js';

/** A problem with the caller's arguments; its message tells the caller how to fix the call. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * Runs a tool body. Input mistakes come back to the caller as-is; anything unexpected is logged
 * to stderr and reported with a generic message, so internals never leak into a conversation.
 */
export async function runTool(
  body: () => Promise<CallToolResult>,
  failureMessage: string,
): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof InvalidDateError || error instanceof ToolInputError) {
      return errorResult(error.message);
    }
    console.error('lut-lunch-mcp: tool failed', error);
    return errorResult(failureMessage);
  }
}
