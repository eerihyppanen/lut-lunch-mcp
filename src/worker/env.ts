// Bindings and secrets the Worker receives from Cloudflare (wrangler.jsonc). Declared here instead
// of pulling in @cloudflare/workers-types, which would clash with the DOM and Node types the
// rest of the project uses.

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Fine-grained GitHub token (Actions: read and write) for starting the collection. */
  GITHUB_DISPATCH_TOKEN?: string;
  /** Workers Rate Limiting binding, when the plan provides it. */
  RATE_LIMITER?: RateLimitBinding;
}
