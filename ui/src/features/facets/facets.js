// Facet list helpers for POST /search/facets ({value, count}) and the filter-options
// fallback (plain strings). Selected values missing from the facet response are kept (count
// 0) so the user can always untick them.

export function normalizeFacet(list) {
  return (Array.isArray(list) ? list : [])
    .map((entry) => (typeof entry === 'string' ? { value: entry, count: null } : entry))
    .filter((entry) => entry && typeof entry.value === 'string' && entry.value)
    .map((entry) => ({ value: entry.value, count: Number.isFinite(entry.count) ? entry.count : null }))
}

export function mergeFacet(list, selected = []) {
  const normalized = normalizeFacet(list)
  const known = new Set(normalized.map((entry) => entry.value))
  const hasCounts = normalized.some((entry) => entry.count != null)
  const missing = selected.filter((value) => !known.has(value)).map((value) => ({ value, count: hasCounts ? 0 : null }))
  return [...missing, ...normalized]
}
