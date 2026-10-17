// Autocomplete + "did you mean" logic for GET /search/suggest results.

import { buildCatalogUrl, buildSearchUrl, productPath } from '../../lib/urlState.js'

export const SUGGEST_MIN_CHARS = 2
export const SUGGEST_DEBOUNCE_MS = 180
const TYPE_ORDER = { category: 0, brand: 1, product: 2 }

export function orderSuggestions(list = []) {
  const seen = new Set()
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && TYPE_ORDER[s.type] !== undefined && (s.value || s.label))
    .filter((s) => {
      const key = `${s.type}:${s.product_id ?? s.value}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((s, index) => ({ ...s, label: s.label || s.value, _index: index }))
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a._index - b._index)
    .map(({ _index, ...s }) => s)
}

// Keyboard highlight: -1 means "nothing highlighted" (Enter submits the typed query).
export function moveHighlight(index, delta, length) {
  if (!length) return -1
  if (index < 0) return delta > 0 ? 0 : length - 1
  const next = index + delta
  if (next < 0 || next >= length) return -1
  return next
}

export function suggestionHref(s) {
  if (!s) return null
  if (s.type === 'product' && s.product_id) return productPath(s.product_id)
  if (s.type === 'category') return buildCatalogUrl({ category: [s.value] })
  if (s.type === 'brand') return buildCatalogUrl({ brand: [s.value] })
  return buildSearchUrl({ type: 'text', query: s.label || s.value, mode: 'hybrid' })
}

export function shouldSuggest(query) {
  return String(query || '').trim().length >= SUGGEST_MIN_CHARS
}

// Terms to retry `suggest` with when the full query gives nothing (typo in one word).
export function fallbackTerms(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  return [...new Set(words)].slice(0, 3)
}

// "Có phải bạn muốn tìm…": search links built from suggestions, never the query itself.
export function didYouMean(query, suggestions = [], { limit = 4, mode = 'hybrid', filters } = {}) {
  const current = String(query || '').trim().toLowerCase()
  const out = []
  for (const s of orderSuggestions(suggestions)) {
    const text = (s.type === 'product' ? s.label : s.label || s.value || '').trim()
    if (!text || text.toLowerCase() === current || out.some((o) => o.label.toLowerCase() === text.toLowerCase())) continue
    out.push({ label: text, type: s.type, href: buildSearchUrl({ type: 'text', query: text, mode, filters }) })
    if (out.length >= limit) break
  }
  return out
}
