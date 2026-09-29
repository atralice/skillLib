/**
 * Search match: prefix first, then substring, then word initials
 * ("cfw" → "cloudflare-workers"). Null when it doesn't match.
 */
export function matchScore(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.includes(q)) return 1;
  const initials = t
    .split(/[-_\s./]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("");
  return q.length >= 2 && initials.startsWith(q) ? 2 : null;
}
