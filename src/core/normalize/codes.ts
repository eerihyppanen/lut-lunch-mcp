export type SourceId = 'poweresta' | 'compass' | 'aalef';

/** Every diet/allergen code each source is known to use (from their legends and live data). */
export const KNOWN_CODES: Record<SourceId, ReadonlySet<string>> = {
  poweresta: new Set(['G', 'L', 'M', 'VL', 'VE', 'VG', '*']),
  compass: new Set(['G', 'L', 'M', 'VL', 'Veg', '*', 'A', 'ILM', 'VS']),
  aalef: new Set(['G', 'L', 'M', 'VL', 'V', '+', 'SE', 'SO', 'MU', 'SI', 'PÄ']),
};

/**
 * Splits a raw code string such as "L, M,G VE" or "L,G+" into codes.
 * A marker glued to the end of a code ("G+", "VE*") becomes its own code.
 */
export function parseCodes(raw: string): string[] {
  const codes: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    if (!token) continue;
    const glued = /^(.+?)([+*])$/.exec(token);
    if (glued) codes.push(glued[1]!, glued[2]!);
    else codes.push(token);
  }
  return [...new Set(codes)];
}

/**
 * Poweresta appends diet codes to dish names ("Itämaista linssikeittoa G, L, M, VE *").
 * Removes the trailing run of known codes; a final word that isn't a known code ("Kana BBQ")
 * stays part of the name.
 */
export function splitTrailingCodes(name: string): { name: string; codes: string[] } {
  let rest = name.trimEnd();
  const codes: string[] = [];
  for (;;) {
    const lastToken = /^(.*\S)[\s,]+([^\s,]+)[\s,]*$/.exec(rest);
    if (!lastToken) break;
    const tokenCodes = parseCodes(lastToken[2]!);
    if (!tokenCodes.every((code) => KNOWN_CODES.poweresta.has(code))) break;
    codes.unshift(...tokenCodes);
    rest = lastToken[1]!;
  }
  return { name: rest.replace(/[\s,]+$/, ''), codes: [...new Set(codes)] };
}
