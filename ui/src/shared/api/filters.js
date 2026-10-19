// GET /search/filter-options: the contract says `options: [str]`, the backend sends
// `[{value, count}]`. Accept both and return [{value, count|null}] without blanks/duplicates.
export function normalizeOptions(options) {
  const seen = new Set()
  const out = []
  for (const option of Array.isArray(options) ? options : []) {
    const value = typeof option === 'string' ? option : option?.value
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) continue
    seen.add(value)
    out.push({ value, count: Number.isFinite(option?.count) ? option.count : null })
  }
  return out
}

// Drops blank filter values, trims and dedupes multi-value filters (public search contract).
export function cleanFilters(filters = {}) {
  return Object.fromEntries(Object.entries(filters || {}).flatMap(([key, value]) => {
    if (typeof value === 'string') {
      const cleaned = value.trim()
      return cleaned ? [[key, cleaned]] : []
    }
    if (Array.isArray(value)) {
      const cleaned = [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
      return cleaned.length ? [[key, cleaned]] : []
    }
    return []
  }))
}
