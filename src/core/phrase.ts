// Filling a line's {details}, and English lines made outside the interface. No imports: the game core uses
// this too (src/world says why an edit is refused with `phrase()`); src/i18n turns them into the player's language.

export type Vars = Record<string, string | number>;

/** A line with its `{name}` details filled in; numbers through `num` (digit grouping). Unknown names stay as written. */
export function fill(line: string, vars?: Vars, num: (n: number) => string = String): string {
  if (!vars) return line;
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined ? whole : typeof v === 'number' ? num(v) : v;
  });
}

const made = new Set<string>();

/**
 * An English line the player may read, made where their language is not known (the core): the filled
 * English, as it always was (analytics and tests read it). The line is remembered, so where the text is
 * shown `say()` (src/i18n) can read it back and give it in the player's language; and tools/translate
 * finds `phrase('…')` in the source, so the line gets translated.
 */
export function phrase(line: string, vars?: Vars): string {
  made.add(line);
  return fill(line, vars);
}

/** The lines `phrase()` has made so far. */
export function phrased(): ReadonlySet<string> {
  return made;
}
