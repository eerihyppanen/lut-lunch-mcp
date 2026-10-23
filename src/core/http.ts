import { VERSION } from '../version.js';

export const USER_AGENT = `lut-lunch-mcp/${VERSION} (+https://github.com/eerihyppanen/lut-lunch-mcp)`;
const DEFAULT_TIMEOUT_MS = 8000;

/** An upstream failure. `retryable` is true when trying again later might succeed. */
export class SourceError extends Error {
  readonly retryable: boolean;
  /** HTTP status when the upstream answered with an error status. */
  readonly status: number | undefined;

  constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = 'SourceError';
    this.retryable = retryable;
    this.status = status;
  }
}

export interface HttpClient {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function createFetchHttpClient(opts: {
  userAgent: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): HttpClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = opts.fetchFn ?? fetch;

  async function getText(url: string): Promise<string> {
    try {
      const response = await fetchFn(url, {
        headers: { 'User-Agent': opts.userAgent },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        throw new SourceError(
          `Request to ${url} failed with HTTP ${response.status}`,
          retryable,
          response.status,
        );
      }
      return await response.text();
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (isTimeout(error)) {
        throw new SourceError(`Request to ${url} timed out after ${timeoutMs} ms`, true);
      }
      // fetch rejects with a TypeError for DNS, connection and TLS failures.
      const reason = error instanceof Error ? error.message : String(error);
      throw new SourceError(`Request to ${url} failed: ${reason}`, true);
    }
  }

  async function getJson(url: string): Promise<unknown> {
    const text = await getText(url);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SourceError(`Response from ${url} is not valid JSON`, false);
    }
  }

  return { getJson, getText };
}
