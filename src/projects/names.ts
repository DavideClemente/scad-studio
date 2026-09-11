/**
 * The one rule for whether two project names are the same name.
 *
 * Both the storage adapter and the dialog that asks for a name have to agree on
 * this, or the dialog accepts something the adapter then refuses.
 */

type Named = { id: string; name: string };

export function normaliseName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Trimmed and without case: "Bracket" and "bracket " sitting next to each other
 * in the list are the same problem as two identical names, since the only way to
 * tell them apart is to open both.
 */
export function isNameTaken(existing: Named[], name: string, exceptId?: string): boolean {
  const wanted = normaliseName(name);
  return existing.some((project) => project.id !== exceptId && normaliseName(project.name) === wanted);
}

/**
 * `base`, or the first "base 2", "base 3"… that nothing is called yet. Used for
 * the name a dialog opens with, so the common case is a keypress rather than
 * thinking of something the list will accept.
 */
export function freeName(existing: Named[], base: string): string {
  if (!isNameTaken(existing, base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base} ${suffix}`;
    if (!isNameTaken(existing, candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}
