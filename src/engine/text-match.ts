// Text similarity helpers used to re-find anchors after a document changes.

/**
 * Levenshtein edit distance (insertions, deletions, substitutions).
 * With `max`, stops early and returns `max + 1` as soon as the distance must be larger than `max`.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (a.length > b.length) [a, b] = [b, a];
  if (b.length - a.length > max) return max + 1;
  if (a.length === 0) return b.length;
  let prev = new Int32Array(a.length + 1);
  let curr = new Int32Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    let rowMin = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      const v = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
      curr[i] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/** Dice coefficient over character pairs: fast similarity for long texts. */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const p = a.slice(i, i + 2);
    pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const p = b.slice(i, i + 2);
    const n = pairs.get(p);
    if (n) {
      shared++;
      pairs.set(p, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

/**
 * 1 = identical, 0 = nothing in common. Exact edit distance for short texts, Dice for long ones.
 * With `atLeast`, returns 0 quickly for texts that cannot reach that score.
 */
export function similarity(a: string, b: string, atLeast = 0): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  // The length difference alone costs at least that many edits.
  if (Math.min(a.length, b.length) / longest < atLeast) return 0;
  if (longest <= 400) {
    const max = Math.floor((1 - atLeast) * longest);
    const d = levenshtein(a, b, max);
    return d > max ? 0 : 1 - d / longest;
  }
  const dice = diceSimilarity(a, b);
  return dice < atLeast ? 0 : dice;
}

/** How well the text around a candidate matches the stored prefix and suffix (1 when nothing was stored). */
export function contextSimilarity(expected: { prefix: string; suffix: string }, actual: { prefix: string; suffix: string }) {
  const side = (want: string, got: string, fromEnd: boolean) => {
    if (want === '') return 1;
    const trimmed = fromEnd ? got.slice(-want.length) : got.slice(0, want.length);
    return similarity(want, trimmed);
  };
  return (side(expected.prefix, actual.prefix, true) + side(expected.suffix, actual.suffix, false)) / 2;
}

export function allIndexesOf(text: string, search: string): number[] {
  const found: number[] = [];
  if (search === '') return found;
  for (let i = text.indexOf(search); i !== -1; i = text.indexOf(search, i + 1)) found.push(i);
  return found;
}

export interface FuzzyHit {
  start: number;
  end: number;
  distance: number;
}

/** Longest pattern searched in one pass; longer patterns are found by their two ends. */
const MAX_PATTERN = 256;

/**
 * Find the substring of `text` closest to `pattern` (fewest edits), allowing at most `maxDistance` edits.
 * Returns every best hit (ties included), or [] when nothing is close enough.
 */
export function fuzzyFind(text: string, pattern: string, maxDistance: number): FuzzyHit[] {
  if (pattern.length === 0) return [];
  if (pattern.length > MAX_PATTERN) return fuzzyFindLong(text, pattern, maxDistance);

  // Sellers' algorithm: edit distance where the match may start anywhere in the text.
  // Each cell also remembers where its match started, so hits come back as ranges.
  const m = pattern.length;
  let dist = new Int32Array(m + 1);
  for (let i = 0; i <= m; i++) dist[i] = i;
  let start = new Int32Array(m + 1);
  let nextDist = new Int32Array(m + 1);
  let nextStart = new Int32Array(m + 1);
  const codes = Array.from(pattern, (_, i) => pattern.charCodeAt(i));
  let best = maxDistance + 1;
  let hits: FuzzyHit[] = [];

  for (let j = 1; j <= text.length; j++) {
    nextDist[0] = 0;
    nextStart[0] = j;
    const tj = text.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const sub = dist[i - 1] + (codes[i - 1] === tj ? 0 : 1);
      const del = dist[i] + 1; // skip a text character
      const ins = nextDist[i - 1] + 1; // skip a pattern character
      if (sub <= del && sub <= ins) {
        nextDist[i] = sub;
        nextStart[i] = start[i - 1];
      } else if (del <= ins) {
        nextDist[i] = del;
        nextStart[i] = start[i];
      } else {
        nextDist[i] = ins;
        nextStart[i] = nextStart[i - 1];
      }
    }
    const d = nextDist[m];
    if (d < best) {
      best = d;
      hits = [{ start: nextStart[m], end: j, distance: d }];
    } else if (d === best && d <= maxDistance) {
      const last = hits[hits.length - 1];
      if (last?.start !== nextStart[m]) hits.push({ start: nextStart[m], end: j, distance: d });
      // Same start, equally good: people select whole words, so prefer the end on a word boundary.
      else if (!endsOnWordBoundary(text, last.end) && endsOnWordBoundary(text, j)) last.end = j;
    }
    [dist, nextDist] = [nextDist, dist];
    [start, nextStart] = [nextStart, start];
  }
  return best <= maxDistance ? hits : [];
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
const endsOnWordBoundary = (text: string, end: number) => !isWordChar(text[end - 1]) || !isWordChar(text[end]);

/** Long patterns: find the first and last 128 characters separately, then check the text between. */
function fuzzyFindLong(text: string, pattern: string, maxDistance: number): FuzzyHit[] {
  const edge = MAX_PATTERN / 2;
  const head = pattern.slice(0, edge);
  const tail = pattern.slice(-edge);
  const edgeBudget = Math.max(1, Math.floor(edge * 0.25));
  const hits: FuzzyHit[] = [];
  for (const h of fuzzyFind(text, head, edgeBudget)) {
    // Look for the tail roughly where it should be, allowing the length to change by the edit budget.
    const from = Math.max(h.start, h.start + pattern.length - edge - maxDistance);
    const to = Math.min(text.length, h.start + pattern.length + maxDistance);
    for (const t of fuzzyFind(text.slice(from, to), tail, edgeBudget)) {
      const start = h.start;
      const end = from + t.end;
      const sim = similarity(text.slice(start, end), pattern);
      const distance = Math.round((1 - sim) * pattern.length);
      if (distance <= maxDistance) hits.push({ start, end, distance });
    }
  }
  const best = Math.min(...hits.map((h) => h.distance));
  return hits.filter((h) => h.distance === best);
}
