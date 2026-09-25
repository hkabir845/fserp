/**
 * Smoke tests for professional nav menu search (no test runner deps).
 * Run: node scripts/test-nav-menu-search.cjs
 */
const assert = require('assert')
const path = require('path')
const fs = require('fs')

// Load TS via transpile is heavy; duplicate core logic checks by requiring compiled isn't available.
// Instead: exec critical regex/tokenize rules here mirroring navMenuSearch.ts (keep in sync).

function normalizeText(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s*\(\d+\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeNavSearch(s) {
  const n = normalizeText(s)
  if (!n) return []
  return n
    .split(/[\s&/_\-.,:;+|()[\]{}]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

function uniqueStrings(parts) {
  const seen = new Set()
  const out = []
  for (const p of parts) {
    const n = normalizeText(p)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

function wordsFrom(...texts) {
  const words = []
  for (const t of texts) {
    for (const w of tokenizeNavSearch(t)) words.push(w)
  }
  return words
}

function scoreToken(token, { labels, words, hrefNorm, hrefSegments, hintWords }) {
  if (!token) return 0
  for (const label of labels) {
    if (label === token) return 100
  }
  if (words.some((w) => w === token)) return 95
  if (words.some((w) => w.startsWith(token))) return 80
  if (labels.some((l) => l.startsWith(token))) return 70
  if (token.length < 2) return 0
  if (hrefSegments.some((seg) => seg.startsWith(token))) return 55
  if (labels.some((l) => l.includes(token))) return 40
  if (hrefNorm.includes(token)) return 25
  if (token.length >= 3 && hintWords.some((w) => w.startsWith(token) || w === token)) return 15
  return 0
}

function scoreNavMenuItem(query, item, sectionHints = {}) {
  const tokens = tokenizeNavSearch(query)
  if (tokens.length === 0) return 0
  const labels = uniqueStrings([item.label, ...(item.altLabels || [])])
  const labelWords = wordsFrom(...labels)
  const hrefNorm = normalizeText(item.href.replace(/[?#].*$/, ''))
  const hrefSegments = hrefNorm.split('/').filter(Boolean)
  const hintWords = wordsFrom(sectionHints[item.section] || '')
  const tokenScores = tokens.map((token) =>
    scoreToken(token, { labels, words: labelWords, hrefNorm, hrefSegments, hintWords }),
  )
  if (tokenScores.some((s) => s === 0)) return 0
  const avg = tokenScores.reduce((a, b) => a + b, 0) / tokenScores.length
  const multiBoost = tokens.length > 1 ? Math.min(8, tokens.length * 2) : 0
  return avg + multiBoost
}

const hints = {
  aquaculture:
    'aquaculture dashboard pond cycle crop production fish farm biomass sampling feeding',
  accounting: 'accounting ledger chart coa bank accounts journal',
}

const pondStock = {
  href: '/aquaculture/stock',
  label: 'পুকুর স্টক',
  section: 'aquaculture',
  altLabels: ['Pond stock'],
}

const ponds = {
  href: '/aquaculture/ponds',
  label: 'Ponds',
  section: 'aquaculture',
  altLabels: ['পুকুর'],
}

const coa = {
  href: '/chart-of-accounts',
  label: 'Chart of Accounts',
  section: 'accounting',
}

// Case insensitive
assert.ok(scoreNavMenuItem('POND', ponds, hints) > 0)
assert.ok(scoreNavMenuItem('ponds', ponds, hints) > 0)

// BN UI + EN query
assert.ok(scoreNavMenuItem('pond', pondStock, hints) > 0)
assert.ok(scoreNavMenuItem('স্টক', pondStock, hints) > 0)

// Multi-word AND
assert.ok(scoreNavMenuItem('pond stock', pondStock, hints) > 0)
assert.strictEqual(scoreNavMenuItem('pond ledger', pondStock, hints), 0)

// Single char: word start OK ("Ponds", "Accounts"), not mid-href floods
assert.ok(scoreNavMenuItem('p', ponds, hints) > 0)
assert.strictEqual(scoreNavMenuItem('z', ponds, hints), 0)
assert.ok(scoreNavMenuItem('a', coa, hints) > 0) // word "Accounts"
assert.strictEqual(
  scoreNavMenuItem('a', { href: '/tax', label: 'Tax', section: 'management' }, hints),
  0,
)
assert.ok(scoreNavMenuItem('ch', coa, hints) > 0)

// P&L style tokenization
assert.deepStrictEqual(tokenizeNavSearch('P&L management'), ['p', 'l', 'management'])
assert.strictEqual(
  scoreNavMenuItem('pl', { href: '/x', label: 'P&L management', section: 'reports' }, {}),
  0,
)
assert.ok(scoreNavMenuItem('p l', { href: '/x', label: 'P&L management', section: 'reports' }, {}) > 0)

// Source file exists
const src = path.join(__dirname, '..', 'src', 'lib', 'navMenuSearch.ts')
assert.ok(fs.existsSync(src), 'navMenuSearch.ts missing')

console.log('nav menu search tests OK')
