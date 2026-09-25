/**
 * Professional sidebar / Apps-launcher menu search.
 * Case-insensitive, bilingual (EN+BN via labels), multi-word AND, word-start preferred.
 */

export type NavMenuSearchable = {
  href: string
  label: string
  section: string
  /** Extra labels (other locale, subgroup, aliases). */
  altLabels?: string[]
}

export type NavMenuSearchHints = Record<string, string>

function normalizeText(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s*\(\d+\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split on whitespace and common punctuation so "P&L", "grow-out", "feed/medicine" work. */
export function tokenizeNavSearch(s: string): string[] {
  const n = normalizeText(s)
  if (!n) return []
  return n
    .split(/[\s&/_\-.,:;+|()[\]{}]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

function uniqueStrings(parts: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const n = normalizeText(p)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function wordsFrom(...texts: string[]): string[] {
  const words: string[] = []
  for (const t of texts) {
    for (const w of tokenizeNavSearch(t)) {
      words.push(w)
    }
  }
  return words
}

/**
 * Score how well one query token matches an item.
 * 0 = no match. Higher = better (exact word > word prefix > label prefix > …).
 */
function scoreToken(
  token: string,
  *,
  labels: string[],
  words: string[],
  hrefNorm: string,
  hrefSegments: string[],
  hintWords: string[],
): number {
  if (!token) return 0

  // Exact full label
  for (const label of labels) {
    if (label === token) return 100
  }

  // Exact word
  if (words.some((w) => w === token)) return 95

  // Word starts with token (first-character / progressive typing)
  if (words.some((w) => w.startsWith(token))) return 80

  // Any label starts with token
  if (labels.some((l) => l.startsWith(token))) return 70

  // Single-character queries stay label/word only — avoids /accounts, /aquaculture floods.
  if (token.length < 2) return 0

  // Href path segment starts with token (e.g. "pond" → /aquaculture/ponds)
  if (hrefSegments.some((seg) => seg.startsWith(token))) return 55

  // Substring in label
  if (labels.some((l) => l.includes(token))) return 40

  // Href path contains token
  if (hrefNorm.includes(token)) return 25

  // Section synonym hints — word-start only, 3+ chars (kills "a"/"p" floods)
  if (token.length >= 3 && hintWords.some((w) => w.startsWith(token) || w === token)) return 15

  return 0
}

/**
 * Rank a menu item against a free-text query.
 * Returns 0 if it should be hidden. Multi-word queries require every token to match (AND).
 */
export function scoreNavMenuItem(
  query: string,
  item: NavMenuSearchable,
  sectionHints: NavMenuSearchHints = {},
): number {
  const tokens = tokenizeNavSearch(query)
  if (tokens.length === 0) return 0

  const labels = uniqueStrings([item.label, ...(item.altLabels || [])])
  const labelWords = wordsFrom(...labels)
  const hrefNorm = normalizeText(item.href.replace(/[?#].*$/, ''))
  const hrefSegments = hrefNorm.split('/').filter(Boolean)
  const hintRaw = sectionHints[item.section] || ''
  const hintWords = wordsFrom(hintRaw)

  const tokenScores = tokens.map((token) =>
    scoreToken(token, {
      labels,
      words: labelWords,
      hrefNorm,
      hrefSegments,
      hintWords,
    }),
  )

  if (tokenScores.some((s) => s === 0)) return 0

  // Average across tokens, then slight boost when more tokens all matched well.
  const avg = tokenScores.reduce((a, b) => a + b, 0) / tokenScores.length
  const multiBoost = tokens.length > 1 ? Math.min(8, tokens.length * 2) : 0

  // Prefer tighter label length when scores are close (handled by caller tie-break too)
  return avg + multiBoost
}

export function rankNavMenuItems<T extends NavMenuSearchable>(
  items: T[],
  query: string,
  sectionHints: NavMenuSearchHints = {},
): T[] {
  const q = (query || '').trim()
  if (!q) return items

  const scored = items
    .map((item) => ({ item, score: scoreNavMenuItem(q, item, sectionHints) }))
    .filter((e) => e.score > 0)

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.item.label.length !== b.item.label.length) return a.item.label.length - b.item.label.length
    return a.item.label.localeCompare(b.item.label, undefined, { sensitivity: 'base' })
  })

  return scored.map((e) => e.item)
}
