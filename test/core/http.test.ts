import { describe, expect, it, vi } from 'vitest';
import { USER_AGENT, createFetchHttpClient } from '../../src/core/http.js';
import { VERSION } from '../../src/version.js';

describe('createFetchHttpClient', () => {
  it('sends the User-Agent and classifies HTTP errors', async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('user-agent')).toBe('ua');
      return Promise.resolve(new Response('x', { status: 503 }));
    });
    const http = createFetchHttpClient({ userAgent: 'ua', fetchFn: fetchFn as typeof fetch });
    await expect(http.getText('https://e')).rejects.toMatchObject({ retryable: true });
    fetchFn.mockResolvedValueOnce(new Response('slow down', { status: 429 }));
    await expect(http.getText('https://e')).rejects.toMatchObject({ retryable: true });
    fetchFn.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    await expect(http.getText('https://e')).rejects.toMatchObject({
      retryable: false,
      status: 404,
    });
    fetchFn.mockResolvedValueOnce(new Response('{bad', { status: 200 }));
    await expect(http.getJson('https://e')).rejects.toMatchObject({ retryable: false });
  });

  it('returns bodies on success', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('{"a":1}', { status: 200 })));
    const http = createFetchHttpClient({ userAgent: 'ua', fetchFn });
    expect(await http.getJson('https://e')).toEqual({ a: 1 });
    fetchFn.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await http.getText('https://e')).toBe('<html>');
  });

  it('treats network errors and timeouts as retryable', async () => {
    const offline = createFetchHttpClient({
      userAgent: 'ua',
      fetchFn: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(offline.getText('https://e')).rejects.toMatchObject({ retryable: true });

    // Rejects with the signal's own reason (a TimeoutError DOMException), as real fetch does.
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      })) as typeof fetch;
    const slow = createFetchHttpClient({ userAgent: 'ua', timeoutMs: 10, fetchFn: hanging });
    await expect(slow.getText('https://e')).rejects.toMatchObject({
      retryable: true,
      message: expect.stringMatching(/timed out/) as unknown,
    });
  });

  it('identifies the project in its User-Agent', () => {
    expect(USER_AGENT).toBe(
      `lut-lunch-mcp/${VERSION} (+https://github.com/eerihyppanen/lut-lunch-mcp)`,
    );
  });
});
