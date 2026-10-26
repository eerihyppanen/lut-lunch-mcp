/** The folded text a dish is searched by: its Finnish and English names together. */
export function dishSearchText(name: { fi: string; en: string | null }): string {
  return foldText(`${name.fi} ${name.en ?? ''}`);
}

/** Normalizes text for search: lowercase, no diacritics (ä → a), single spaces. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
