import { USER_AGENT } from '../core/http.js';

// The collection trigger (phase 3 spec §6.1): GitHub's own scheduled runs arrive hours late, so
// the Worker's crons start collect.yml through workflow_dispatch, which starts within seconds.
// A fork changes the repository here.

export const DISPATCH_URL =
  'https://api.github.com/repos/eerihyppanen/lut-lunch-mcp/actions/workflows/collect.yml/dispatches';

/** The last slot of the day: the run fails (and GitHub emails the owner) if a source still fails. */
export const LAST_RETRY_CRON = '30 10 * * *';

/** Starts collect.yml on main; rejects with GitHub's answer when it refuses. */
export async function dispatchCollect(
  cron: string,
  token: string | undefined,
  fetchFn: typeof fetch,
): Promise<void> {
  if (!token) throw new Error('GITHUB_DISPATCH_TOKEN is not set');
  const response = await fetchFn(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: { fail_on_error: String(cron === LAST_RETRY_CRON) },
    }),
  });
  if (response.status !== 204) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`workflow_dispatch failed with HTTP ${response.status}: ${detail}`);
  }
}
