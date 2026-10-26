// Cloudflare Workers entry (phase 3). Module scope lives as long as the Worker instance, so the
// cache store is shared by every request that instance serves; each request gets its own
// service, so no request ever waits on a fetch another request started.
import { MemoryCacheStore } from '../core/cache.js';
import { DEFAULT_HISTORY_BASE_URL } from '../core/history/remote.js';
import { USER_AGENT, createFetchHttpClient } from '../core/http.js';
import { createLiveMenuService } from '../core/menu-service.js';
import { createWorker } from '../worker/app.js';

const http = createFetchHttpClient({ userAgent: USER_AGENT });
const store = new MemoryCacheStore();

export default createWorker({
  serviceFor: () =>
    createLiveMenuService(http, { historyBaseUrl: DEFAULT_HISTORY_BASE_URL, store }),
});
