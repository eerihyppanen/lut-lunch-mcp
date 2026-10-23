/** Normalizes text for search: lowercase, no diacritics (ä → a), single spaces. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
