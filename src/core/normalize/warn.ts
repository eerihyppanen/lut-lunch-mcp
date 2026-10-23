const warned = new Set<string>();

/** Logs a warning to stderr the first time `key` is seen, so repeated menus don't spam logs. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(message);
}
