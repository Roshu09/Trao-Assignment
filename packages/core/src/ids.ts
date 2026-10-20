/**
 * Returns the next stable id for a prefix, e.g. nextId("q", ["q1", "q7"]) -> "q8".
 * Ids are never reused, so edits and references stay valid after deletes.
 */
export function nextId(prefix: string, existing: Iterable<string>): string {
  let highest = 0;
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue;
    const suffix = Number(id.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > highest) highest = suffix;
  }
  return `${prefix}${highest + 1}`;
}
