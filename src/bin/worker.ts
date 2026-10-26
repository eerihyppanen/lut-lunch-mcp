// Cloudflare Workers entry (phase 3). Module scope lives as long as the Worker instance, so the
// service and its cache are shared by every request that instance serves.
import { DEFAULT_HISTORY_BASE_URL } from '../core/history/remote.js';
import { USER_AGENT, createFetchHttpClient } from '../core/http.js';
import { createLiveMenuService } from '../core/menu-service.js';
import { createWorker } from '../worker/app.js';

export default createWorker({
  service: createLiveMenuService(createFetchHttpClient({ userAgent: USER_AGENT }), {
    historyBaseUrl: DEFAULT_HISTORY_BASE_URL,
  }),
});
