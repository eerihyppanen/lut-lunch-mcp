import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/', import.meta.url);

/** Reads a fixture file as UTF-8 text. `path` is relative to test/fixtures/. */
export function fixtureText(path: string): string {
  return readFileSync(new URL(path, FIXTURES), 'utf8');
}

/** Reads and parses a JSON fixture. `path` is relative to test/fixtures/. */
export function fixtureJson<T = unknown>(path: string): T {
  return JSON.parse(fixtureText(path)) as T;
}
