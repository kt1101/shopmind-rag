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
