import { describe, expect, it, vi } from 'vitest';
import { USER_AGENT } from '../../src/core/http.js';
import { createWorker } from '../../src/worker/app.js';
import { DISPATCH_URL, LAST_RETRY_CRON, dispatchCollect } from '../../src/worker/dispatch.js';
import { fakeService } from '../helpers/fakes.js';

/** A fetch that records requests and answers with `status` and `body`. */
function fakeFetch(status = 204, body = '') {
  const requests: Request[] = [];
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Promise.resolve(new Response(status === 204 ? null : body, { status }));
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, requests };
}

describe('dispatchCollect', () => {
  it('starts collect.yml on main without failing on errors at 06:30', async () => {
    const { fetchFn, requests } = fakeFetch();
    await dispatchCollect('30 6 * * *', 't', fetchFn);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect([req!.method, req!.url]).toEqual(['POST', DISPATCH_URL]);
    expect(DISPATCH_URL).toBe(
      'https://api.github.com/repos/eerihyppanen/lut-lunch-mcp/actions/workflows/collect.yml/dispatches',
    );
    expect(Object.fromEntries(req!.headers)).toMatchObject({
      authorization: 'Bearer t',
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': USER_AGENT,
    });
    expect(await req!.json()).toEqual({ ref: 'main', inputs: { fail_on_error: 'false' } });
  });

  it('fails on errors in the last retry at 10:30', async () => {
    const { fetchFn, requests } = fakeFetch();
    expect(LAST_RETRY_CRON).toBe('30 10 * * *');
    await dispatchCollect(LAST_RETRY_CRON, 't', fetchFn);
    expect(await requests[0]!.json()).toEqual({ ref: 'main', inputs: { fail_on_error: 'true' } });
  });

  it('reports what GitHub answered when it refuses', async () => {
    const { fetchFn } = fakeFetch(401, '{"message":"Bad credentials"}');
    await expect(dispatchCollect('30 8 * * *', 't', fetchFn)).rejects.toThrow(
      /HTTP 401.*Bad credentials/,
    );
  });

  it('refuses to run without a token and calls nothing (review focus)', async () => {
    const { fetchFn } = fakeFetch();
    await expect(dispatchCollect('30 6 * * *', undefined, fetchFn)).rejects.toThrow(
      'GITHUB_DISPATCH_TOKEN is not set',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Worker scheduled', () => {
  it('sends one dispatch per cron event', async () => {
    const { fetchFn, requests } = fakeFetch();
    const worker = createWorker({ serviceFor: () => fakeService(), fetchFn, log: () => {} });
    await worker.scheduled({ cron: '30 8 * * *' }, { GITHUB_DISPATCH_TOKEN: 't' });
    expect(requests).toHaveLength(1);
    expect(await requests[0]!.json()).toEqual({ ref: 'main', inputs: { fail_on_error: 'false' } });
  });

  it('logs and rethrows a failed dispatch so Cloudflare marks the run failed', async () => {
    const { fetchFn } = fakeFetch(500, 'oops');
    const lines: string[] = [];
    const worker = createWorker({
      serviceFor: () => fakeService(),
      fetchFn,
      log: (l) => lines.push(l),
    });
    await expect(
      worker.scheduled({ cron: '30 6 * * *' }, { GITHUB_DISPATCH_TOKEN: 't' }),
    ).rejects.toThrow(/HTTP 500/);
    expect(lines.join('\n')).toMatch(/collect dispatch failed.*HTTP 500/);
  });
});
